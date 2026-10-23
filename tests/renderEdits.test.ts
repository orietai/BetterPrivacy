import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyRenderPatch } from '../src/patches/render'
import { createDecryptCache } from '../src/core/decryptCache'
import { DEFAULT_SETTINGS } from '../src/settings'
import { deriveKeyMaterial, deriveSaltFromLabel } from '../src/crypto/kdf'
import { encryptText } from '../src/crypto/cipher'
import { encodeWire } from '../src/crypto/wire'
import type { PluginContext } from '../src/types'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function harness() {
  const salt = await deriveSaltFromLabel('render-regression')
  const material = await deriveKeyMaterial('synthetic render regression phrase', salt)
  const entry = { id: material.keyId, salt, label: 'test', check: material.kcv, scope: 'channel', createdAt: 0 }
  const cache = createDecryptCache({ get: () => DEFAULT_SETTINGS } as any)
  let callback: any
  let effects: Array<() => any> = []
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('BdApi', { React: {
    createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }),
    useReducer: () => [0, vi.fn()], useState: () => [false, vi.fn()],
    useEffect: (effect: () => any) => { effects.push(effect) },
  } })
  const ctx = {
    cache, modules: { MessageContent: { module: { render: () => null }, method: 'render' }, failed: [] },
    keyring: { get: () => entry, isEncryptModeOn: () => true, getActiveSendKey: () => entry.id },
    session: { getKey: () => material.key },
    patcher: { after: (_caller: any, _module: any, _method: any, cb: any) => { callback = cb } },
  } as unknown as PluginContext
  applyRenderPatch(ctx)
  async function wire(text: string) {
    const encrypted = await encryptText(material.key, text)
    return encodeWire({ keyId: entry.id, salt, iv: encrypted.iv, ciphertext: encrypted.ct })
  }
  function render(content: string, editedTimestamp: number | null = 123) {
    return callback(null, [{ message: { id: 'message', channel_id: 'channel', editedTimestamp, content } }], 'native')
  }
  async function decrypt(element: any) {
    effects = []
    element.type(element.props)
    const cleanup = effects.map(effect => effect())
    for (let i = 0; i < 500 && !cache.get(element.props.cacheKey); i++) await new Promise(r => setTimeout(r, 2))
    cleanup.forEach(fn => { if (typeof fn === 'function') fn() })
    return cache.get(element.props.cacheKey)
  }
  function mount(element: any) {
    effects = []
    const view = element.type(element.props)
    effects.forEach(effect => effect())
    return view
  }
  return { ctx, cache, wire, render, decrypt, mount }
}

describe('encrypted edits render identity', () => {
  it.each(['Enter', ' '])('allows keyboard activation of a locked message with %j', async key => {
    const h = await harness()
    h.ctx.session.getKey = () => null
    const view = h.mount(h.render(await h.wire('private')))
    const click = vi.fn()
    const preventDefault = vi.fn()
    view.props.onKeyDown({ key, currentTarget: { click }, preventDefault })
    expect(click).toHaveBeenCalledOnce()
    expect(preventDefault).toHaveBeenCalledOnce()
  })
  it('does not display cached plaintext when the session key is gone', async () => {
    const h = await harness()
    const element = h.render(await h.wire('private'))
    await h.decrypt(element)
    h.ctx.session.getKey = () => null
    expect(h.mount(element).props.className).toBe('bp-chip bp-chip-locked')
  })

  it('does not cache a pending plaintext after display mode is switched off', async () => {
    const h = await harness()
    const element = h.render(await h.wire('private'))
    let finish!: (value: ArrayBuffer) => void
    vi.spyOn(crypto.subtle, 'decrypt').mockImplementation(() => new Promise(resolve => { finish = resolve }))
    h.mount(element)
    h.ctx.keyring.isEncryptModeOn = () => false
    finish(new TextEncoder().encode('private').buffer)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(h.cache.get(element.props.cacheKey)).toBeUndefined()
  })

  it.each([null, 123])('does not reuse stale plaintext before editTimestamp changes (%s)', async timestamp => {
    const h = await harness()
    const first = h.render(await h.wire('before edit'), timestamp)
    expect(await h.decrypt(first)).toMatchObject({ kind: 'text', text: 'before edit' })
    const next = h.render(await h.wire('after edit'), timestamp)
    expect(next.props.key).not.toBe(first.props.key)
    expect(next.props.cacheKey).not.toBe(first.props.cacheKey)
    expect(h.cache.get(next.props.cacheKey)).toBeUndefined()
    expect(await h.decrypt(next)).toMatchObject({ kind: 'text', text: 'after edit' })
  })

  it('does not keep an old authentication failure after a corrected envelope arrives with the same timestamp', async () => {
    const h = await harness()
    const wire = await h.wire('valid new edit')
    const last = wire.length - 8
    const corrupt = wire.slice(0, last) + (wire[last] === 'A' ? 'B' : 'A') + wire.slice(last + 1)
    const failed = h.render(corrupt)
    expect(await h.decrypt(failed)).toMatchObject({ kind: 'failed' })
    const corrected = h.render(wire)
    expect(corrected.props.cacheKey).not.toBe(failed.props.cacheKey)
    expect(await h.decrypt(corrected)).toMatchObject({ kind: 'text', text: 'valid new edit' })
  })

  it('reuses a result only for the exact same encrypted envelope', async () => {
    const h = await harness()
    const content = await h.wire('unchanged')
    const first = h.render(content)
    await h.decrypt(first)
    const same = h.render(content)
    expect(same.props.cacheKey).toBe(first.props.cacheKey)
    expect(h.cache.get(same.props.cacheKey)).toMatchObject({ text: 'unchanged' })
  })
})
