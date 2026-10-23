/**
 * patches/render.ts — incoming message render patch (spec §6, "Receive/render").
 *
 * Patcher.after on the message content component. modules.ts normalizes
 * MessageContent to { module, method } where module[method] is the concrete
 * render function — memo(fn), memo(forwardRef(fn)) and bare-function shapes
 * all reduce to that. If modules.ts found nothing, this patch degrades to a
 * no-op and pushes onto modules.failed.
 *
 * Golden rule (spec §2): the Flux store is never mutated with plaintext.
 * message.content stays ciphertext forever; decryption exists only in this
 * render layer, memoized in the (memory-only) DecryptCache. Re-locking is then
 * just "purge cache + force re-render".
 *
 * Async-vs-sync bridge: render is synchronous, AES-GCM decryption is not. Wire
 * messages are therefore swapped for a small wrapper component that renders
 * synchronously from the cache when possible and otherwise kicks decryption in
 * an effect, re-rendering itself when the plaintext lands.
 */

import type { CacheEntry, KeyEntry, PluginContext, WireParts } from '../types'
import { decryptText } from '../crypto/cipher'
import { parseWire } from '../crypto/wire'
import { openRecoverKeyModal, openUnlockModal } from '../ui/UnlockModal'
import { t } from '../i18n'

/** Keep in sync with RERENDER_EVENT in index.ts (not exported from there). */
const RERENDER_EVENT = 'bp-rerender'

interface EncryptedContentProps {
  ctx: PluginContext
  parts: WireParts
  /** Raw wire-format ciphertext, shown when the unknown-key chip is expanded. */
  rawContent: string
  channelId: string | undefined
  cacheKey: string
}

/**
 * Feeds decrypted plaintext through Discord's own markdown parser so every
 * text-level feature (code blocks, spoilers, custom emoji, mention syntax…)
 * renders natively (spec §6 "Rich content rendering"). Falls back to the raw
 * string if the parser is missing or throws.
 */
function renderMarkdown(ctx: PluginContext, text: string, channelId: string | undefined): any {
  const parser = ctx.modules.MarkdownParser
  try {
    if (parser && typeof parser.parse === 'function') {
      return parser.parse(text, true, { channelId, allowLinks: true, inline: false })
    }
  } catch {
    // Parser shape changed — plain text below is a safe degradation.
  }
  return text
}

function EncryptedContent(props: EncryptedContentProps): any {
  const React = BdApi.React
  const { ctx, parts, cacheKey } = props

  // Local re-render bump; also the hook the global rerender broadcast drives.
  const [, bump] = React.useReducer((n: number) => n + 1, 0)
  const [expanded, setExpanded] = React.useState(false)

  // All Discord/plugin state reads are defensive — a throwing keyring/cache
  // must degrade to the locked chip, not crash the message list.
  let entry: KeyEntry | undefined
  let cached: CacheEntry | undefined
  let key: CryptoKey | null = null
  try {
    entry = ctx.keyring.get(parts.keyId)
    cached = ctx.cache.get(cacheKey)
    // session.getKey touches lastUsedAt on hit — visible decrypted messages
    // implicitly keep their key from idle-expiring (spec §7).
    key = entry ? ctx.session.getKey(parts.keyId) : null
  } catch {
    entry = undefined
    cached = undefined
    key = null
  }

  // Re-render on the global relock/unlock broadcast (ctx.forceRerender()).
  React.useEffect(() => {
    const handler = (): void => bump()
    window.addEventListener(RERENDER_EVENT, handler)
    return () => window.removeEventListener(RERENDER_EVENT, handler)
  }, [])

  // Encrypt-mode is a per-channel DISPLAY gate as well as a send gate: with
  // the toggle off, encrypted messages render as locked chips even while the
  // key stays unlocked in the session (so re-enabling restores plaintext
  // without a passphrase). Unknown channel id → don't gate.
  let modeOn = true
  try {
    if (props.channelId) modeOn = ctx.keyring.isEncryptModeOn(props.channelId)
  } catch {
    modeOn = true
  }

  // Cache miss with an unlocked key: decrypt asynchronously, then re-render.
  // Key identity is a dependency so a re-unlock replaces cancelled work.
  // modeOn must be a dep: the effect early-returns while
  // the mode is off, so toggling it back ON has to re-run the effect or the
  // message sticks on "Decrypting…" until remount.
  const cachedPresent = cached !== undefined
  React.useEffect(() => {
    if (!modeOn || cachedPresent || !key) return
    let cancelled = false
    decryptText(key, parts.iv, parts.ciphertext).then(
      (text: string) => {
        if (cancelled || ctx.session.getKey(parts.keyId) !== key) return
        try {
          ctx.cache.set(cacheKey, { kind: 'text', text, keyId: parts.keyId })
        } catch {
          // Cache write failed — the bump below re-renders without it; the
          // effect will simply retry on the next mount.
        }
        bump()
      },
      () => {
        // GCM auth failure (tampered ciphertext or wrong key) — cache it so we
        // don't retry on every render (CacheEntry kind 'failed').
        if (cancelled || ctx.session.getKey(parts.keyId) !== key) return
        try {
          ctx.cache.set(cacheKey, { kind: 'failed', keyId: parts.keyId })
        } catch {
          // Ignore; worst case the failure chip is recomputed next render.
        }
        bump()
      },
    )
    return () => {
      cancelled = true
    }
  }, [cacheKey, cachedPresent, key, modeOn, parts.iv, parts.ciphertext])

  // ---- Render states (spec §6 steps 1–5) -----------------------------------

  // Encrypt mode off for this channel: uniform locked chip regardless of key
  // state; clicking re-enables the mode (no passphrase needed — the key is
  // still unlocked in the session).
  if (!modeOn) {
    return React.createElement(
      'span',
      {
        className: 'bp-chip bp-chip-locked',
        role: 'button',
        tabIndex: 0,
        title: t('chip.modeOffTitle'),
        onClick: () => {
          try {
            if (props.channelId) {
              ctx.keyring.setEncryptMode(props.channelId, true)
              ctx.forceRerender()
            }
          } catch {
            // keyring write failed — chip stays, user can retry
          }
        },
      },
      t('chip.modeOff'),
    )
  }

  // Decrypted (cache hit). The 🦇 marker comes from the stylesheet's
  // .bp-decrypted::before — no inline glyph, or it would render twice.
  if (cached?.kind === 'text') {
    return React.createElement(
      'span',
      {
        className: 'bp-decrypted',
        title: entry ? t('chip.encryptedWith', { label: entry.label }) : undefined,
      },
      renderMarkdown(ctx, cached.text, props.channelId),
    )
  }

  // Previous GCM auth failure — warn, don't retry.
  if (cached?.kind === 'failed') {
    return React.createElement(
      'span',
      { className: 'bp-failed' },
      t('chip.failed'),
    )
  }

  // Unknown key: chip; click opens the recover-key modal (keys derive from
  // label + passphrase, so typing the original pair restores the key on the
  // spot). Alt-click toggles the raw ciphertext instead.
  if (!entry) {
    return React.createElement(
      'span',
      {
        className: 'bp-chip bp-chip-unknown',
        role: 'button',
        tabIndex: 0,
        title: t('chip.unknownTitle'),
        onClick: (e: any) => {
          if (e?.altKey) {
            setExpanded((v: boolean) => !v)
            return
          }
          openRecoverKeyModal(ctx, parts, props.channelId ?? null,
            (key) => decryptText(key, parts.iv, parts.ciphertext)).catch(() => {
            // Modal failed to open/resolve — chip stays, user can retry.
          })
        },
      },
      expanded ? props.rawContent : t('chip.unknown', { keyId: parts.keyId }),
    )
  }

  // Known but locked: chip, click opens the unlock modal.
  if (!key) {
    return React.createElement(
      'span',
      {
        className: 'bp-chip bp-chip-locked',
        role: 'button',
        tabIndex: 0,
        onClick: () => {
          openUnlockModal(ctx, entry as KeyEntry)
            .then((ok: boolean) => {
              if (ok) ctx.forceRerender()
            })
            .catch(() => {
              // Modal failed to open/resolve — chip stays, user can retry.
            })
        },
      },
      t('chip.locked', { label: entry.label }),
    )
  }

  // Unlocked, decryption in flight (effect above will bump when done).
  return React.createElement('span', { className: 'bp-chip' }, t('chip.decrypting'))
}

export function applyRenderPatch(ctx: PluginContext): void {
  const { modules } = ctx
  const target = modules.MessageContent

  if (!target?.module || typeof target.module[target.method] !== 'function') {
    modules.failed.push('render: MessageContent component unavailable')
    return
  }

  ctx.patcher.after('render', target.module, target.method, (_thisObj: any, args: any[], ret: any) => {
    try {
      const message = args?.[0]?.message
      const content: unknown = message?.content
      if (typeof content !== 'string' || content.length === 0) return ret

      // parseWire is silently null on anything malformed, so ordinary messages
      // (even ones containing the 🔐 emoji) pass through untouched.
      const parts = parseWire(content)
      if (!parts) return ret

      // Edits re-key the cache: editedTimestamp is a Moment/Date on live
      // messages, an ISO string on some gateway shapes, or null.
      const editTs = message.editedTimestamp?.valueOf?.() ?? message.editedTimestamp ?? null
      const cacheKey = ctx.cache.key(String(message.id ?? ''), editTs)

      return BdApi.React.createElement(EncryptedContent, {
        key: cacheKey,
        ctx,
        parts,
        rawContent: content,
        channelId: message.channel_id ?? message.channelId,
        cacheKey,
      })
    } catch (err) {
      // Never break the message list — fall back to the original (ciphertext) render.
      console.error('[BetterPrivacy] render patch error', err)
      return ret
    }
  })
}
