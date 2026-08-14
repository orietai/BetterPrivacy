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
import { encodeWire, MAX_PLAINTEXT_CHARS } from '../crypto/wire'
import { openUnlockModal } from '../ui/UnlockModal'

const PT_PREFIX = '/pt '
const ENC_REGEX = /^\/enc\s+(\S+)\s+([\s\S]+)$/

/**
 * Holds the channel id of a '/pt '-prefixed send while it is passing through,
 * so the upload patch can skip encrypting attachments belonging to the same
 * send — and ONLY that channel's attachments (a process-global boolean had a
 * cross-channel race window). Best-effort coordination: cleared on the next
 * macrotask (uploads for the same message are queued within the current
 * tick). Attachment-only sends that never hit sendMessage can't observe this
 * flag — documented limitation.
 */
let plaintextOverrideChannelId: string | null = null

export function isPlaintextOverrideActive(channelId: string | null): boolean {
  return channelId !== null && channelId === plaintextOverrideChannelId
}

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
 * Encrypts `plaintext` with `key`, rewrites message.content to wire format and
 * forwards to the original sendMessage. Any failure (oversize, crypto error)
 * cancels the send with a toast — never falls back to plaintext.
 */
function encryptThenSend(
  key: CryptoKey,
  entry: KeyEntry,
  plaintext: string,
  message: any,
  thisObj: any,
  args: any[],
  original: (...a: any[]) => any,
): Promise<any> {
  return (async () => {
    if (plaintext.length > MAX_PLAINTEXT_CHARS) {
      toast(
        `BetterPrivacy: message too long to encrypt (max ${MAX_PLAINTEXT_CHARS} characters) — send cancelled`,
        'error',
      )
      return undefined
    }
    try {
      const { iv, ct } = await encryptText(key, plaintext)
      // encodeWire throws Error('BP_OVERSIZE') if the wire string exceeds 2000 chars.
      const wire = encodeWire({ keyId: entry.id, salt: entry.salt, iv, ciphertext: ct })
      message.content = wire
      return Reflect.apply(original, thisObj, args)
    } catch (err: any) {
      if (err?.message === 'BP_OVERSIZE') {
        toast(
          'BetterPrivacy: encrypted message exceeds the 2000-character limit — send cancelled',
          'error',
        )
      } else {
        console.error('[BetterPrivacy] encryption failed, send cancelled', err)
        toast('BetterPrivacy: encryption failed — send cancelled', 'error')
      }
      return undefined
    }
  })()
}

export function applySendPatch(ctx: PluginContext): void {
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
          message.content = content === '/pt' ? '' : content.slice(PT_PREFIX.length)
          plaintextOverrideChannelId = channelId
          try {
            return passthrough()
          } finally {
            // Macrotask delay so uploads queued by this same send still see the
            // override (see isPlaintextOverrideActive doc comment).
            setTimeout(() => {
              plaintextOverrideChannelId = null
            }, 0)
          }
        }

        // ---- 2) '/enc <label> <message>': one-off explicit key ---------------
        // Exact-command forms only — '/encyclopedia…' and friends are ordinary
        // messages and must not be cancelled as malformed usage.
        if (content === '/enc' || content.startsWith('/enc ')) {
          const match = ENC_REGEX.exec(content)
          if (!match) {
            // Malformed /enc almost certainly intended encryption — cancel
            // rather than risk sending the literal text.
            toast('BetterPrivacy: usage — /enc <key label> <message>. Send cancelled.', 'error')
            return Promise.resolve()
          }
          const label = match[1]!
          const plaintext = match[2]!
          const entry = ctx.keyring
            .list()
            .find((e) => e.label.toLowerCase() === label.toLowerCase())
          if (!entry) {
            toast(`BetterPrivacy: no key labelled "${label}" — send cancelled`, 'error')
            return Promise.resolve()
          }
          const key = ctx.session.getKey(entry.id)
          if (!key) {
            toast(`BetterPrivacy: key "${entry.label}" is locked — unlock it first. Send cancelled.`, 'error')
            return Promise.resolve()
          }
          if (hasStickers(message, args.slice(2))) {
            toast("BetterPrivacy: stickers can't be encrypted — send cancelled", 'error')
            return Promise.resolve()
          }
          return encryptThenSend(key, entry, plaintext, message, thisObj, args, original)
        }

        // ---- 3) Encrypt mode ON for this channel ------------------------------
        if (ctx.keyring.isEncryptModeOn(channelId)) {
          // Stickers are server-side objects and can't carry ciphertext (spec §12).
          if (hasStickers(message, args.slice(2))) {
            toast("BetterPrivacy: stickers can't be encrypted — send cancelled", 'error')
            return Promise.resolve()
          }

          // Nothing textual to encrypt (e.g. attachment-only send) — the upload
          // patch owns attachment encryption; let the message action through.
          if (content.length === 0) return passthrough()

          const activeId = ctx.keyring.getActiveSendKey(channelId)
          let entry = activeId ? ctx.keyring.get(activeId) : undefined
          if (!entry) {
            // UX: with exactly one applicable key there's nothing to choose —
            // adopt it instead of dead-ending the send.
            const available = ctx.keyring.forChannel(channelId)
            if (available.length === 1) {
              entry = available[0]!
              ctx.keyring.setActiveSendKey(channelId, entry.id)
              toast(`BetterPrivacy: using key "${entry.label}"`, 'info')
            } else {
              toast(
                'BetterPrivacy: no key selected — pick one from the 🦇 dropdown next to the lock button. Send cancelled.',
                'warning',
              )
              return Promise.resolve()
            }
          }

          const key = ctx.session.getKey(entry.id)
          if (key) {
            return encryptThenSend(key, entry, content, message, thisObj, args, original)
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
              toast('BetterPrivacy: send cancelled — key locked', 'warning')
              return undefined
            }
            return encryptThenSend(unlockedKey, entry, content, message, thisObj, args, original)
          })()
        }

        // ---- 4) Encrypt mode OFF: plain passthrough ---------------------------
        return passthrough()
      } catch (err) {
        // Fail SAFE: if anything above blew up while encrypt mode is on, cancel
        // the send rather than risk leaking plaintext.
        console.error('[BetterPrivacy] send patch error', err)
        try {
          const channelId: unknown = args?.[0]
          if (typeof channelId === 'string' && ctx.keyring.isEncryptModeOn(channelId)) {
            toast('BetterPrivacy: internal error — message NOT sent', 'error')
            return Promise.resolve()
          }
        } catch {
          // Even the fail-safe check failed; fall through to passthrough below
          // (encrypt-mode state unknowable, blocking all sends would brick chat).
        }
        return passthrough()
      }
    },
  )
}
