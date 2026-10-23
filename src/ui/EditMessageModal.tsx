import type { PluginContext } from '../types'
import { decryptText } from '../crypto/cipher'
import { CHUNK_UTF8_BYTES, parseWire } from '../crypto/wire'
import { t } from '../i18n'
import { openRecoverKeyModal, openUnlockModal } from './UnlockModal'

interface Draft {
  value: string
  disabled: boolean
  listeners: Set<() => void>
}

interface Launch {
  cancelled: boolean
  draft: Draft
  finish(): void
}

const lifecycles = new WeakMap<PluginContext, { stopped: boolean; pending?: Launch }>()

function toast(key: 'edit.unsafe' | 'edit.cancelled' | 'edit.failed'): void {
  try { BdApi.UI.showToast(t(key), { type: 'warning' }) } catch { /* best effort */ }
}

function clear(draft: Draft): void {
  draft.value = ''
  draft.disabled = true
  for (const notify of draft.listeners) notify()
}

/** Plaintext belongs only to this local draft, never a Discord record/store. */
function EditContent({ draft, valid, cancel, save }: { draft: Draft; valid: () => boolean; cancel: () => void; save: () => void }): JSX.Element {
  const React = BdApi.React
  const [, bump] = React.useReducer((n: number) => n + 1, 0)
  const input = React.useRef(null) as { current: HTMLTextAreaElement | null }
  React.useEffect(() => {
    const refresh = (): void => {
      // Clear the actual DOM synchronously; React may batch the rerender.
      if (draft.disabled && input.current) { input.current.value = ''; input.current.disabled = true }
      bump()
    }
    const check = (): void => { if (!valid()) cancel() }
    draft.listeners.add(refresh)
    window.addEventListener('bp-rerender', check)
    check()
    return () => {
      draft.listeners.delete(refresh)
      window.removeEventListener('bp-rerender', check)
      draft.value = ''
      draft.disabled = true
      if (input.current) { input.current.value = ''; input.current.disabled = true }
    }
  }, [])
  const bytes = new TextEncoder().encode(draft.value).byteLength
  const oversize = bytes > CHUNK_UTF8_BYTES
  return <div><div className="bp-hint">{t('edit.hint')}</div><textarea
    ref={input}
    className="bp-modal-input"
    autoFocus
    rows={8}
    aria-label={t('edit.dialogTitle')}
    value={draft.value}
    disabled={draft.disabled}
    onChange={(event: any) => {
      if (!valid() || draft.disabled) { cancel(); return }
      draft.value = event.target.value
      bump()
    }}
  />
    <div className="bp-hint" aria-live="polite">{bytes} / {CHUNK_UTF8_BYTES} UTF-8 bytes</div>
    {oversize ? <div role="alert">{t('edit.oversize')}</div> : null}
    <button type="button" disabled={draft.disabled || oversize} onClick={save}>{t('edit.save')}</button>
  </div>
}

/** Opens a private editor for one historical wire message. The local Save
 * callback snapshots the closure draft and hands it exclusively
 * to the protected editMessage action. No Flux editing actions are dispatched. */
export function openEditMessageModal(ctx: PluginContext, channelId: string, messageId: string): Promise<void> {
  let lifecycle = lifecycles.get(ctx)
  if (!lifecycle) {
    lifecycle = { stopped: false }
    lifecycles.set(ctx, lifecycle)
    const owned = lifecycle
    ctx.disposers.push(() => { owned.stopped = true; owned.pending?.finish() })
  }
  if (lifecycle.stopped || lifecycle.pending) return Promise.resolve()
  const owned = lifecycle
  let resolveDone!: () => void
  const done = new Promise<void>(resolve => { resolveDone = resolve })
  const launch: Launch = {
    cancelled: false,
    draft: { value: '', disabled: true, listeners: new Set() },
    finish() {
      if (launch.cancelled) return
      launch.cancelled = true
      clear(launch.draft)
      if (owned.pending === launch) owned.pending = undefined
      resolveDone()
    },
  }
  owned.pending = launch
  void (async () => {
    try {
      const actions = ctx.modules.MessageActions
      const store = ctx.modules.MessageStore
      if (!channelId || !messageId || typeof store?.getMessage !== 'function' ||
          typeof actions?.editMessage !== 'function' || ctx.modules.failed.some(f => /^edit:/.test(f))) {
        toast('edit.unsafe'); launch.finish(); return
      }
      const content = store.getMessage(channelId, messageId)?.content
      const parts = parseWire(content)
      if (!parts) { toast('edit.unsafe'); launch.finish(); return }
      const revision = ctx.session.revision
      const selectedChannel = ctx.modules.SelectedChannelStore?.getChannelId?.()
      const sourceValid = (): boolean => {
        try {
          return !owned.stopped && !launch.cancelled && owned.pending === launch &&
            ctx.session.revision === revision && ctx.modules.MessageStore === store &&
            store.getMessage(channelId, messageId)?.content === content &&
            ctx.modules.MessageActions === actions && typeof actions.editMessage === 'function' &&
            !ctx.modules.failed.some(f => /^edit:/.test(f)) &&
            ctx.modules.SelectedChannelStore?.getChannelId?.() === selectedChannel
        } catch { return false }
      }
      let entry = ctx.keyring.get(parts.keyId)
      if (entry && entry.salt !== parts.salt) { toast('edit.unsafe'); launch.finish(); return }
      if (!entry) {
        const recovered = await openRecoverKeyModal(ctx, parts, channelId, async candidate => {
          if (!sourceValid()) throw new Error('BP_EDIT_CANCELLED')
          await decryptText(candidate, parts.iv, parts.ciphertext)
          if (!sourceValid()) throw new Error('BP_EDIT_CANCELLED')
        })
        if (!recovered || !sourceValid()) { toast('edit.cancelled'); launch.finish(); return }
        entry = ctx.keyring.get(parts.keyId)
      }
      if (!entry || entry.salt !== parts.salt) { toast('edit.unsafe'); launch.finish(); return }
      if (!ctx.session.getKey(parts.keyId)) {
        if (!(await openUnlockModal(ctx, entry)) || !sourceValid()) {
          toast('edit.cancelled'); launch.finish(); return
        }
      }
      const key = ctx.session.getKey(parts.keyId)
      const valid = (): boolean => {
        try {
          return sourceValid() && !!key && ctx.session.getKey(parts.keyId) === key &&
            ctx.keyring.get(parts.keyId)?.salt === parts.salt
        } catch { return false }
      }
      if (!key || !valid()) { toast('edit.cancelled'); launch.finish(); return }
      let plaintext = await decryptText(key, parts.iv, parts.ciphertext)
      if (!valid()) { plaintext = ''; toast('edit.cancelled'); launch.finish(); return }
      launch.draft.value = plaintext
      plaintext = ''
      launch.draft.disabled = false
      let confirming = false
      let modalKey: string | undefined
      const closeAfterSave = (): void => {
        launch.finish()
        try {
          if (modalKey) BdApi.Webpack.getByKeys('openModal', 'closeModal')?.closeModal?.(modalKey)
        } catch { /* Optional close API: the cleared modal can still be cancelled. */ }
      }
      const save = (): void => {
        if (confirming || launch.cancelled) return
        if (!valid() || launch.draft.disabled) { toast('edit.cancelled'); launch.finish(); return }
        // Keep an oversized draft intact so it can be shortened. This guard
        // also protects direct callbacks before React updates the button.
        if (new TextEncoder().encode(launch.draft.value).byteLength > CHUNK_UTF8_BYTES) return
        confirming = true
        const edited = launch.draft.value
        clear(launch.draft)
        // Invoke immediately while the source/key checks still hold. The
        // protected action rechecks its own state across encryption awaits.
        try {
          const saving = actions.editMessage(channelId, messageId, { content: edited })
          void Promise.resolve(saving).catch(() => toast('edit.failed')).finally(closeAfterSave)
        } catch { toast('edit.failed'); closeAfterSave() }
      }
      modalKey = BdApi.UI.showConfirmationModal(t('edit.dialogTitle'),
        <EditContent draft={launch.draft} valid={valid} cancel={() => launch.finish()} save={save} />, {
          confirmText: null,
          cancelText: t('common.cancel'),
          onConfirm: save,
          onCancel: () => launch.finish(),
          onCloseCallback: () => { if (!confirming) launch.finish() },
        })
    } catch {
      toast('edit.failed')
      launch.finish()
    }
  })()
  return done
}
