import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startRenderRecovery } from '../src/patches/render'
import { encodeWire } from '../src/crypto/wire'
import type { PluginContext } from '../src/types'

const cleanups: Array<() => void> = []
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); vi.unstubAllGlobals() })
function harness() {
  const dom = new JSDOM('<div><div id="message-content-123" style="display:block"></div></div>')
  const node = dom.window.document.getElementById('message-content-123')!
  const wire = (ct: string) => encodeWire({ keyId: 'AAAAAAAA', salt: 'A'.repeat(22), iv: 'A'.repeat(16), ciphertext: ct })
  const message = { id: '123', content: wire('AAAA'), editedTimestamp: null }
  const display = () => {
    const a = dom.window.document.createElement('a')
    a.href = message.content.slice(3, -1)
    a.textContent = a.href
    node.replaceChildren(a, dom.window.document.createTextNode(' (edited)'))
  }
  display()
  const frames: Array<() => void> = []
  let mutation!: () => void
  let storeChanged!: () => void
  const render = vi.fn(), unmount = vi.fn(), removeChangeListener = vi.fn()
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('MutationObserver', class { constructor(cb: () => void) { mutation = cb } observe() {} disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { frames.push(cb); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('BdApi', { React: { createElement: (type: any, props: any) => ({ type, props }) }, ReactDOM: { createRoot: () => ({ render, unmount }) } })
  const ctx = { modules: { SelectedChannelStore: { getChannelId: () => 'channel' }, MessageStore: {
    getMessage: () => message, addChangeListener: (cb: () => void) => { storeChanged = cb }, removeChangeListener,
  } }, cache: { key: (id: string) => id }, disposers: [] } as unknown as PluginContext
  const flush = () => frames.splice(0).forEach(cb => cb())
  startRenderRecovery(ctx)
  cleanups.push(() => { ctx.disposers.forEach(fn => fn()); dom.window.close() })
  return { dom, node, message, wire, display, render, unmount, ctx, flush, mutation: () => mutation(), storeChanged: () => storeChanged(), removeChangeListener }
}

describe('mounted Discord edit recovery', () => {
  it('replaces raw edited URLs without channel navigation and updates the same DOM node on another edit', () => {
    const h = harness()
    h.flush()
    expect(h.node.style.display).toBe('none')
    expect(h.render).toHaveBeenCalledOnce()
    expect(h.render.mock.calls[0][0].props.rawContent).toBe(h.message.content)
    const oldKey = h.render.mock.calls[0][0].props.key
    h.message.content = h.wire('BBBB')
    h.display(); h.mutation(); h.flush()
    expect(h.render).toHaveBeenCalledTimes(2)
    expect(h.render.mock.calls[1][0].props.key).not.toBe(oldKey)
    h.mutation(); h.flush()
    expect(h.render).toHaveBeenCalledTimes(2)
    expect(h.dom.window.document.querySelectorAll('.bp-text-host')).toHaveLength(1)
  })

  it('waits for the store and visible link to agree, then reacts to store changes', () => {
    const h = harness()
    const next = h.wire('BBBB')
    h.node.querySelector('a')!.href = next.slice(3, -1)
    h.flush()
    expect(h.render).not.toHaveBeenCalled()
    h.message.content = next; h.storeChanged(); h.flush()
    expect(h.render).toHaveBeenCalledOnce()
  })

  it('does not replace links embedded in ordinary text and restores native rendering on stop', () => {
    const h = harness()
    h.message.content = 'ordinary ' + h.message.content
    h.flush()
    expect(h.render).not.toHaveBeenCalled()
    h.message.content = h.wire('AAAA'); h.storeChanged(); h.flush()
    h.ctx.disposers.forEach(fn => fn())
    expect(h.node.style.display).toBe('block')
    expect(h.dom.window.document.querySelector('.bp-text-host')).toBeNull()
    h.mutation(); h.flush()
    expect(h.render).toHaveBeenCalledOnce()
    expect(h.removeChangeListener).toHaveBeenCalled()
  })

  it('removes fallback output when Discord starts rendering the plugin component itself', () => {
    const h = harness(); h.flush()
    const chip = h.dom.window.document.createElement('span'); chip.className = 'bp-chip'
    h.node.replaceChildren(chip); h.mutation(); h.flush()
    expect(h.unmount).toHaveBeenCalledOnce()
    expect(h.node.style.display).toBe('block')
  })
})
