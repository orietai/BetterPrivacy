/**
 * BetterPrivacy — the chat-bar 🦇 button (v1 simplified UX).
 *
 * A bat toggle plus a visible sending-key picker: grey = not encrypted (click →
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
import { friendlyKeyLabel, sendKeyLabel } from './labels'
import { resolveSendKey, selectSendKey } from '../core/sendKey'
import { t } from '../i18n'

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
    const focusFrame = requestAnimationFrame(() => {
      (popRef.current as HTMLElement | null)?.querySelector<HTMLElement>('button:not(:disabled)')?.focus()
    })
    return () => {
      document.removeEventListener('mousedown', onDown)
      cancelAnimationFrame(focusFrame)
    }
  }, [open])

  const encOn = channelId ? ctx.keyring.isEncryptModeOn(channelId) : false
  // When the send patch is broken (Discord update / missed lookup), messages
  // go out PLAINTEXT no matter what the button says — surface that instead of
  // rendering a reassuring green bat.
  const sendBroken = ctx.modules.failed.some(
    (f) => /send|MessageActions|upload|CloudUpload/i.test(f),
  )
  const availableKeys = channelId ? ctx.keyring.forChannel(channelId) : []
  // Use precisely the same policy as text/file sending: never the first of
  // several keys, and never whichever key was most recently opened to read.
  const activeEntry = channelId ? resolveSendKey(ctx.keyring, channelId) : undefined
  const unlocked = activeEntry ? ctx.session.isUnlocked(activeEntry.id) : false

  const noChannelToast = (): void => {
    console.warn(`[${PLUGIN_NAME}] cannot resolve the focused channel (SelectedChannelStore + URL both failed)`)
    toast(t('bar.noChannel'), 'error')
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
      if (channelId && encOn) {
        ctx.keyring.setEncryptMode(channelId, false)
        toast(t('bar.encPaused'), 'info')
        refresh()
        return
      }
      toast(t('bar.broken'), 'error')
      return
    }
    if (!channelId) {
      noChannelToast()
      return
    }
    if (!activeEntry) {
      if (availableKeys.length > 1) { setOpen(true); return }
      void openChannelPhraseModal(ctx, channelId).then(() => bump())
      return
    }
    const entry = activeEntry
    if (!unlocked) {
      void chooseKey(entry.id)
      return
    }
    if (ctx.keyring.getActiveSendKey(channelId) !== entry.id) {
      ctx.keyring.setActiveSendKey(channelId, entry.id)
    }
    ctx.keyring.setEncryptMode(channelId, !encOn)
    toast(!encOn ? t('bar.encOn') : t('bar.encPaused'), !encOn ? 'success' : 'info')
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

  const chooseKey = async (id: string): Promise<void> => {
    if (!channelId) return
    setOpen(false)
    try {
      const ok = await selectSendKey(ctx, channelId, id, entry => openUnlockModal(ctx, entry))
      if (ok) {
        const entry = ctx.keyring.get(id)
        if (entry) toast(t('sending.selected', { label: sendKeyLabel(entry) }), 'success')
      } else if (sendBroken) toast(t('bar.broken'), 'error')
    } catch {
      toast(t('sending.failed'), 'error')
    }
    bump()
  }

  const forgetKey = (): void => {
    setOpen(false)
    if (!activeEntry) return
    const entry = activeEntry
    BdApi.UI.showConfirmationModal(
      t('bar.forgetTitle'),
      t('bar.forgetBody', { label: friendlyKeyLabel(entry), id: entry.id }),
      {
        confirmText: t('common.forget'),
        cancelText: t('common.cancel'),
        danger: true,
        onConfirm: () => {
          try {
            // Lock first so the session key and any cached plaintext for it are
            // purged (via the onRelock wiring), then drop the keyring entry.
            ctx.session.lockKey(entry.id)
            ctx.keyring.remove(entry.id)
            toast(t('bar.forgotten'), 'info')
          } catch (err) {
            console.error(`[${PLUGIN_NAME}] key removal failed`, err)
            toast(t('bar.forgetFailed'), 'error')
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
      toast(t('bar.lockedAll'), 'info')
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
    ? t('bar.title.broken')
    : !channelId
      ? t('bar.title.noChannel')
      : !activeEntry
        ? availableKeys.length > 1 ? t('sending.choose') : t('bar.title.noKey')
        : !unlocked
          ? t('bar.title.locked')
          : encOn
            ? t('bar.title.on')
            : t('bar.title.paused')

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
      <button
        type="button"
        className={'bp-chatbar-btn bp-key-btn' + stateClass}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t('sending.picker')}
        title={activeEntry ? t(encOn ? 'sending.with' : 'sending.paused', { label: sendKeyLabel(activeEntry) }) : t('sending.choose')}
        onClick={() => setOpen(!open)}
      >
        <span>{activeEntry ? sendKeyLabel(activeEntry) : t('sending.choose')}</span>
        <span aria-hidden="true"> ▾</span>
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
      ? t('menu.status.broken')
      : !channelId
        ? t('menu.status.noChannel')
        : !activeEntry
          ? availableKeys.length > 1 ? t('sending.choose') : t('menu.status.notEncrypted')
          : !unlocked
            ? t('menu.status.needPhrase')
            : encOn
              ? t('menu.status.on')
              : t('menu.status.paused')
    return BdApi.ReactDOM.createPortal(
      (
        <div className="bp-popover" style={style} ref={popRef} role="dialog" aria-label={t('sending.picker')}
          onKeyDown={(e: any) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              setOpen(false)
              const controls = rootRef.current as HTMLElement | null
              controls?.querySelector<HTMLElement>('.bp-key-btn')?.focus()
            }
          }}>
          <div className="bp-popover-item" style={{ cursor: 'default', opacity: 0.7 }}>
            {status}
          </div>
          <div className="bp-popover-sep" />
          <div className="bp-popover-hint">{t('sending.hint')}</div>
          <div role="group" aria-label={t('sending.picker')}>
            {availableKeys.map(entry => (
              <button type="button" key={entry.id}
                className={'bp-popover-item bp-key-choice' + (activeEntry?.id === entry.id ? ' bp-active' : '')}
                aria-pressed={activeEntry?.id === entry.id}
                disabled={sendBroken}
                onClick={() => void chooseKey(entry.id)}>
                <span aria-hidden="true">{activeEntry?.id === entry.id ? '✓' : ctx.session.isUnlocked(entry.id) ? '○' : '🔒'}</span>
                <span>{sendKeyLabel(entry)}</span>
              </button>
            ))}
          </div>
          {channelId ? (
            <button type="button" className="bp-popover-item bp-key-choice" onClick={changePhrase}>
              {availableKeys.length ? t('sending.newPhrase') : t('menu.setPhrase')}
            </button>
          ) : null}
          {activeEntry ? (
            <button type="button" className="bp-popover-item bp-key-choice" onClick={forgetKey}>
              {t('menu.forgetChannelKey')}
            </button>
          ) : null}
          <button type="button" className="bp-popover-item bp-key-choice" onClick={lockAllNow}>
            {t('menu.lockNow')}
          </button>
          <div className="bp-popover-hint">{t('menu.tip')}</div>
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

// Module lookups can recover after startup. Keep one DOM observer per plugin
// context so retrying the patch cannot mount duplicate controls.
const domFallbackContexts = new WeakSet<PluginContext>()

function clearChatBarFailure(ctx: PluginContext): void {
  // A working DOM mount replaces the optional webpack injection point. Keep
  // unrelated sending/upload failures visible; clear only this feature.
  for (let i = ctx.modules.failed.length - 1; i >= 0; i--) {
    if (ctx.modules.failed[i] === 'ChannelTextArea' || ctx.modules.failed[i] === 'chatBar') {
      ctx.modules.failed.splice(i, 1)
    }
  }
}

/**
 * Fallback when the React-tree injection point can't be found: watch the DOM
 * and mount a standalone ReactDOM root inside the chat form's buttons
 * element. The observer callback is cheap (early-returns while our host node
 * is still connected), so observing document.body with subtree:true is
 * acceptable for v1.
 */
function startDomFallback(ctx: PluginContext): void {
  if (domFallbackContexts.has(ctx)) return
  domFallbackContexts.add(ctx)
  let disposed = false
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
    if (disposed) return
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
    if (buttonsEl.querySelector('.bp-chatbar-controls')) {
      clearChatBarFailure(ctx)
      return
    }
    host = document.createElement('div')
    host.className = 'bp-chatbar-host'
    buttonsEl.insertBefore(host, buttonsEl.firstChild)
    root = BdApi.ReactDOM.createRoot(host)
    root.render(BdApi.React.createElement(ChatBarControls, { ctx }))
    clearChatBarFailure(ctx)
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
    disposed = true
    observer.disconnect()
    unmount()
    domFallbackContexts.delete(ctx)
  })
}

// ---------------------------------------------------------------------------
// Shared render-target resolution
// ---------------------------------------------------------------------------

/**
 * Finds the object that actually OWNS ChannelTextArea's render function, i.e.
 * the thing a Patcher call has to be pointed at.
 *
 * ASSUMPTION (fragile): ChannelTextArea is typically memo(forwardRef(fn)), so
 * the patchable render lives at `.type.render`; on some versions the module
 * itself is the forwardRef object (`.render` directly). Returns null when
 * neither shape matches — then no render patch of any kind is possible and
 * callers must degrade (this file goes to its DOM fallback; composerLimit.ts
 * simply skips the paste-prompt raise).
 *
 * EXPORTED because composerLimit.ts patches the SAME render function (a
 * Patcher.before that raises `uploadPromptCharacterCount` while a channel is
 * encrypted). Sharing this six-line probe was chosen over duplicating it: it
 * keeps ONE description of Discord's component shape, so a future Discord
 * refactor is fixed in one place instead of two that can silently drift — and
 * it needs no restructuring here, since the existing lookup was already this
 * self-contained expression. patches/* already import from ui/* (send, render,
 * upload and attachments all pull in ui/UnlockModal), so the direction of this
 * import introduces nothing new.
 */
export function resolveTextAreaRenderTarget(ChannelTextArea: any): any | null {
  if (!ChannelTextArea) return null
  if (ChannelTextArea.type && typeof ChannelTextArea.type.render === 'function') {
    return ChannelTextArea.type
  }
  if (typeof ChannelTextArea.render === 'function') return ChannelTextArea
  return null
}

// ---------------------------------------------------------------------------
// Contract export
// ---------------------------------------------------------------------------

export function applyChatBarPatch(ctx: PluginContext): void {
  let domFallbackStarted = false
  const startFallbackOnce = (): void => {
    if (domFallbackStarted) return
    domFallbackStarted = true
    startDomFallback(ctx)
  }

  // Do not re-add an obsolete lookup failure on a retry after a DOM mount.
  if (domFallbackContexts.has(ctx)) return
  const ChannelTextArea = ctx.modules.ChannelTextArea
  if (!ChannelTextArea) {
    if (!ctx.modules.failed.includes('chatBar')) ctx.modules.failed.push('chatBar')
    startFallbackOnce()
    return
  }
  // See resolveTextAreaRenderTarget above for the component-shape assumption.
  // If neither shape matches we cannot Patcher.after a render and go straight
  // to the DOM fallback.
  const renderTarget = resolveTextAreaRenderTarget(ChannelTextArea)

  if (!renderTarget) {
    startFallbackOnce()
    return
  }

  // A single miss is not proof the injection point is gone — edit boxes and
  // thread composers render through the same component without a buttons
  // array. Only fall back after several consecutive misses.
  let consecutiveMisses = 0

  ctx.patcher.after(PLUGIN_NAME, renderTarget, 'render', (_thisObj, _args, ret) => {
    if (domFallbackContexts.has(ctx)) return ret
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
