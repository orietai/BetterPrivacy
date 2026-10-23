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
import { selectSendKey } from '../core/sendKey'
import { sendKeyLabel } from '../ui/labels'
import { resolveCurrentChannelId } from '../modules'

/** Keep in sync with RERENDER_EVENT in index.ts (not exported from there). */
const RERENDER_EVENT = 'bp-rerender'

function activateChip(event: any): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    event.currentTarget.click()
  }
}

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
    const current = (): boolean => {
      try {
        return !cancelled && ctx.session.getKey(parts.keyId) === key &&
          !!ctx.keyring.get(parts.keyId) && (!props.channelId || ctx.keyring.isEncryptModeOn(props.channelId))
      } catch { return false }
    }
    decryptText(key, parts.iv, parts.ciphertext).then(
      (text: string) => {
        if (!current()) return
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
        if (!current()) return
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
        onKeyDown: activateChip,
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
  if (entry && key && cached?.kind === 'text') {
    return React.createElement(
      'span',
      {
        className: 'bp-decrypted',
        title: entry ? t('chip.encryptedWith', { label: entry.label }) : undefined,
      },
      renderMarkdown(ctx, cached.text, props.channelId),
      entry && props.channelId && ctx.keyring.getActiveSendKey(props.channelId) !== entry.id
        ? React.createElement('button', {
            type: 'button', className: 'bp-reply-key', title: t('sending.replyHint'),
            onClick: async (event: any) => {
              event.stopPropagation()
              try {
                const ok = await selectSendKey(ctx, props.channelId!, parts.keyId, candidate => openUnlockModal(ctx, candidate))
                if (!ok) return
                BdApi.UI.showToast(t('sending.selected', { label: sendKeyLabel(entry!) }), { type: 'success' })
                if (resolveCurrentChannelId(ctx.modules) === props.channelId) {
                  document.querySelector<HTMLElement>('[class*="channelTextArea"] [role="textbox"][contenteditable="true"]')?.focus()
                }
              } catch {
                BdApi.UI.showToast(t('sending.failed'), { type: 'error' })
              }
            },
          }, t('sending.reply'))
        : null,
    )
  }

  // Previous GCM auth failure — warn, don't retry.
  if (entry && key && cached?.kind === 'failed') {
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
        onKeyDown: activateChip,
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
        onKeyDown: activateChip,
        onClick: () => {
          // Verify the phrase against this actual envelope, not solely the
          // saved salt/KCV. This also safely repairs stale local metadata.
          openRecoverKeyModal(ctx, parts, props.channelId ?? null,
            candidate => decryptText(candidate, parts.iv, parts.ciphertext))
            .then((ok: boolean) => {
              if (ok) ctx.forceRerender()
            })
            .catch(() => {
              // Modal failed to open/resolve — chip stays, user can retry.
            })
        },
      },
      t('chip.locked', { label: sendKeyLabel(entry) }),
    )
  }

  // Unlocked, decryption in flight (effect above will bump when done).
  return React.createElement('span', { className: 'bp-chip' }, t('chip.decrypting'))
}

export function applyRenderPatch(ctx: PluginContext): void {
  startRenderRecovery(ctx)
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
      // Optimistic/gateway edits can replace content before editedTimestamp
      // changes. Bind both React and cache identity to the exact encrypted
      // envelope so an old plaintext/auth-failure entry cannot mask a new edit.
      // This suffix is ciphertext only; never hash away identity into a lossy
      // short key that could collide and display another edit's plaintext.
      const cacheKey = `${ctx.cache.key(String(message.id ?? ''), editTs)}:${content}`

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

const recoveryOwners = new WeakSet<PluginContext>()

/** Discord can retain an old memoized render function after an edit. Recover
 * raw wire nodes with a separate root; never mutate its message/Flux record. */
export function startRenderRecovery(ctx: PluginContext): void {
  if (typeof document === 'undefined' || !BdApi.ReactDOM?.createRoot || recoveryOwners.has(ctx)) return
  recoveryOwners.add(ctx)
  type Mount = { host: HTMLElement; root: any; display: string; content: string }
  const mounts = new Map<HTMLElement, Mount>()
  let stopped = false
  let frame: number | null = null
  const remove = (node: HTMLElement, mount: Mount): void => {
    mounts.delete(node)
    try { mount.root.unmount() } finally { mount.host.remove(); node.style.display = mount.display }
  }
  const scan = (): void => {
    frame = null
    if (stopped) return
    const seen = new Set<HTMLElement>()
    const channelId = resolveCurrentChannelId(ctx.modules)
    if (channelId) for (const node of document.querySelectorAll<HTMLElement>('[id^="message-content-"]')) {
      if (node.closest('.bp-text-host') || node.querySelector('.bp-decrypted,.bp-chip,.bp-failed')) continue
      const id = node.id.slice('message-content-'.length)
      const message = ctx.modules.MessageStore?.getMessage?.(channelId, id)
      const content = message?.content
      const parts = typeof content === 'string' ? parseWire(content) : null
      if (!parts || !node.parentElement) continue
      // A substring/link inside an ordinary message is never enough. Both
      // the store envelope and the displayed anchor must agree exactly.
      const matches = [...node.querySelectorAll<HTMLAnchorElement>('a[href]')].some(anchor => {
        const candidate = parseWire(anchor.href)
        return candidate && candidate.keyId === parts.keyId && candidate.salt === parts.salt &&
          candidate.iv === parts.iv && candidate.ciphertext === parts.ciphertext
      })
      if (!matches) continue
      seen.add(node)
      let mount = mounts.get(node)
      if (mount && (!mount.host.isConnected || mount.host.parentElement !== node.parentElement)) {
        remove(node, mount); mount = undefined
      }
      if (!mount) {
        const host = document.createElement('span')
        host.className = 'bp-text-host'
        node.insertAdjacentElement('afterend', host)
        mount = { host, root: BdApi.ReactDOM.createRoot(host), display: node.style.display, content: '' }
        mounts.set(node, mount)
      }
      if (mount.content !== content) {
        const editTs = message.editedTimestamp?.valueOf?.() ?? null
        const cacheKey = `${ctx.cache.key(id, editTs)}:${content}`
        mount.root.render(BdApi.React.createElement(EncryptedContent, {
          key: cacheKey, ctx, parts, rawContent: content, channelId, cacheKey,
        }))
        mount.content = content
      }
      node.style.display = 'none'
    }
    for (const [node, mount] of mounts) if (!node.isConnected || !seen.has(node)) remove(node, mount)
  }
  const schedule = (): void => {
    if (!stopped && frame === null) frame = requestAnimationFrame(() => {
      try { scan() } catch { /* Next mutation can retry; keep Discord usable. */ }
    })
  }
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['href'] })
  window.addEventListener('bp-rerender', schedule)
  const store = ctx.modules.MessageStore
  const listen = typeof store?.addChangeListener === 'function' && typeof store?.removeChangeListener === 'function'
  if (listen) store.addChangeListener(schedule)
  ctx.disposers.push(() => {
    stopped = true
    observer.disconnect()
    window.removeEventListener('bp-rerender', schedule)
    if (listen) store.removeChangeListener(schedule)
    if (frame !== null) cancelAnimationFrame(frame)
    for (const [node, mount] of mounts) remove(node, mount)
    recoveryOwners.delete(ctx)
  })
  schedule()
}
