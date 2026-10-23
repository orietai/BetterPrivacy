import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyChatBarPatch } from '../src/ui/ChatBarControls'
import { openUnlockModal, openChannelPhraseModal } from '../src/ui/UnlockModal'
import type { PluginContext } from '../src/types'

vi.mock('../src/ui/UnlockModal', () => ({ openUnlockModal: vi.fn(), openChannelPhraseModal: vi.fn() }))
const cleanups: Array<() => void> = []
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); vi.unstubAllGlobals(); vi.mocked(openUnlockModal).mockReset(); vi.mocked(openChannelPhraseModal).mockReset() })
function deferred() { let resolve!: (value: boolean) => void; const promise = new Promise<boolean>(r => { resolve = r }); return { promise, resolve } }
function nodes(tree: any): any[] {
  if (!tree || typeof tree !== 'object') return []
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  return [tree, ...nodes(tree.props?.children)]
}
function harness({ unlocked = false, reduce = false, noKey = false } = {}) {
  const dom = new JSDOM('<form><div class="channelTextArea_test"><div class="buttons_test"></div></div></form>')
  Object.defineProperty(dom.window, 'matchMedia', { value: vi.fn(() => ({ matches: reduce })) })
  const animation = { cancel: vi.fn(), onfinish: null as null | (() => void) }
  const icon = dom.window.document.createElement('span')
  icon.animate = vi.fn(() => animation as unknown as Animation)
  dom.window.document.body.append(icon)
  let component: any, mounted = false, cursor = 0, stateCursor = 0
  const refs: any[] = [], effects: Array<() => any> = [], disposals: Array<() => void> = []
  const entry = { id: 'AAAAAAAA', label: 'Team', scope: '123' }
  const state = { unlocked, mode: true, active: noKey ? null : entry.id, channel: '123' }
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('HTMLElement', dom.window.HTMLElement)
  vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('BdApi', {
    React: {
      createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }),
      useState: (initial: any) => [stateCursor++ === 0 ? true : typeof initial === 'function' ? initial() : initial, vi.fn()],
      useReducer: () => [0, vi.fn()],
      useRef: (initial: any) => { const i = cursor++; return refs[i] ??= { current: initial } },
      useEffect: (effect: () => any) => { if (!mounted) effects.push(effect) },
    },
    ReactDOM: { createPortal: (child: any) => child, createRoot: () => ({ render: (element: any) => { component = element }, unmount() {} }) },
    UI: { showToast: vi.fn() },
  })
  const ctx = { modules: { ChannelTextArea: null, failed: [], SelectedChannelStore: { getChannelId: () => state.channel } },
    keyring: { forChannel: () => noKey ? [] : [entry], get: () => entry, getActiveSendKey: () => state.active,
      setActiveSendKey: (_: string, id: string) => { state.active = id }, isEncryptModeOn: () => state.mode,
      setEncryptMode: (_: string, value: boolean) => { state.mode = value } },
    session: { revision: 0, isUnlocked: () => state.unlocked }, disposers: [], forceRerender: vi.fn(), patcher: { after: vi.fn() },
  } as unknown as PluginContext
  applyChatBarPatch(ctx)
  let tree: any
  const render = () => {
    cursor = stateCursor = 0
    tree = component.type(component.props)
    nodes(tree).find(node => node.props?.className === 'bp-bat-icon').props.ref.current = icon
    if (!mounted) { effects.forEach(effect => { const dispose = effect(); if (typeof dispose === 'function') disposals.push(dispose) }); mounted = true }
    return tree
  }
  const unmount = () => disposals.forEach(dispose => dispose())
  render()
  cleanups.push(() => { unmount(); ctx.disposers.forEach(fn => fn()); dom.window.close() })
  const button = () => nodes(tree).find(node => node.type === 'button' && node.props.className.startsWith('bp-chatbar-btn') && !node.props.className.includes('bp-key-btn'))
  return { ctx, state, entry, icon, animation, button, render, unmount }
}
async function settle() { await new Promise(resolve => setTimeout(resolve, 0)) }

describe('bat unlock feedback', () => {
  it('flutters only after a pointer unlock succeeds, using a short compositor-only effect', async () => {
    const h = harness(), gate = deferred()
    vi.mocked(openUnlockModal).mockImplementation(async () => { const ok = await gate.promise; h.state.unlocked = ok; return ok })
    h.button().props.onClick({ detail: 1 })
    expect(h.icon.animate).not.toHaveBeenCalled()
    gate.resolve(true); await settle()
    expect(h.icon.animate).toHaveBeenCalledOnce()
    const [frames, options] = vi.mocked(h.icon.animate).mock.calls[0] as any
    expect(frames.every((frame: any) => Object.keys(frame).every(key => ['transform', 'opacity', 'offset'].includes(key)))).toBe(true)
    expect(options.duration).toBeLessThanOrEqual(250)
    h.render(); window.dispatchEvent(new window.Event('bp-rerender'))
    expect(h.icon.animate).toHaveBeenCalledOnce()
    h.animation.onfinish?.()
    expect(h.animation.cancel).toHaveBeenCalledOnce()
  })

  it.each(['failed', 'reduced', 'keyboard', 'unmount', 'disable', 'channel'])('does not animate for %s unlock completion', async reason => {
    const h = harness({ reduce: reason === 'reduced' }), gate = deferred()
    vi.mocked(openUnlockModal).mockImplementation(async () => { const ok = await gate.promise; h.state.unlocked = ok; return ok })
    h.button().props.onClick({ detail: reason === 'keyboard' ? 0 : 1 })
    if (reason === 'unmount') h.unmount()
    if (reason === 'disable') h.ctx.disposers.forEach(fn => fn())
    if (reason === 'channel') h.state.channel = 'another-channel'
    gate.resolve(reason !== 'failed'); await settle()
    expect(h.icon.animate).not.toHaveBeenCalled()
  })

  it.each(['unmount', 'disable'])('cancels an active effect on %s', async reason => {
    const h = harness()
    vi.mocked(openUnlockModal).mockImplementation(async () => { h.state.unlocked = true; return true })
    h.button().props.onClick({ detail: 1 }); await settle()
    expect(h.icon.animate).toHaveBeenCalledOnce()
    if (reason === 'unmount') h.unmount()
    else h.ctx.disposers.forEach(fn => fn())
    expect(h.animation.cancel).toHaveBeenCalledOnce()
  })

  it('does not flutter on render, pause/resume or choosing an already open key', async () => {
    const h = harness({ unlocked: true })
    h.render()
    h.button().props.onClick({ detail: 1 })
    h.render(); h.button().props.onClick({ detail: 1 })
    const choice = nodes(h.render()).find(node => node.props?.className?.includes('bp-key-choice') && node.props['aria-pressed'] !== undefined)
    choice.props.onClick({ detail: 1 }); await settle()
    expect(h.icon.animate).not.toHaveBeenCalled()
    expect(openUnlockModal).not.toHaveBeenCalled()
  })

  it.each([true, false])('phrase setup animates only successful new unlocking: %s', async success => {
    const h = harness({ noKey: true })
    vi.mocked(openChannelPhraseModal).mockImplementation(async () => { h.state.unlocked = success; return success ? h.entry as any : null })
    h.button().props.onClick({ detail: 1 }); await settle()
    expect(h.icon.animate).toHaveBeenCalledTimes(success ? 1 : 0)
  })
})
