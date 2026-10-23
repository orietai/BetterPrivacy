import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyChatBarPatch } from '../src/ui/ChatBarControls'
import type { PluginContext } from '../src/types'

const cleanup: Array<() => void> = []
afterEach(() => {
  cleanup.splice(0).reverse().forEach(fn => fn())
  vi.unstubAllGlobals()
})

function setup(markup = '<form><div class="channelTextArea_test"><div class="buttons_test"></div></div></form>') {
  const dom = new JSDOM(markup)
  const frames: Array<() => void> = []
  let mutation: (() => void) | undefined
  const disconnect = vi.fn()
  const render = vi.fn()
  const unmount = vi.fn()
  const createRoot = vi.fn(() => ({ render, unmount }))
  const after = vi.fn()
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('HTMLElement', dom.window.HTMLElement)
  vi.stubGlobal('MutationObserver', class {
    constructor(callback: () => void) { mutation = callback }
    observe() {}
    disconnect = disconnect
  })
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => { frames.push(fn); return frames.length })
  vi.stubGlobal('BdApi', {
    React: { createElement: (component: unknown, props: any, ...children: any[]) => ({ component, props: { ...props, children } }) },
    ReactDOM: { createRoot, createPortal: (child: any) => child },
  })
  const ctx = {
    modules: { ChannelTextArea: null, failed: ['ChannelTextArea'] },
    patcher: { after }, disposers: [],
  } as unknown as PluginContext
  cleanup.push(() => dom.window.close(), () => ctx.disposers.forEach(fn => fn()))
  return { ctx, dom, createRoot, render, unmount, after, disconnect,
    mutate: () => mutation?.(), flush: () => frames.splice(0).forEach(fn => fn()) }
}

describe('chat bar recovery when Discord module lookup fails', () => {
  it.each(['AAAAAAAA', null])('shows the actual sending choice %s without guessing from unlocked history', (selected) => {
    const h = setup()
    const entries = [
      { id: 'AAAAAAAA', label: 'channel:123', scope: '123' },
      { id: 'BBBBBBBB', label: 'channel:123', scope: '123' },
    ]
    let stateIndex = 0
    Object.assign(BdApi.React, {
      useState: (initial: any) => [stateIndex++ === 0 ? true : typeof initial === 'function' ? initial() : initial, vi.fn()],
      useReducer: () => [0, vi.fn()], useRef: () => ({ current: null }), useEffect: () => {},
    })
    Object.assign(h.ctx, {
      keyring: { forChannel: () => entries, getActiveSendKey: () => selected, isEncryptModeOn: () => true },
      session: { isUnlocked: () => true },
    })
    h.ctx.modules.SelectedChannelStore = { getChannelId: () => '123' }
    applyChatBarPatch(h.ctx)
    const element = h.render.mock.calls[0]![0]
    const tree = element.component(element.props)
    const nodes: any[] = []
    const visit = (node: any): void => {
      if (Array.isArray(node)) { node.forEach(visit); return }
      if (!node || typeof node !== 'object') return
      nodes.push(node); visit(node.props?.children)
    }
    visit(tree)
    const picker = nodes.find(node => node.props?.className?.includes('bp-key-btn'))
    expect(picker).toBeDefined()
    const choices = nodes.filter(node => node.component === 'button' && node.props?.className?.includes('bp-key-choice') && node.props['aria-pressed'] !== undefined)
    expect(choices).toHaveLength(2)
    expect(choices.map(node => node.props['aria-pressed'])).toEqual([selected !== null, false])
    const text = JSON.stringify(picker.props.children)
    expect(text.includes('AAAAAAAA')).toBe(selected !== null)
    expect(text).not.toContain('BBBBBBBB')
  })

  it('mounts DOM controls even when ChannelTextArea is missing', () => {
    const h = setup()
    applyChatBarPatch(h.ctx)
    expect(h.createRoot).toHaveBeenCalledOnce()
    expect(h.render).toHaveBeenCalledOnce()
    expect(h.dom.window.document.querySelector('.bp-chatbar-host')).not.toBeNull()
    expect(h.after).not.toHaveBeenCalled()
    expect(h.ctx.modules.failed).toEqual([])
  })

  it('does not double-mount during retries or later lookup recovery', () => {
    const h = setup()
    applyChatBarPatch(h.ctx)
    applyChatBarPatch(h.ctx)
    h.ctx.modules.ChannelTextArea = { render() {} }
    applyChatBarPatch(h.ctx)
    expect(h.createRoot).toHaveBeenCalledOnce()
    expect(h.ctx.modules.failed).toEqual([])
    expect(h.after).not.toHaveBeenCalled()
  })

  it('keeps sending and upload failures visible when chat controls recover', () => {
    const h = setup()
    h.ctx.modules.failed.push('send: MessageActions unavailable', 'upload: CloudUpload unavailable')
    applyChatBarPatch(h.ctx)
    expect(h.ctx.modules.failed).toEqual(['send: MessageActions unavailable', 'upload: CloudUpload unavailable'])
  })

  it('waits for a lazy composer and coalesces DOM mutations', () => {
    const h = setup('')
    applyChatBarPatch(h.ctx)
    expect(h.createRoot).not.toHaveBeenCalled()
    expect(h.ctx.modules.failed).toContain('chatBar')
    h.dom.window.document.body.innerHTML = '<div class="channelTextArea_test"><div class="buttons_test"></div></div>'
    h.mutate()
    h.mutate()
    h.flush()
    expect(h.createRoot).toHaveBeenCalledOnce()
    expect(h.ctx.modules.failed).toEqual([])
  })

  it('cleans up roots and cannot remount from a queued frame after stop', () => {
    const h = setup()
    applyChatBarPatch(h.ctx)
    h.mutate()
    h.ctx.disposers.splice(0).forEach(fn => fn())
    h.flush()
    expect(h.disconnect).toHaveBeenCalledOnce()
    expect(h.unmount).toHaveBeenCalledOnce()
    expect(h.dom.window.document.querySelector('.bp-chatbar-host')).toBeNull()
    expect(h.createRoot).toHaveBeenCalledOnce()
  })
})
