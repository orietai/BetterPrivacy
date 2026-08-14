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
  return (
    <div>
      <div style={{ color: 'var(--text-normal, #dbdee1)', marginBottom: 4 }}>
        Enter the secret phrase for <strong>{friendlyKeyLabel(props.entry)}</strong>{' '}
        <code style={{ fontSize: 12, opacity: 0.7 }}>{props.entry.id}</code>
      </div>
      <input
        className="bp-modal-input"
        type="password"
        autoFocus
        placeholder="Passphrase"
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
            BdApi.UI.showToast(`BetterPrivacy: unlocked "${entry.label}"`, { type: 'success' })
            settle(true)
          } else {
            BdApi.UI.showToast('Wrong passphrase', { type: 'error' })
            // Also settle when the modal was closed mid-unlock (`closed`):
            // with the Enter fallback the modal normally stays open for a
            // retry, but once it's gone nothing else can ever settle and an
            // awaiting send would hang forever.
            if (fromConfirm || closed) settle(false)
          }
        })
        .catch(() => {
          BdApi.UI.showToast('Wrong passphrase', { type: 'error' })
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
      '🦇 Unlock key',
      <UnlockContent entry={entry} passRef={passRef} onEnter={onEnter} />,
      {
        confirmText: 'Unlock',
        cancelText: 'Cancel',
        onConfirm: () => {
          confirming = true
          attemptUnlock(true)
        },
        onCancel: () => settle(false),
        // Fires on any close (Escape, backdrop). When closing via confirm the
        // async unlock is still in flight — don't settle(false) underneath it
        // (`closed` lets that in-flight attempt settle on failure instead).
        onCloseCallback: () => {
          closed = true
          if (!confirming && !unlocking) settle(false)
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
        placeholder="Secret phrase"
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
      <div className="bp-hint">
        Anyone in this channel who enters the same phrase can read the messages. Share it outside
        Discord.
      </div>
    </div>
  )
}

export function openChannelPhraseModal(
  ctx: PluginContext,
  channelId: string,
): Promise<KeyEntry | null> {
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
        BdApi.UI.showToast('A secret phrase is required', { type: 'error' })
        settle(null)
        return
      }
      void (async () => {
        try {
          const entry = await ctx.keyring.create(channelKeyLabel(channelId), passRef.value, channelId)
          await ctx.session.unlock(entry, passRef.value)
          ctx.keyring.setActiveSendKey(channelId, entry.id)
          ctx.keyring.setEncryptMode(channelId, true)
          BdApi.UI.showToast(
            '🦇 Channel encrypted — share the phrase with the people who should read it',
            { type: 'success' },
          )
          ctx.forceRerender()
          settle(entry)
        } catch (err: any) {
          BdApi.UI.showToast(err?.message ?? 'Could not set up encryption', { type: 'error' })
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
      '🦇 Encrypt this channel',
      <PhraseContent
        prompt="Pick a secret phrase for this channel. Your messages here will be encrypted with it."
        passRef={passRef}
        onEnter={onEnter}
      />,
      {
        confirmText: 'Encrypt',
        cancelText: 'Cancel',
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
      <label className="bp-modal-label">Label</label>
      <input
        className="bp-modal-input"
        type="text"
        autoFocus
        placeholder="e.g. team-chat"
        value={label}
        onChange={(e: any) => {
          setLabel(e.target.value)
          props.state.label = e.target.value
        }}
        onKeyDown={onKeyDown}
      />
      <label className="bp-modal-label">Passphrase</label>
      <input
        className="bp-modal-input"
        type="password"
        placeholder="Shared out-of-band with your peers"
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
          Only this channel
        </label>
      ) : null}
    </div>
  )
}

/**
 * Recover-key modal for "unknown key" messages: since keys derive
 * deterministically from label + passphrase (kdf.deriveSaltFromLabel), typing
 * the original pair re-derives the exact key. The derived keyId is checked
 * against the message's keyId — on match the key is added to the keyring AND
 * unlocked; on mismatch nothing is kept. Resolves true once the message can
 * decrypt.
 *
 * NOTE: pre-0.2 keys used random salts; if the original keyring entry (its
 * salt) is gone, those messages cannot be recovered by any label/passphrase.
 */
export function openRecoverKeyModal(
  ctx: PluginContext,
  expectedKeyId: string,
  channelId: string | null = null,
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
        BdApi.UI.showToast('A secret phrase is required', { type: 'error' })
        settle(false)
        return
      }
      // v1 flow: the label is the channel's synthetic one — the user only ever
      // knows the phrase. Custom-labeled keys are recovered via Settings →
      // Key Manager (create/import with the explicit label) instead.
      const label = channelId ? channelKeyLabel(channelId) : null
      if (!label) {
        BdApi.UI.showToast(
          'BetterPrivacy: cannot determine this message’s channel — recover via Settings → Key Manager',
          { type: 'error' },
        )
        settle(false)
        return
      }
      const preexisting = new Set(ctx.keyring.list().map((e) => e.id))
      void ctx.keyring
        .create(label, passRef.value, channelId as string)
        .then(async (entry) => {
          if (entry.id !== expectedKeyId) {
            // Wrong phrase (or the message used a custom-labeled key) — don't
            // keep a key the user didn't mean to create (unless it already
            // existed independently).
            if (!preexisting.has(entry.id)) ctx.keyring.remove(entry.id)
            BdApi.UI.showToast(
              'That phrase doesn’t match this message. If it was sent with a custom key, add that key in Settings → Key Manager.',
              { type: 'error' },
            )
            settle(false)
            return
          }
          const unlocked = await ctx.session.unlock(entry, passRef.value)
          if (unlocked) {
            BdApi.UI.showToast('🦇 Phrase accepted — messages unlocked', { type: 'success' })
            ctx.forceRerender()
          }
          settle(unlocked)
        })
        .catch((err: any) => {
          BdApi.UI.showToast(err?.message ?? 'Key recovery failed', { type: 'error' })
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
      '🦇 Unlock encrypted message',
      <PhraseContent
        prompt="Enter the secret phrase this channel uses."
        passRef={passRef}
        onEnter={onEnter}
      />,
      {
        confirmText: 'Unlock',
        cancelText: 'Cancel',
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
        BdApi.UI.showToast('A key label is required', { type: 'error' })
        settle(null)
        return
      }
      if (!state.passphrase) {
        BdApi.UI.showToast('A passphrase is required', { type: 'error' })
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
              ? `BetterPrivacy: key "${entry.label}" ready (created & unlocked)`
              : `BetterPrivacy: key "${entry.label}" created (${entry.id})`,
            { type: 'success' },
          )
          ctx.forceRerender()
          settle(entry)
        })
        .catch((err: any) => {
          BdApi.UI.showToast(err?.message ?? 'Key creation failed', { type: 'error' })
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
      '🦇 New key',
      <CreateKeyContent state={state} channelId={channelId} onEnter={onEnter} />,
      {
        confirmText: 'Create',
        cancelText: 'Cancel',
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
