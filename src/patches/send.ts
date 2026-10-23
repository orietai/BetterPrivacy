/**
 * patches/send.ts — outgoing message interception (spec §6, "Send").
 *
 * Uses Patcher.INSTEAD (not before) on MessageActions.sendMessage: a `before`
 * patch cannot cancel a send, and cancellation is load-bearing here — the
 * golden rule is to NEVER silently send plaintext while encrypt mode is on.
 *
 * Async caveat, documented per instruction: sendMessage is synchronous but
 * WebCrypto encryption is not. When encryption is needed we kick an async IIFE
 * that awaits encryptText/encodeWire and only then calls the original with the
 * rewritten message, returning that IIFE's promise from the instead patch.
 * Discord's caller largely tolerates this (it treats the return as a promise),
 * but the optimistic "sending…" message may appear a beat later than native
 * sends — a known limitation of the standard BD-plugin pattern.
 */

import type { KeyEntry, PluginContext } from '../types'
import { encryptText } from '../crypto/cipher'
import { chunkPlaintext, encodeWire, parseWire, CHUNK_UTF8_BYTES, DISCORD_MESSAGE_LIMIT } from '../crypto/wire'
import { t } from '../i18n'
import { openUnlockModal } from '../ui/UnlockModal'
import { resolveSendKey } from '../core/sendKey'

const PT_PREFIX = '/pt '
const ENC_REGEX = /^\/enc\s+(\S+)\s+([\s\S]+)$/

/**
 * Above this many parts, one enter-press turns into enough messages to be
 * worth asking about — so a huge accidental paste can't fire off a wall of
 * messages unchallenged. Everything typeable in a native composer stays
 * frictionless: even 4000 CJK characters (the Nitro ceiling) is ~12000 UTF-8
 * bytes ≈ 9 parts, under the threshold. Only genuinely huge pastes — which
 * are only reachable at all because composerLimit.ts raises the composer's
 * allowance — see the confirmation.
 */
const CONFIRM_PARTS_THRESHOLD = 10

function toast(message: string, type: 'info' | 'success' | 'warning' | 'error'): void {
  try {
    BdApi.UI.showToast(message, { type })
  } catch {
    // Toasting is best-effort; never let feedback failures break a send path.
  }
}

/** Sticker payloads ride on the message object or on trailing sendMessage args. */
function hasStickers(message: any, extraArgs: any[]): boolean {
  try {
    if (Array.isArray(message?.stickerIds) && message.stickerIds.length > 0) return true
    if (Array.isArray(message?.sticker_ids) && message.sticker_ids.length > 0) return true
    for (const extra of extraArgs) {
      if (Array.isArray(extra?.stickerIds) && extra.stickerIds.length > 0) return true
      if (Array.isArray(extra?.sticker_ids) && extra.sticker_ids.length > 0) return true
    }
  } catch {
    // Unexpected arg shape — treat as "no stickers"; text encryption still guards content.
  }
  return false
}

/**
 * "This will be {n} messages — send them all?". Resolves false on cancel and
 * on ANY other close (Escape, backdrop) and if the modal can't be opened at
 * all: the default is always NOT sending, because the cost of an unwanted
 * wall of messages is higher than the cost of a re-press.
 */
function confirmManyParts(n: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false
    const settle = (v: boolean): void => {
      if (settled) return
      settled = true
      resolve(v)
    }
    try {
      BdApi.UI.showConfirmationModal(t('send.confirmTitle'), t('send.confirmParts', { n }), {
        confirmText: t('send.confirmSend'),
        cancelText: t('common.cancel'),
        // onConfirm settles first; the close callback that follows is a no-op
        // thanks to `settled`.
        onConfirm: () => settle(true),
        onCancel: () => settle(false),
        onCloseCallback: () => settle(false),
      })
    } catch (err) {
      console.error('[BetterPrivacy] could not open the long-message confirmation', err)
      settle(false)
    }
  })
}

/**
 * A sendMessage result that RESOLVED but reports failure: Discord's message
 * action resolves API errors as `{ ok: false, ... }` on many builds instead
 * of rejecting. Treat both shapes as a failed part.
 */
function sendResultFailed(res: any): boolean {
  return res != null && typeof res === 'object' && res.ok === false
}

/**
 * Encrypts `plaintext` with `key` and forwards to the original sendMessage —
 * auto-splitting into as many wire messages as the text needs when it doesn't
 * fit one (each part is its own complete wire message; recipients decrypt them
 * independently). There is no part cap: past CONFIRM_PARTS_THRESHOLD parts the
 * user is asked once, and a decline sends nothing. Any failure (crypto error,
 * part rejected) cancels the send with a toast — never falls back to plaintext.
 *
 * Multi-part ordering: every part is awaited before the next is sent, so the
 * server receives them in order. All parts are encrypted UP FRONT — if any
 * chunk fails to encrypt, nothing is sent at all. A part that fails to SEND
 * (network, slowmode, AutoMod) cancels the remaining parts with a toast
 * naming which part died; the already-sent parts stand.
 */
function encryptThenSend(
  ctx: PluginContext,
  key: CryptoKey,
  entry: KeyEntry,
  plaintext: string,
  message: any,
  thisObj: any,
  args: any[],
  original: (...a: any[]) => any,
  requireSelected = false,
): Promise<any> {
  return (async () => {
    const stillUnlocked = (): boolean => ctx.session.getKey(entry.id) === key && !!ctx.keyring.get(entry.id) &&
      (!requireSelected || (ctx.keyring.isEncryptModeOn(args[0]) && resolveSendKey(ctx.keyring, args[0])?.id === entry.id))
    let chunks: string[]
    try {
      chunks = chunkPlaintext(plaintext)
    } catch (err) {
      // chunkPlaintext is total and unbounded — a throw means an internal
      // fault, so fail closed rather than send anything.
      console.error('[BetterPrivacy] chunking failed, send cancelled', err)
      toast(t('send.encryptFailed'), 'error')
      return undefined
    }

    // Ask BEFORE doing any crypto: declining should cost nothing.
    if (chunks.length > CONFIRM_PARTS_THRESHOLD) {
      const confirmed = await confirmManyParts(chunks.length)
      if (!confirmed) {
        toast(t('send.declined'), 'info')
        return undefined
      }
    }

    let wires: string[]
    try {
      if (!stillUnlocked()) { toast(t(requireSelected ? 'sending.cancelled' : 'send.cancelledLocked'), 'warning'); return undefined }
      wires = []
      for (const chunk of chunks) {
        const { iv, ct } = await encryptText(key, chunk)
        // encodeWire throws Error('BP_OVERSIZE') if a wire string exceeds 2000 chars.
        wires.push(encodeWire({ keyId: entry.id, salt: entry.salt, iv, ciphertext: ct }))
      }
    } catch (err: any) {
      if (err?.message === 'BP_OVERSIZE') {
        toast(t('send.oversize'), 'error')
      } else {
        console.error('[BetterPrivacy] encryption failed, send cancelled', err)
        toast(t('send.encryptFailed'), 'error')
      }
      return undefined
    }

    // Single part: the common case — rewrite in place, forward untouched args
    // (preserves reply references and whatever options Discord attached).
    const firstArgs = [...args]
    firstArgs[1] = { ...message, content: wires[0]! }
    if (wires.length === 1) {
      if (!stillUnlocked()) { toast(t(requireSelected ? 'sending.cancelled' : 'send.cancelledLocked'), 'warning'); return undefined }
      try {
        const result = await Reflect.apply(original, thisObj, firstArgs)
        if (sendResultFailed(result)) toast(t('send.partFailed', { i: 1, n: 1 }), 'error')
        return result
      } catch (err) {
        console.error('[BetterPrivacy] encrypted message failed to send', err)
        toast(t('send.partFailed', { i: 1, n: 1 }), 'error')
        return undefined
      }
    }

    // Multi-part: part 1 keeps the original args; follow-ups are minimal
    // fresh message objects (no reply reference duplication, no stickers).
    toast(t('send.sendingParts', { n: wires.length }), 'info')
    const channelId = args[0]
    for (let i = 0; i < wires.length; i++) {
      if (!stillUnlocked()) { toast(t(requireSelected ? 'sending.cancelled' : 'send.cancelledLocked'), 'warning'); return undefined }
      const partArgs =
        i === 0
          ? firstArgs
          : [
              channelId,
              {
                content: wires[i]!,
                tts: false,
                invalidEmojis: [],
                validNonShortcutEmojis: [],
              },
            ]
      try {
        const res = await Promise.resolve(Reflect.apply(original, thisObj, partArgs))
        if (sendResultFailed(res)) throw new Error('BP_PART_SEND_FAILED')
      } catch (err) {
        console.error(`[BetterPrivacy] part ${i + 1}/${wires.length} failed to send`, err)
        toast(t('send.partFailed', { i: i + 1, n: wires.length }), 'error')
        return undefined
      }
    }
    return undefined
  })()
}

const installedEditPatches = new WeakMap<PluginContext, WeakSet<object>>()

/** Edits replace exactly one message. Never split, guess a historical key, or
 * fall back to plaintext when the original cannot be classified. Commands such
 * as /pt are literal edit text, not an escape from historical encryption. */
export function applyEditPatch(ctx: PluginContext): void {
  const actions = ctx.modules.MessageActions
  try {
    if (typeof ctx.modules.MessageStore?.getMessage !== 'function' && !ctx.modules.failed.includes('MessageStore')) {
      // Still install the fail-closed interceptor below: a lazy store must not
      // leave the original plaintext edit action exposed while recovery waits.
      ctx.modules.failed.push('MessageStore')
    }
    if (actions && installedEditPatches.get(ctx)?.has(actions)) return
    if (!actions || typeof actions.editMessage !== 'function') {
      ctx.modules.failed.push('edit: editMessage unavailable')
      return
    }
    ctx.patcher.instead('edit', actions, 'editMessage', (thisObj: any, args: any[], original: (...a: any[]) => any) => (async () => {
      try {
        const [channelId, messageId, update] = args
        if (typeof channelId !== 'string' || !channelId || typeof messageId !== 'string' || !messageId ||
            !update || typeof update !== 'object' || Array.isArray(update) || typeof update.content !== 'string') {
          toast(t('edit.unsafe'), 'error')
          return undefined
        }
        // Snapshot draft and metadata before opening any modal.
        const message = { ...update }
        const store = ctx.modules.MessageStore
        const previous = typeof store?.getMessage === 'function' ? store.getMessage(channelId, messageId) : null
        const oldContent = previous?.content
        if (typeof oldContent !== 'string') {
          toast(t('edit.unsafe'), 'error')
          return undefined
        }
        const parts = parseWire(oldContent)
        // Malformed BetterPrivacy envelopes must not become plaintext edits.
        if (!parts && /https:\/\/betterprivacy\.app\/m\/?#|^🦇</.test(oldContent)) {
          toast(t('edit.unsafe'), 'error')
          return undefined
        }
        const mode = ctx.keyring.isEncryptModeOn(channelId)
        if (!parts && !mode) return await Reflect.apply(original, thisObj, args)

        const entry = parts ? ctx.keyring.get(parts.keyId) : resolveSendKey(ctx.keyring, channelId)
        if (!entry || (parts && entry.salt !== parts.salt)) {
          toast(t('edit.noKey'), 'error')
          return undefined
        }
        if (new TextEncoder().encode(message.content).byteLength > CHUNK_UTF8_BYTES) {
          toast(t('edit.oversize'), 'error')
          return undefined
        }
        const revision = ctx.session.revision
        const selected = ctx.keyring.getActiveSendKey(channelId)
        const selectedChannel = ctx.modules.SelectedChannelStore?.getChannelId?.()
        const salt = entry.salt
        const unchanged = (): boolean => ctx.session.revision === revision &&
          ctx.keyring.get(entry.id)?.salt === salt &&
          ctx.keyring.isEncryptModeOn(channelId) === mode &&
          ctx.keyring.getActiveSendKey(channelId) === selected &&
          ctx.modules.SelectedChannelStore?.getChannelId?.() === selectedChannel &&
          store.getMessage(channelId, messageId)?.content === oldContent &&
          (!!parts || resolveSendKey(ctx.keyring, channelId)?.id === entry.id)
        let key = ctx.session.getKey(entry.id)
        if (!key) {
          const unlocked = await openUnlockModal(ctx, entry)
          key = unlocked ? ctx.session.getKey(entry.id) : null
        }
        if (!key || !unchanged()) {
          toast(t('edit.cancelled'), 'warning')
          return undefined
        }
        const { iv, ct } = await encryptText(key, message.content)
        const wire = encodeWire({ keyId: entry.id, salt, iv, ciphertext: ct })
        if (!unchanged() || ctx.session.getKey(entry.id) !== key) {
          toast(t('edit.cancelled'), 'warning')
          return undefined
        }
        const nextArgs = [...args]
        nextArgs[2] = { ...message, content: wire }
        const result = await Reflect.apply(original, thisObj, nextArgs)
        if (sendResultFailed(result)) toast(t('edit.failed'), 'error')
        return result
      } catch (err) {
        console.error('[BetterPrivacy] edit failed; no plaintext fallback', err)
        toast(t('edit.failed'), 'error')
        return undefined
      }
    })())
    let installed = installedEditPatches.get(ctx)
    if (!installed) { installed = new WeakSet(); installedEditPatches.set(ctx, installed) }
    installed.add(actions)
  } catch (err) {
    ctx.modules.failed.push('edit: editMessage interception failed')
    console.error('[BetterPrivacy] edit hook unavailable', err)
  }
}

export function applySendPatch(ctx: PluginContext): void {
  applyEditPatch(ctx)
  const { modules } = ctx
  const actions = modules.MessageActions

  if (!actions || typeof actions.sendMessage !== 'function') {
    modules.failed.push('send: MessageActions.sendMessage unavailable')
    return
  }

  ctx.patcher.instead(
    'send',
    actions,
    'sendMessage',
    (thisObj: any, args: any[], original: (...a: any[]) => any) => {
      const passthrough = (): any => Reflect.apply(original, thisObj, args)

      try {
        const channelId: unknown = args?.[0]
        const message: any = args?.[1]

        // Unexpected call shape — not ours to interfere with.
        if (typeof channelId !== 'string' || channelId.length === 0 || !message) {
          return passthrough()
        }

        const content: string = typeof message.content === 'string' ? message.content : ''

        // ---- 1) '/pt ' prefix: strip and send plaintext once -----------------
        if (content === '/pt' || content.startsWith(PT_PREFIX)) {
          const stripped = content === '/pt' ? '' : content.slice(PT_PREFIX.length)
          // Reachable only because composerLimit.ts raises the composer's
          // allowance while encrypt mode is on. '/pt ' is a passthrough —
          // nothing splits it — so an over-long one would be rejected
          // server-side with a Discord error the user can't make sense of.
          // Cancel here instead, counting CODE POINTS the way Discord's own
          // limit does (astral characters count once, not twice).
          if ([...stripped].length > DISCORD_MESSAGE_LIMIT) {
            toast(t('send.ptTooLong'), 'error')
            return Promise.resolve()
          }
          message.content = stripped
          return passthrough()
        }

        // ---- 2) '/enc <label> <message>': one-off explicit key ---------------
        // Exact-command forms only — '/encyclopedia…' and friends are ordinary
        // messages and must not be cancelled as malformed usage.
        if (content === '/enc' || content.startsWith('/enc ')) {
          const match = ENC_REGEX.exec(content)
          if (!match) {
            // Malformed /enc almost certainly intended encryption — cancel
            // rather than risk sending the literal text.
            toast(t('send.encUsage'), 'error')
            return Promise.resolve()
          }
          const label = match[1]!
          const plaintext = match[2]!
          const entry = ctx.keyring
            .list()
            .find((e) => e.label.toLowerCase() === label.toLowerCase())
          if (!entry) {
            toast(t('send.noKeyLabelled', { label }), 'error')
            return Promise.resolve()
          }
          const key = ctx.session.getKey(entry.id)
          if (!key) {
            toast(t('send.keyLocked', { label: entry.label }), 'error')
            return Promise.resolve()
          }
          if (hasStickers(message, args.slice(2))) {
            toast(t('send.stickers'), 'error')
            return Promise.resolve()
          }
          return encryptThenSend(ctx, key, entry, plaintext, message, thisObj, args, original)
        }

        // ---- 3) Encrypt mode ON for this channel ------------------------------
        if (ctx.keyring.isEncryptModeOn(channelId)) {
          // Stickers are server-side objects and can't carry ciphertext (spec §12).
          if (hasStickers(message, args.slice(2))) {
            toast(t('send.stickers'), 'error')
            return Promise.resolve()
          }

          // Nothing textual to encrypt (e.g. attachment-only send) — the upload
          // patch owns attachment encryption; let the message action through.
          if (content.length === 0) return passthrough()

          const entry = resolveSendKey(ctx.keyring, channelId)
          if (!entry) {
            toast(t('send.noKeySelected'), 'warning')
            return Promise.resolve()
          }
          if (ctx.keyring.getActiveSendKey(channelId) !== entry.id) {
            ctx.keyring.setActiveSendKey(channelId, entry.id)
          }

          const key = ctx.session.getKey(entry.id)
          if (key) {
            return encryptThenSend(ctx, key, entry, content, message, thisObj, args, original, true)
          }

          // Active key is locked: prompt to unlock, then send or drop. NEVER
          // silently fall back to plaintext.
          return (async () => {
            let unlockedOk = false
            try {
              unlockedOk = await openUnlockModal(ctx, entry)
            } catch {
              unlockedOk = false
            }
            const unlockedKey = unlockedOk ? ctx.session.getKey(entry.id) : null
            if (!unlockedKey) {
              toast(t('send.cancelledLocked'), 'warning')
              return undefined
            }
            return encryptThenSend(ctx, unlockedKey, entry, content, message, thisObj, args, original, true)
          })()
        }

        // ---- 4) Encrypt mode OFF: plain passthrough ---------------------------
        return passthrough()
      } catch (err) {
        // Fail SAFE: if anything above blew up while encrypt mode is on, cancel
        // the send rather than risk leaking plaintext.
        console.error('[BetterPrivacy] send patch error', err)
        toast(t('send.internalError'), 'error')
        return Promise.resolve()
      }
    },
  )
}
