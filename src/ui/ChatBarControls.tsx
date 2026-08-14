/**
 * BetterPrivacy — the chat-bar 🦇 button (v1 simplified UX).
 *
 * ONE button, one mental model: grey = this channel isn't encrypted (click →
 * set a secret phrase, everything else is automatic), amber = phrase needed
 * (click → enter it), green = encrypted (click → pause/resume), red = the send
 * patch is broken and messages would leave as plaintext. Right-click opens a
 * small menu for the rare operations (change phrase, forget key, lock all).
 * Multi-key power flows live in Settings → Key Manager and `/enc`, off the
 * main path.
 *
 * Primary injection path: Patcher.after on the ChannelTextArea component's
 * render, splicing a <ChatBarControls/> element into the buttons row of the
 * returned React tree. Discord's internals here are fragile (see the
 * ASSUMPTIONS comments); if the tree traversal ever fails we fall back to a
 * MutationObserver that mounts a ReactDOM root directly into the chat form's
 * [class*="buttons"] element.
 */

import { PLUGIN_NAME, type PluginContext } from '../types'
import { resolveCurrentChannelId } from '../modules'
import { openChannelPhraseModal, openUnlockModal } from './UnlockModal'
import { friendlyKeyLabel } from './labels'

/** Must match RERENDER_EVENT in index.ts (ctx.forceRerender broadcast). */
const RERENDER_EVENT = 'bp-rerender'

function toast(message: string, type: 'info' | 'success' | 'warning' | 'error'): void {
  try {
    BdApi.UI.showToast(message, { type })
  } catch {
    /* feedback is best-effort */
  }
}

// ---------------------------------------------------------------------------
// The control component
// ---------------------------------------------------------------------------

function ChatBarControls({ ctx }: { ctx: PluginContext }): JSX.Element {
  const { useState, useEffect, useRef, useReducer } = BdApi.React
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const [open, setOpen] = useState(false)
  // Held in state (not read inline per render) so a CHANNEL_SELECT payload can
  // update it even when SelectedChannelStore is unavailable; seeded with the
  // store/URL-based resolver so the very first render is already correct.
  const [channelId, setChannelId] = useState(() => resolveCurrentChannelId(ctx.modules)) as [
    string | null,
    (id: string | null) => void,
  ]
  const rootRef = useRef(null)
  // The popover lives in a portal on document.body (Discord's buttons row
  // clips overflow — an in-place absolute popover shows up as a bare shadow),
  // so outside-click detection needs its ref separately from rootRef.
  const popRef = useRef(null)

  // Re-render on channel switch and on global bp-rerender broadcasts
  // (unlock/relock), so the toggle color and key label track reality.
  useEffect(() => {
    const onChannelSelect = (payload: any): void => {
      setOpen(false)
      const next = typeof payload?.channelId === 'string' && payload.channelId.length > 0
        ? payload.channelId
        : resolveCurrentChannelId(ctx.modules)
      setChannelId(next)
      bump()
    }
    const rerender = (): void => {
      setOpen(false)
      // Relock/unlock broadcasts can race channel switches; re-resolve so the
      // controls never act on a stale channel.
      setChannelId(resolveCurrentChannelId(ctx.modules))
      bump()
    }
    const dispatcher = ctx.modules.Dispatcher
    dispatcher?.subscribe?.('CHANNEL_SELECT', onChannelSelect)
    window.addEventListener(RERENDER_EVENT, rerender)
    return () => {
      dispatcher?.unsubscribe?.('CHANNEL_SELECT', onChannelSelect)
      window.removeEventListener(RERENDER_EVENT, rerender)
    }
  }, [])

  // Close the popover on any outside mousedown (outside = neither the chat-bar
  // controls nor the portaled popover itself).
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e: MouseEvent): void => {
      const rootEl = rootRef.current as HTMLElement | null
      const popEl = popRef.current as HTMLElement | null
      const target = e.target as Node
      if (rootEl?.contains(target) || popEl?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const encOn = channelId ? ctx.keyring.isEncryptModeOn(channelId) : false
  // When the send patch is broken (Discord update / missed lookup), messages
  // go out PLAINTEXT no matter what the button says — surface that instead of
  // rendering a reassuring green bat.
  const sendBroken = ctx.modules.failed.some(
    (f) => f.includes('send') || f.includes('MessageActions'),
  )
  // The channel's key: the explicit active one, else the first applicable key
  // (auto-adopted on first use so old keyrings keep working without a picker).
  const activeKeyId = channelId ? ctx.keyring.getActiveSendKey(channelId) : null
  let activeEntry = activeKeyId ? ctx.keyring.get(activeKeyId) : undefined
  if (!activeEntry && channelId) activeEntry = ctx.keyring.forChannel(channelId)[0]
  const unlocked = activeEntry ? ctx.session.isUnlocked(activeEntry.id) : false

  const noChannelToast = (): void => {
    console.warn(`[${PLUGIN_NAME}] cannot resolve the focused channel (SelectedChannelStore + URL both failed)`)
    toast('BetterPrivacy: cannot determine the current channel — try switching channels once', 'error')
  }

  const refresh = (): void => {
    bump()
    ctx.forceRerender()
  }

  /**
   * The whole v1 UX in one click: no key → set a phrase (modal arms the
   * channel end-to-end); locked → enter the phrase (arms on success);
   * unlocked → pause/resume encryption for this channel.
   */
  const onBatClick = (): void => {
    if (sendBroken) {
      toast(
        'BetterPrivacy: encryption unavailable — message interception is broken (messages would send as PLAINTEXT)',
        'error',
      )
      return
    }
    if (!channelId) {
      noChannelToast()
      return
    }
    if (!activeEntry) {
      void openChannelPhraseModal(ctx, channelId).then(() => bump())
      return
    }
    const entry = activeEntry
    if (ctx.keyring.getActiveSendKey(channelId) !== entry.id) {
      ctx.keyring.setActiveSendKey(channelId, entry.id)
    }
    if (!unlocked) {
      void openUnlockModal(ctx, entry).then((ok) => {
        if (!ok) return
        if (!ctx.keyring.isEncryptModeOn(channelId)) ctx.keyring.setEncryptMode(channelId, true)
        refresh()
      })
      return
    }
    ctx.keyring.setEncryptMode(channelId, !encOn)
    toast(
      !encOn ? '🦇 Encryption ON for this channel' : 'BetterPrivacy: encryption paused for this channel',
      !encOn ? 'success' : 'info',
    )
    // Encrypt mode also gates message/attachment display (render.ts /
    // attachments.ts) — broadcast so the visible message list flips too.
    refresh()
  }

  const changePhrase = (): void => {
    setOpen(false)
    if (!channelId) {
      noChannelToast()
      return
    }
    void openChannelPhraseModal(ctx, channelId).then(() => bump())
  }

  const forgetKey = (): void => {
    setOpen(false)
    if (!activeEntry) return
    const entry = activeEntry
    BdApi.UI.showConfirmationModal(
      '🦇 Forget key',
      `Forget ${friendlyKeyLabel(entry)} (${entry.id})? ` +
        'Nothing is lost forever — entering the same phrase again restores it exactly.',
      {
        confirmText: 'Forget',
        cancelText: 'Cancel',
        danger: true,
        onConfirm: () => {
          try {
            // Lock first so the session key and any cached plaintext for it are
            // purged (via the onRelock wiring), then drop the keyring entry.
            ctx.session.lockKey(entry.id)
            ctx.keyring.remove(entry.id)
            toast('BetterPrivacy: key forgotten', 'info')
          } catch (err) {
            console.error(`[${PLUGIN_NAME}] key removal failed`, err)
            toast('BetterPrivacy: could not forget the key', 'error')
          }
          refresh()
        },
      },
    )
  }

  const lockAllNow = (): void => {
    setOpen(false)
    try {
      ctx.session.lockAll('manual')
      toast('🦇 Everything locked', 'info')
    } catch (err) {
      console.error(`[${PLUGIN_NAME}] lock-all failed`, err)
    }
    refresh()
  }

  // Discord's chat input aggressively reclaims focus on mousedown inside the
  // form (and some builds stop propagation there). preventDefault keeps the
  // editor focused; stopPropagation keeps Discord's form handlers from
  // reacting to our controls. The actual work stays on onClick.
  const guardMouse = (e: any): void => {
    e.preventDefault()
    e.stopPropagation()
  }

  const stateClass = sendBroken
    ? ' bp-broken'
    : !activeEntry
      ? ''
      : !unlocked
        ? ' bp-locked'
        : encOn
          ? ' bp-on'
          : ''
  const title = sendBroken
    ? 'BetterPrivacy: encryption unavailable (Discord update broke message interception) — messages would send as PLAINTEXT'
    : !channelId
      ? 'BetterPrivacy: cannot determine the current channel'
      : !activeEntry
        ? 'BetterPrivacy: not encrypted — click to set a secret phrase for this channel'
        : !unlocked
          ? 'BetterPrivacy: locked — click to enter the phrase'
          : encOn
            ? 'BetterPrivacy: encrypted — click to pause · right-click for options'
            : 'BetterPrivacy: encryption paused — click to resume · right-click for options'

  return (
    <div className="bp-chatbar-controls" ref={rootRef} onMouseDown={guardMouse}>
      <button
        type="button"
        className={'bp-chatbar-btn' + stateClass}
        aria-pressed={encOn}
        title={title}
        onClick={onBatClick}
        onContextMenu={(e: any) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen(!open)
        }}
      >
        {'\u{1F987}'}
      </button>
      {open ? renderMenu() : null}
    </div>
  )

  // Rendered via portal: Discord's chat-bar containers clip overflow, so an
  // in-flow absolute popover is cut down to its box shadow. Fixed-position
  // coordinates are derived from the controls' rect at render time (the
  // popover only exists while open; scroll/resize just closes via outside
  // click, so stale coords aren't a concern).
  function renderMenu(): any {
    const anchor = rootRef.current as HTMLElement | null
    const rect = anchor?.getBoundingClientRect()
    const style = rect
      ? {
          position: 'fixed',
          bottom: Math.max(8, window.innerHeight - rect.top + 8),
          right: Math.max(8, window.innerWidth - rect.right),
          zIndex: 3000,
        }
      : { zIndex: 3000 }
    const status = sendBroken
      ? '⚠ Encryption broken (Discord update)'
      : !channelId
        ? '⚠ Cannot determine current channel'
        : !activeEntry
          ? 'This channel is not encrypted'
          : !unlocked
            ? 'Phrase needed — click the 🦇 to enter it'
            : encOn
              ? 'Encrypted & unlocked'
              : 'Encryption paused'
    return BdApi.ReactDOM.createPortal(
      (
        <div className="bp-popover" style={style} ref={popRef}>
          <div className="bp-popover-item" style={{ cursor: 'default', opacity: 0.7 }}>
            {status}
          </div>
          <div className="bp-popover-sep" />
          {channelId ? (
            <div className="bp-popover-item" onClick={changePhrase}>
              {activeEntry ? 'Change phrase…' : 'Set phrase…'}
            </div>
          ) : null}
          {activeEntry ? (
            <div className="bp-popover-item" onClick={forgetKey}>
              Forget this channel{"'"}s key
            </div>
          ) : null}
          <div className="bp-popover-item" onClick={lockAllNow}>
            Lock everything now
          </div>
          <div className="bp-popover-hint">
            Tip: <code>/pt msg</code> sends one message unencrypted {'·'} multiple keys live in
            Settings {'→'} BetterPrivacy
          </div>
        </div>
      ),
      document.body,
    )
  }
}

// ---------------------------------------------------------------------------
// React-tree injection
// ---------------------------------------------------------------------------

const INJECTED_KEY = 'bp-chatbar-controls'

/** One-shot log flag so the tree-injection breadcrumb doesn't spam per render. */
let treeInjectionLogged = false

/**
 * Depth-first search of a rendered React element tree for the chat bar's
 * buttons row: the first node whose className contains "buttons" and whose
 * children is a mutable array.
 *
 * ASSUMPTION (fragile): Discord's ChannelTextArea render output contains a
 * wrapper div with a webpack-hashed class like "buttons__74017" holding the
 * gift/GIF/sticker/emoji button cluster, and its props.children is an array
 * we can unshift into. Verified against Discord stable circa 2025/2026; if
 * the shape changes, findButtonsChildren returns null and we use the DOM
 * fallback below instead.
 */
function findButtonsChildren(node: any, depth = 0): any[] | null {
  if (!node || depth > 25) return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findButtonsChildren(child, depth + 1)
      if (found) return found
    }
    return null
  }
  const props = node.props
  if (!props) return null
  if (
    typeof props.className === 'string' &&
    props.className.includes('buttons') &&
    Array.isArray(props.children)
  ) {
    return props.children
  }
  return findButtonsChildren(props.children, depth + 1)
}

// ---------------------------------------------------------------------------
// DOM-based fallback
// ---------------------------------------------------------------------------

/**
 * Fallback when the React-tree injection point can't be found: watch the DOM
 * and mount a standalone ReactDOM root inside the chat form's buttons
 * element. The observer callback is cheap (early-returns while our host node
 * is still connected), so observing document.body with subtree:true is
 * acceptable for v1.
 */
function startDomFallback(ctx: PluginContext): void {
  let root: any = null
  let host: HTMLElement | null = null

  const unmount = (): void => {
    if (root) {
      try {
        root.unmount()
      } catch {
        /* root already torn down */
      }
      root = null
    }
    if (host) {
      host.remove()
      host = null
    }
  }

  const tryMount = (): void => {
    if (host && host.isConnected) return // still mounted, nothing to do
    unmount()
    // ASSUMPTION (fragile): the chat input form contains an element whose
    // webpack-hashed class includes "buttons" (the emoji/GIF/sticker cluster).
    const buttonsEl =
      document.querySelector('form [class*="channelTextArea"] [class*="buttons"]') ??
      document.querySelector('[class*="channelTextArea"] [class*="buttons"]')
    if (!(buttonsEl instanceof HTMLElement)) return
    // The React-tree injection may serve this composer (the fallback only
    // covers renders whose tree we couldn't traverse) — never double up.
    if (buttonsEl.querySelector('.bp-chatbar-controls')) return
    host = document.createElement('div')
    host.className = 'bp-chatbar-host'
    buttonsEl.insertBefore(host, buttonsEl.firstChild)
    root = BdApi.ReactDOM.createRoot(host)
    root.render(BdApi.React.createElement(ChatBarControls, { ctx }))
    console.info(`[${PLUGIN_NAME}] chat bar controls mounted via DOM fallback`)
  }

  // Coalesce mutation bursts into one mount attempt per frame — Discord's DOM
  // churns constantly and two full-document querySelectors per mutation batch
  // would be wasteful (same pattern as the attachments DOM fallback).
  let scheduled = false
  const observer = new MutationObserver(() => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      tryMount()
    })
  })
  observer.observe(document.body, { childList: true, subtree: true })
  tryMount()

  ctx.disposers.push(() => {
    observer.disconnect()
    unmount()
  })
}

// ---------------------------------------------------------------------------
// Contract export
// ---------------------------------------------------------------------------

export function applyChatBarPatch(ctx: PluginContext): void {
  const ChannelTextArea = ctx.modules.ChannelTextArea
  if (!ChannelTextArea) {
    ctx.modules.failed.push('chatBar')
    return
  }

  let domFallbackStarted = false
  const startFallbackOnce = (): void => {
    if (domFallbackStarted) return
    domFallbackStarted = true
    startDomFallback(ctx)
  }

  // ASSUMPTION (fragile): ChannelTextArea is typically memo(forwardRef(fn)),
  // so the patchable render function lives at .type.render; on some versions
  // the module itself is the forwardRef object (.render directly). If
  // neither shape matches we cannot Patcher.after a render and go straight
  // to the DOM fallback.
  const renderTarget =
    ChannelTextArea.type && typeof ChannelTextArea.type.render === 'function'
      ? ChannelTextArea.type
      : typeof ChannelTextArea.render === 'function'
        ? ChannelTextArea
        : null

  if (!renderTarget) {
    startFallbackOnce()
    return
  }

  // A single miss is not proof the injection point is gone — edit boxes and
  // thread composers render through the same component without a buttons
  // array. Only fall back after several consecutive misses.
  let consecutiveMisses = 0

  ctx.patcher.after(PLUGIN_NAME, renderTarget, 'render', (_thisObj, _args, ret) => {
    try {
      const buttons = findButtonsChildren(ret)
      if (buttons) {
        consecutiveMisses = 0
        const already = buttons.some((c: any) => c && c.key === INJECTED_KEY)
        if (!already) {
          buttons.unshift(BdApi.React.createElement(ChatBarControls, { ctx, key: INJECTED_KEY }))
          if (!treeInjectionLogged) {
            treeInjectionLogged = true
            console.info(`[${PLUGIN_NAME}] chat bar controls injected into the React tree`)
          }
        }
        return ret
      }
    } catch (err) {
      console.error(`[${PLUGIN_NAME}] chat bar injection failed`, err)
    }
    // Injection point not found in this render — after 3 consecutive misses,
    // switch to the DOM fallback.
    consecutiveMisses += 1
    if (consecutiveMisses >= 3) startFallbackOnce()
    return ret
  })
}
