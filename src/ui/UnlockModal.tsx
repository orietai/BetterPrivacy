/**
 * BetterPrivacy — passphrase modals.
 *
 * openUnlockModal(ctx, entry)  — contract export: prompt for a passphrase and
 *   try to unlock `entry`; resolves true only if the session now holds the key.
 * openCreateKeyModal(ctx, ...) — shared internal helper (used by the chat-bar
 *   key picker and the settings panel) to create a new key.
 *
 * BdApi.UI.showConfirmationModal's onConfirm is synchronous and the modal
 * closes as soon as it returns, so the passphrase lives in a closure ref that
 * the (controlled) input mirrors on every change; the async unlock/create then
 * resolves the returned promise afterwards. Passphrases are never logged or
 * persisted — the closure dies with the modal.
 */

import type { KeyEntry, PluginContext, Scope } from '../types'
import { channelKeyLabel, friendlyKeyLabel } from './labels'
import { t } from '../i18n'
import { unlockChannelKeys, unlockIfCurrent } from '../core/session'

const modalOwners = new WeakMap<PluginContext, { stopped: boolean; cancels: Set<() => void> }>()

function lifecycle<T>(ctx: PluginContext, resolve: (value: T) => void, cancelled: T, clear: () => void) {
  let owner = modalOwners.get(ctx)
  if (!owner) {
    owner = { stopped: false, cancels: new Set() }
    modalOwners.set(ctx, owner)
    const owned = owner
    ctx.disposers?.push(() => { owned.stopped = true; for (const cancel of [...owned.cancels]) cancel() })
    ctx.session.onRelock(() => {
      if (owned.cancels.size) feedback('um.cancelled', 'info')
      for (const cancel of [...owned.cancels]) cancel()
    })
  }
  const revision = ctx.session.revision
  const channel = ctx.modules.SelectedChannelStore?.getChannelId?.()
  let settled = false
  const finish = (value: T): void => {
    if (settled) return
    settled = true
    owner!.cancels.delete(cancel)
    clear()
    resolve(value)
  }
  const cancel = (): void => finish(cancelled)
  owner.cancels.add(cancel)
  return {
    finish, cancel,
    current: (): boolean => !settled && !owner!.stopped && ctx.session.revision === revision &&
      ctx.modules.SelectedChannelStore?.getChannelId?.() === channel,
    settled: (): boolean => settled,
  }
}

interface PhraseRef { value: string; input?: HTMLInputElement | null }
function clearPhrase(ref: PhraseRef): void {
  ref.value = ''
  if (ref.input) { ref.input.value = ''; ref.input.disabled = true }
}
function phraseValue(ref: PhraseRef): string { return ref.input?.value ?? ref.value }
function feedback(key: string, type: 'info' | 'success' | 'error'): void {
  try { BdApi.UI.showToast(t(key as Parameters<typeof t>[0]), { type }) } catch { /* Feedback cannot change an operation's result. */ }
}

/**
 * Best-effort "press Enter to confirm": click the modal's primary action so
 * BetterDiscord closes the modal and fires onConfirm. BD's confirmation modal
 * renders its confirm action as the footer's submit button; if the markup has
 * changed and no button is found, the caller falls back to running the confirm
 * logic directly (modal stays open, which is harmless).
 */
function clickModalConfirm(from: HTMLElement): boolean {
  const dialog = from.closest('[role="dialog"], [class*="modal"]')
  const btn = dialog?.querySelector('button[type="submit"]') as HTMLButtonElement | null
  if (btn) {
    btn.click()
    return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Unlock modal
// ---------------------------------------------------------------------------

function UnlockContent(props: {
  entry: KeyEntry
  passRef: PhraseRef
  onEnter: (el: HTMLElement) => void
}): JSX.Element {
  const { useState } = BdApi.React
  const [val, setVal] = useState('')
  // The sentence wraps the label in <strong>, so the translated template is
  // split on its {label} placeholder instead of going through t()'s
  // substitution (all three locales keep the placeholder literal).
  const [pre, post] = t('um.enterPhraseFor').split('{label}')
  return (
    <div>
      <div style={{ color: 'var(--text-normal, #dbdee1)', marginBottom: 4 }}>
        {pre}
        <strong>{friendlyKeyLabel(props.entry)}</strong>
        {post}{' '}
        <code style={{ fontSize: 12, opacity: 0.7 }}>{props.entry.id}</code>
      </div>
      <input
        ref={(input: HTMLInputElement | null) => { props.passRef.input = input }}
        className="bp-modal-input"
        type="password"
        autoFocus
        placeholder={t('um.passphrasePh')}
        value={val}
        onChange={(e: any) => {
          setVal(e.target.value)
          props.passRef.value = e.target.value
        }}
        onKeyDown={(e: any) => {
          if (e.key === 'Enter' && !e.nativeEvent?.isComposing && !e.isComposing && e.keyCode !== 229) {
            props.passRef.value = e.currentTarget.value
            e.preventDefault()
            e.stopPropagation()
            props.onEnter(e.currentTarget as HTMLElement)
          }
        }}
      />
    </div>
  )
}

/** Resolves true if the key was unlocked, false on wrong passphrase or cancel. */
export function openUnlockModal(ctx: PluginContext, entry: KeyEntry): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let unlocking = false
    let confirming = false
    let closed = false
    const passRef: PhraseRef = { value: '' }
    const life = lifecycle<boolean>(ctx, resolve, false, () => clearPhrase(passRef))
    const settle = life.finish

    /**
     * `fromConfirm` = invoked via the modal's Unlock button (modal already
     * closed) — a failure must settle(false). The direct Enter fallback keeps
     * the modal open, so failure there leaves the promise pending for a retry.
     */
    const attemptUnlock = (fromConfirm: boolean): void => {
      if (life.settled() || unlocking) return
      if (!life.current()) { life.cancel(); return }
      unlocking = true
      const phrase = phraseValue(passRef)
      const scope = entry.scope
      const channelId = scope === 'global' ? ctx.modules.SelectedChannelStore?.getChannelId?.() ?? null : scope
      void unlockIfCurrent(ctx.session, entry, phrase, life.current)
        .then(async (ok) => {
          if (life.settled()) return
          const saved = ctx.keyring.get(entry.id)
          if (!life.current() || saved?.salt !== entry.salt || saved?.check !== entry.check || saved?.scope !== scope) {
            feedback('um.cancelled', 'info')
            settle(false)
            return
          }
          if (ok) {
            ctx.forceRerender()
            const n = await unlockChannelKeys(ctx, channelId, phrase, entry.id, life.current)
            if (!life.current() || !ctx.session.isUnlocked(entry.id)) { life.cancel(); return }
            try { BdApi.UI.showToast(t('um.unlockedCount', { n }), { type: 'success' }) } catch { /* best effort */ }
            ctx.forceRerender()
            settle(true)
          } else {
            feedback('um.wrongPassphrase', 'error')
            // Also settle when the modal was closed mid-unlock (`closed`):
            // with the Enter fallback the modal normally stays open for a
            // retry, but once it's gone nothing else can ever settle and an
            // awaiting send would hang forever.
            if (fromConfirm || closed) settle(false)
          }
        })
        .catch(() => {
          if (life.settled()) return
          const cancelled = !life.current()
          feedback(cancelled ? 'um.cancelled' : 'pm.setupFailed', cancelled ? 'info' : 'error')
          if (cancelled || fromConfirm || closed) settle(false)
        })
        .then(() => {
          unlocking = false
        })
    }

    const onEnter = (el: HTMLElement): void => {
      // Prefer routing through the modal's own confirm button so it closes.
      if (!clickModalConfirm(el)) attemptUnlock(false)
    }

    BdApi.UI.showConfirmationModal(
      t('um.title'),
      <UnlockContent entry={entry} passRef={passRef} onEnter={onEnter} />,
      {
        confirmText: t('common.unlock'),
        cancelText: t('common.cancel'),
        onConfirm: () => {
          confirming = true
          attemptUnlock(true)
        },
        onCancel: life.cancel,
        // Fires on any close (Escape, backdrop). When closing via confirm the
        // async unlock is still in flight — don't settle(false) underneath it
        // (`closed` lets that in-flight attempt settle on failure instead).
        onCloseCallback: () => {
          closed = true
          if (!confirming) life.cancel()
        },
      },
    )
  })
}

// ---------------------------------------------------------------------------
// Channel-phrase modal — the v1 primary flow: ONE field, everything else
// automatic. Creates (or restores, via deterministic derivation) the channel's
// key with the synthetic `channel:<id>` label, unlocks it, makes it the active
// send key, and arms encrypt mode. Resolves the entry, or null on cancel/error.
// ---------------------------------------------------------------------------

function PhraseContent(props: {
  prompt: string
  passRef: PhraseRef
  onEnter: (el: HTMLElement) => void
}): JSX.Element {
  const { useState } = BdApi.React
  const [val, setVal] = useState('')
  return (
    <div>
      <div style={{ color: 'var(--text-normal, #dbdee1)', marginBottom: 4 }}>{props.prompt}</div>
      <input
        ref={(input: HTMLInputElement | null) => { props.passRef.input = input }}
        className="bp-modal-input"
        type="password"
        autoFocus
        placeholder={t('pm.secretPhrasePh')}
        value={val}
        onChange={(e: any) => {
          setVal(e.target.value)
          props.passRef.value = e.target.value
        }}
        onKeyDown={(e: any) => {
          if (e.key === 'Enter' && !e.nativeEvent?.isComposing && !e.isComposing && e.keyCode !== 229) {
            props.passRef.value = e.currentTarget.value
            e.preventDefault()
            e.stopPropagation()
            props.onEnter(e.currentTarget as HTMLElement)
          }
        }}
      />
      <div className="bp-hint">{t('pm.hint')}</div>
    </div>
  )
}

export function openChannelPhraseModal(
  ctx: PluginContext,
  channelId: string,
): Promise<KeyEntry | null> {
  if (ctx.modules.failed.some((failure) => /send|edit(?:Composer)?:|MessageActions|MessageStore|upload|CloudUpload/i.test(failure))) {
    BdApi.UI.showToast(t('bar.broken'), { type: 'error' })
    return Promise.resolve(null)
  }
  return new Promise<KeyEntry | null>((resolve) => {
    let confirming = false
    let busy = false
    const passRef: PhraseRef = { value: '' }
    const life = lifecycle<KeyEntry | null>(ctx, resolve, null, () => clearPhrase(passRef))
    const settle = life.finish

    const submit = (): void => {
      if (life.settled() || busy) return
      if (!life.current()) { life.cancel(); return }
      const phrase = phraseValue(passRef)
      if (!phrase) {
        BdApi.UI.showToast(t('pm.phraseRequired'), { type: 'error' })
        settle(null)
        return
      }
      busy = true
      void (async () => {
        try {
          const entry = await ctx.keyring.create(channelKeyLabel(channelId), phrase, channelId)
          if (!life.current()) { life.cancel(); return }
          if (!(await unlockIfCurrent(ctx.session, entry, phrase, life.current))) {
            if (!life.current()) { life.cancel(); return }
            throw new Error(t('pm.setupFailed'))
          }
          if (!life.current()) { life.cancel(); return }
          ctx.keyring.setActiveSendKey(channelId, entry.id)
          ctx.keyring.setEncryptMode(channelId, true)
          BdApi.UI.showToast(t('pm.channelEncrypted'), { type: 'success' })
          ctx.forceRerender()
          const n = await unlockChannelKeys(ctx, channelId, phrase, entry.id, life.current)
          if (!life.current() || !ctx.session.isUnlocked(entry.id)) { life.cancel(); return }
          if (n > 1) {
            try { BdApi.UI.showToast(t('um.unlockedCount', { n }), { type: 'success' }) } catch { /* best effort */ }
          }
          ctx.forceRerender()
          settle(entry)
        } catch (err: any) {
          if (life.settled()) return
          if (!life.current()) { life.cancel(); return }
          BdApi.UI.showToast(err?.message ?? t('pm.setupFailed'), { type: 'error' })
          settle(null)
        }
      })()
    }

    const onEnter = (el: HTMLElement): void => {
      if (!clickModalConfirm(el)) {
        submit()
      }
    }

    BdApi.UI.showConfirmationModal(
      t('pm.title'),
      <PhraseContent prompt={t('pm.prompt')} passRef={passRef} onEnter={onEnter} />,
      {
        confirmText: t('common.encrypt'),
        cancelText: t('common.cancel'),
        onConfirm: () => {
          confirming = true
          submit()
        },
        onCancel: life.cancel,
        onCloseCallback: () => {
          if (!confirming) life.cancel()
        },
      },
    )
  })
}

// ---------------------------------------------------------------------------
// Create-key modal (shared by ChatBarControls and KeyManagerPanel)
// ---------------------------------------------------------------------------

interface CreateKeyState {
  label: string
  passphrase: string
  channelOnly: boolean
  passInput?: HTMLInputElement | null
  labelInput?: HTMLInputElement | null
}

function CreateKeyContent(props: {
  state: CreateKeyState
  channelId: string | null
  onEnter: (el: HTMLElement) => void
}): JSX.Element {
  const { useState } = BdApi.React
  const [label, setLabel] = useState('')
  const [pass, setPass] = useState('')
  const [channelOnly, setChannelOnly] = useState(false)

  const onKeyDown = (e: any): void => {
    if (e.key === 'Enter' && !e.nativeEvent?.isComposing && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault()
      e.stopPropagation()
      props.onEnter(e.currentTarget as HTMLElement)
    }
  }

  return (
    <div>
      <label className="bp-modal-label">{t('ck.labelLabel')}</label>
      <input
        ref={(input: HTMLInputElement | null) => { props.state.labelInput = input }}
        className="bp-modal-input"
        type="text"
        autoFocus
        placeholder={t('ck.labelPh')}
        value={label}
        onChange={(e: any) => {
          setLabel(e.target.value)
          props.state.label = e.target.value
        }}
        onKeyDown={onKeyDown}
      />
      <label className="bp-modal-label">{t('ck.passLabel')}</label>
      <input
        ref={(input: HTMLInputElement | null) => { props.state.passInput = input }}
        className="bp-modal-input"
        type="password"
        placeholder={t('ck.passPh')}
        value={pass}
        onChange={(e: any) => {
          setPass(e.target.value)
          props.state.passphrase = e.target.value
        }}
        onKeyDown={onKeyDown}
      />
      {props.channelId ? (
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 10,
            color: 'var(--text-normal, #dbdee1)',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={channelOnly}
            onChange={(e: any) => {
              setChannelOnly(e.target.checked)
              props.state.channelOnly = e.target.checked
            }}
          />
          {t('ck.onlyThisChannel')}
        </label>
      ) : null}
    </div>
  )
}

/**
 * Recover from the salt advertised by a v1 message or container. The payload
 * is authenticated before the keyring is changed. Resolves after unlocking.
 */
export function openRecoverKeyModal(
  ctx: PluginContext,
  metadata: { keyId: string; salt: string },
  channelId: string | null = null,
  authenticate: (key: CryptoKey) => Promise<unknown>,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let confirming = false
    let busy = false
    const passRef: PhraseRef = { value: '' }
    const life = lifecycle<boolean>(ctx, resolve, false, () => clearPhrase(passRef))
    const settle = life.finish
    const envelope = { ...metadata }

    const recover = (): void => {
      if (life.settled() || busy) return
      if (!life.current()) { life.cancel(); return }
      const phrase = phraseValue(passRef)
      if (!phrase) {
        BdApi.UI.showToast(t('pm.phraseRequired'), { type: 'error' })
        settle(false)
        return
      }
      // v1 carries the actual salt: use it for web-created, shared and channel
      // keys alike. The label is only local metadata, never a KDF input here.
      busy = true
      const label = channelId ? channelKeyLabel(channelId) : `message:${envelope.keyId}`
      void ctx.keyring
        .recover(label, phrase, envelope, channelId ?? 'global', async (key) => {
          if (!life.current()) throw new Error('BP_RECOVERY_CANCELLED')
          await authenticate(key)
          if (!life.current()) throw new Error('BP_RECOVERY_CANCELLED')
        })
        .then(async (entry) => {
          if (!life.current()) { life.cancel(); return }
          const unlocked = await unlockIfCurrent(ctx.session, entry, phrase, life.current)
          if (!life.current()) { life.cancel(); return }
          if (unlocked) {
            ctx.forceRerender()
            const batchChannel = channelId ?? ctx.modules.SelectedChannelStore?.getChannelId?.() ?? null
            const n = await unlockChannelKeys(ctx, batchChannel, phrase, entry.id, life.current)
            if (!life.current() || !ctx.session.isUnlocked(entry.id)) { life.cancel(); return }
            try { BdApi.UI.showToast(t('um.unlockedCount', { n }), { type: 'success' }) } catch { /* best effort */ }
            ctx.forceRerender()
          }
          settle(unlocked)
        })
        .catch(() => {
          if (life.settled()) return
          const cancelled = !life.current()
          feedback(cancelled ? 'um.cancelled' : 'rm.wrongPhrase', cancelled ? 'info' : 'error')
          settle(false)
        })
    }

    const onEnter = (el: HTMLElement): void => {
      if (!clickModalConfirm(el)) {
        recover()
      }
    }

    BdApi.UI.showConfirmationModal(
      t('rm.title'),
      <PhraseContent prompt={t('rm.prompt')} passRef={passRef} onEnter={onEnter} />,
      {
        confirmText: t('common.unlock'),
        cancelText: t('common.cancel'),
        onConfirm: () => {
          confirming = true
          recover()
        },
        onCancel: life.cancel,
        onCloseCallback: () => {
          if (!confirming) life.cancel()
        },
      },
    )
  })
}

/**
 * Opens the create-key modal. `channelId` (when provided, e.g. from the chat
 * bar) enables the "only this channel" scope checkbox; without it the key is
 * always created with global scope. Resolves with the new entry, or null on
 * cancel / validation / creation failure.
 */
export function openCreateKeyModal(
  ctx: PluginContext,
  channelId: string | null = null,
): Promise<KeyEntry | null> {
  return new Promise<KeyEntry | null>((resolve) => {
    let confirming = false
    let busy = false
    const state: CreateKeyState = { label: '', passphrase: '', channelOnly: false }
    const life = lifecycle<KeyEntry | null>(ctx, resolve, null, () => {
      state.passphrase = ''
      if (state.passInput) { state.passInput.value = ''; state.passInput.disabled = true }
    })
    const settle = life.finish

    const create = (): void => {
      if (life.settled() || busy) return
      if (!life.current()) { life.cancel(); return }
      const label = (state.labelInput?.value ?? state.label).trim()
      const phrase = state.passInput?.value ?? state.passphrase
      if (!label) {
        BdApi.UI.showToast(t('ck.labelRequired'), { type: 'error' })
        settle(null)
        return
      }
      if (!phrase) {
        BdApi.UI.showToast(t('ck.passRequired'), { type: 'error' })
        settle(null)
        return
      }
      const scope: Scope = state.channelOnly && channelId ? channelId : 'global'
      busy = true
      void ctx.keyring
        .create(label, phrase, scope)
        .then(async (entry) => {
          if (!life.current()) { life.cancel(); return }
          // UX: the passphrase is right here — unlock immediately so the user
          // never has to type it a second time straight after creating.
          let unlocked = false
          try {
            unlocked = await unlockIfCurrent(ctx.session, entry, phrase, life.current)
          } catch {
            unlocked = false
          }
          if (!life.current()) { life.cancel(); return }
          BdApi.UI.showToast(
            unlocked
              ? t('ck.ready', { label: entry.label })
              : t('ck.created', { label: entry.label, id: entry.id }),
            { type: 'success' },
          )
          ctx.forceRerender()
          settle(entry)
        })
        .catch((err: any) => {
          if (life.settled()) return
          if (!life.current()) { life.cancel(); return }
          BdApi.UI.showToast(err?.message ?? t('ck.createFailed'), { type: 'error' })
          settle(null)
        })
    }

    const onEnter = (el: HTMLElement): void => {
      if (!clickModalConfirm(el)) {
        create()
      }
    }

    BdApi.UI.showConfirmationModal(
      t('ck.title'),
      <CreateKeyContent state={state} channelId={channelId} onEnter={onEnter} />,
      {
        confirmText: t('common.create'),
        cancelText: t('common.cancel'),
        onConfirm: () => {
          confirming = true
          create()
        },
        onCancel: life.cancel,
        onCloseCallback: () => {
          if (!confirming) life.cancel()
        },
      },
    )
  })
}
