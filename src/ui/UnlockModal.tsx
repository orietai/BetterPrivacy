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
  passRef: { value: string }
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
          if (e.key === 'Enter') {
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
    let settled = false
    let unlocking = false
    let confirming = false
    let closed = false
    const settle = (v: boolean): void => {
      if (settled) return
      settled = true
      resolve(v)
    }

    const passRef = { value: '' }

    /**
     * `fromConfirm` = invoked via the modal's Unlock button (modal already
     * closed) — a failure must settle(false). The direct Enter fallback keeps
     * the modal open, so failure there leaves the promise pending for a retry.
     */
    const attemptUnlock = (fromConfirm: boolean): void => {
      if (settled || unlocking) return
      unlocking = true
      void ctx.session
        .unlock(entry, passRef.value)
        .then((ok) => {
          if (ok) {
            BdApi.UI.showToast(t('um.unlocked', { label: entry.label }), { type: 'success' })
            settle(true)
          } else {
            BdApi.UI.showToast(t('um.wrongPassphrase'), { type: 'error' })
            // Also settle when the modal was closed mid-unlock (`closed`):
            // with the Enter fallback the modal normally stays open for a
            // retry, but once it's gone nothing else can ever settle and an
            // awaiting send would hang forever.
            if (fromConfirm || closed) settle(false)
          }
        })
        .catch(() => {
          BdApi.UI.showToast(t('um.wrongPassphrase'), { type: 'error' })
          if (fromConfirm || closed) settle(false)
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
        onCancel: () => { ctx.session.lockKey(entry.id); settle(false) },
        // Fires on any close (Escape, backdrop). When closing via confirm the
        // async unlock is still in flight — don't settle(false) underneath it
        // (`closed` lets that in-flight attempt settle on failure instead).
        onCloseCallback: () => {
          closed = true
          if (!confirming) { ctx.session.lockKey(entry.id); settle(false) }
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
  passRef: { value: string }
  onEnter: (el: HTMLElement) => void
}): JSX.Element {
  const { useState } = BdApi.React
  const [val, setVal] = useState('')
  return (
    <div>
      <div style={{ color: 'var(--text-normal, #dbdee1)', marginBottom: 4 }}>{props.prompt}</div>
      <input
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
          if (e.key === 'Enter') {
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
  if (ctx.modules.failed.some((failure) => /send|MessageActions|upload|CloudUpload/i.test(failure))) {
    BdApi.UI.showToast(t('bar.broken'), { type: 'error' })
    return Promise.resolve(null)
  }
  return new Promise<KeyEntry | null>((resolve) => {
    let settled = false
    let confirming = false
    const settle = (v: KeyEntry | null): void => {
      if (settled) return
      settled = true
      resolve(v)
    }

    const passRef = { value: '' }

    const submit = (): void => {
      if (settled) return
      if (!passRef.value) {
        BdApi.UI.showToast(t('pm.phraseRequired'), { type: 'error' })
        settle(null)
        return
      }
      const revision = ctx.session.revision
      void (async () => {
        try {
          const entry = await ctx.keyring.create(channelKeyLabel(channelId), passRef.value, channelId)
          if (ctx.session.revision !== revision) { settle(null); return }
          if (!(await ctx.session.unlock(entry, passRef.value))) throw new Error(t('pm.setupFailed'))
          ctx.keyring.setActiveSendKey(channelId, entry.id)
          ctx.keyring.setEncryptMode(channelId, true)
          BdApi.UI.showToast(t('pm.channelEncrypted'), { type: 'success' })
          ctx.forceRerender()
          settle(entry)
        } catch (err: any) {
          BdApi.UI.showToast(err?.message ?? t('pm.setupFailed'), { type: 'error' })
          settle(null)
        }
      })()
    }

    const onEnter = (el: HTMLElement): void => {
      if (!clickModalConfirm(el)) {
        confirming = true
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
        onCancel: () => settle(null),
        onCloseCallback: () => {
          if (!confirming) settle(null)
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
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      props.onEnter(e.currentTarget as HTMLElement)
    }
  }

  return (
    <div>
      <label className="bp-modal-label">{t('ck.labelLabel')}</label>
      <input
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
    let settled = false
    let confirming = false
    const settle = (v: boolean): void => {
      if (settled) return
      settled = true
      resolve(v)
    }

    const passRef = { value: '' }

    const recover = (): void => {
      if (settled) return
      if (!passRef.value) {
        BdApi.UI.showToast(t('pm.phraseRequired'), { type: 'error' })
        settle(false)
        return
      }
      // v1 carries the actual salt: use it for web-created, shared and channel
      // keys alike. The label is only local metadata, never a KDF input here.
      const label = channelId ? channelKeyLabel(channelId) : `message:${metadata.keyId}`
      const revision = ctx.session.revision
      void ctx.keyring
        .recover(label, passRef.value, metadata, channelId ?? 'global', async (key) => {
          await authenticate(key)
          if (ctx.session.revision !== revision) throw new Error('BP_RECOVERY_CANCELLED')
        })
        .then(async (entry) => {
          if (ctx.session.revision !== revision) { settle(false); return }
          const unlocked = await ctx.session.unlock(entry, passRef.value)
          if (unlocked) {
            BdApi.UI.showToast(t('rm.accepted'), { type: 'success' })
            ctx.forceRerender()
          }
          settle(unlocked)
        })
        .catch(() => {
          BdApi.UI.showToast(t('rm.wrongPhrase'), { type: 'error' })
          settle(false)
        })
    }

    const onEnter = (el: HTMLElement): void => {
      if (!clickModalConfirm(el)) {
        confirming = true
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
        onCancel: () => settle(false),
        onCloseCallback: () => {
          if (!confirming) settle(false)
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
    let settled = false
    let confirming = false
    const settle = (v: KeyEntry | null): void => {
      if (settled) return
      settled = true
      resolve(v)
    }

    const state: CreateKeyState = { label: '', passphrase: '', channelOnly: false }

    const create = (): void => {
      if (settled) return
      const label = state.label.trim()
      if (!label) {
        BdApi.UI.showToast(t('ck.labelRequired'), { type: 'error' })
        settle(null)
        return
      }
      if (!state.passphrase) {
        BdApi.UI.showToast(t('ck.passRequired'), { type: 'error' })
        settle(null)
        return
      }
      const scope: Scope = state.channelOnly && channelId ? channelId : 'global'
      void ctx.keyring
        .create(label, state.passphrase, scope)
        .then(async (entry) => {
          // UX: the passphrase is right here — unlock immediately so the user
          // never has to type it a second time straight after creating.
          let unlocked = false
          try {
            unlocked = await ctx.session.unlock(entry, state.passphrase)
          } catch {
            unlocked = false
          }
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
          BdApi.UI.showToast(err?.message ?? t('ck.createFailed'), { type: 'error' })
          settle(null)
        })
    }

    const onEnter = (el: HTMLElement): void => {
      if (!clickModalConfirm(el)) {
        confirming = true
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
        onCancel: () => settle(null),
        onCloseCallback: () => {
          if (!confirming) settle(null)
        },
      },
    )
  })
}
