import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { applyAttachmentsPatch } from '../src/patches/attachments'
import { createDecryptCache } from '../src/core/decryptCache'
import { decryptBpenc, peekBpencKeyId, peekBpencSalt } from '../src/crypto/bpenc'
import type { PluginContext } from '../src/types'

vi.mock('../src/crypto/bpenc', () => ({ decryptBpenc: vi.fn(), peekBpencKeyId: vi.fn(), peekBpencSalt: vi.fn() }))
vi.mock('../src/ui/UnlockModal', () => ({ openRecoverKeyModal: vi.fn(), openUnlockModal: vi.fn() }))

const ID = 'abcdefgh'
const CHANNEL = '123456789012345678'
const URL_SOURCE = `https://cdn.discordapp.com/attachments/${CHANNEL}/999/file.bpenc`
const cleanups: Array<() => void> = []
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks() })

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const opened = () => ({ header: { filename: 'private.png', mime: 'image/png', size: 3, sha256: '', chunks: 1 }, data: new Uint8Array([1, 2, 3]) })
const response = () => ({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer })

function harness() {
  const dom = new JSDOM('<!doctype html><body></body>')
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  let mutation!: () => void
  vi.stubGlobal('MutationObserver', class { constructor(callback: () => void) { mutation = callback } observe() {} disconnect() {} })
  const frames: Array<() => void> = []
  vi.stubGlobal('requestAnimationFrame', vi.fn((fn: () => void) => { frames.push(fn); return frames.length }))
  const cancelFrame = vi.fn()
  vi.stubGlobal('cancelAnimationFrame', cancelFrame)
  let mode = true
  let revision = 0
  let key: CryptoKey | null = {} as CryptoKey
  const entry = { id: ID, salt: 'A'.repeat(22), label: 'history' }
  const settings = { get: () => ({ maxAutoDownloadBytes: 1000, memoryBudgetMB: 1 }) }
  const cache = createDecryptCache(settings as any)
  const fetch = vi.fn(async (..._args: any[]): Promise<any> => response())
  vi.mocked(peekBpencKeyId).mockReturnValue(ID)
  vi.mocked(peekBpencSalt).mockReturnValue(entry.salt)
  vi.mocked(decryptBpenc).mockImplementation(async () => opened())
  const created = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:private-${Math.random()}`)
  const revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  let host: any
  const holder = { render: (_props: any): any => 'native attachment' }
  const undo: Array<() => void> = []
  const roots = { createRoot: vi.fn(() => ({ render: vi.fn(), unmount: vi.fn() })) }
  vi.stubGlobal('BdApi', {
    React: {
      createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }),
      useReducer: () => [0, () => host.schedule()],
      useRef: (value: any) => { const n = host.slot++; return host.refs[n] ??= { current: value } },
      useEffect: (effect: () => (() => void) | void, deps?: any[]) => {
        const n = host.slot++
        const previous = host.effects[n]
        if (!previous || !deps || deps.some((v, i) => previous.deps?.[i] !== v)) host.pending.push(() => {
          previous?.cleanup?.()
          host.effects[n] = { deps, cleanup: effect() }
        })
      },
    },
    ReactDOM: roots,
    Net: { fetch },
  })
  const ctx = {
    settings, cache,
    session: { get revision() { return revision }, getKey: () => key },
    keyring: { get: () => entry, isEncryptModeOn: () => mode, setEncryptMode: (_id: string, value: boolean) => { mode = value } },
    modules: { AttachmentComponent: { module: holder, method: 'render' }, SelectedChannelStore: { getChannelId: () => CHANNEL }, failed: [] },
    patcher: { after(_caller: string, target: any, method: string, cb: any) {
      const native = target[method]
      target[method] = function (...args: any[]) { return cb(this, args, native.apply(this, args)) }
      undo.push(() => { target[method] = native })
    } },
    disposers: [],
    forceRerender: () => dom.window.dispatchEvent(new dom.window.Event('bp-rerender')),
  } as unknown as PluginContext
  applyAttachmentsPatch(ctx)
  const node = holder.render({ attachment: { id: '999', filename: 'file.bpenc', url: URL_SOURCE, size: 3 } })
  host = {
    slot: 0, refs: [], effects: [], pending: [], mounted: true, queued: false, tree: null,
    props: node.props,
    render() {
      if (!host.mounted) return
      host.slot = 0; host.pending = []
      host.tree = node.type(host.props)
      host.pending.forEach((fn: any) => fn())
    },
    schedule() {
      if (host.queued || !host.mounted) return
      host.queued = true
      queueMicrotask(() => { host.queued = false; host.render() })
    },
    unmount() { host.mounted = false; host.effects.forEach((effect: any) => effect?.cleanup?.()) },
  }
  const start = () => host.render()
  const off = () => { mode = false; ctx.forceRerender() }
  const on = () => { mode = true; ctx.forceRerender() }
  const lock = () => { revision++; key = null; cache.purge('all'); ctx.forceRerender() }
  const unlock = () => { key = {} as CryptoKey; ctx.forceRerender() }
  const stop = () => { ctx.disposers.forEach(fn => fn()); revision++; key = null; cache.purge('all') }
  const cached = () => cache.get(cache.key(`att:999:${host.props.attachment.url}`))
  cleanups.push(() => { host.unmount(); stop(); undo.forEach(fn => fn()); dom.window.close() })
  return { ctx, cache, start, off, on, lock, unlock, stop, host, fetch, cached, created, revoked, frames, cancelFrame, mutation: () => mutation(), roots }
}

describe('attachment active content isolation', () => {
  it.each(['text/html', 'image/svg+xml', 'application/xml'])('downloads %s as inert bytes', async mime => {
    const h = harness()
    const value = opened()
    value.header.mime = mime
    vi.mocked(decryptBpenc).mockResolvedValue(value)
    h.start()
    await vi.waitFor(() => expect(h.cached()?.kind).toBe('media'))
    expect((h.created.mock.calls[0]![0] as Blob).type).toBe('application/octet-stream')
    expect(h.cached()).toMatchObject({ header: { mime: 'application/octet-stream' } })
  })
})

describe('attachment lifecycle flows', () => {
  it.each(['off', 'lock', 'stop'] as const)('ignores a pending download completing after %s', async action => {
    const h = harness()
    const download = deferred<any>()
    h.fetch.mockReturnValueOnce(download.promise)
    h.start()
    h[action]()
    download.resolve(response())
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(decryptBpenc).not.toHaveBeenCalled()
    expect(h.cached()).toBeUndefined()
    expect(h.created).not.toHaveBeenCalled()
    if (action === 'off') h.on()
    if (action === 'lock') h.unlock()
    if (action !== 'stop') await vi.waitFor(() => expect(h.cached()?.kind).toBe('media'))
  })

  it.each(['off', 'lock', 'stop'] as const)('ignores pending decrypted plaintext after %s and recovers on retry', async action => {
    const h = harness()
    const decrypt = deferred<ReturnType<typeof opened>>()
    vi.mocked(decryptBpenc).mockReturnValueOnce(decrypt.promise)
    h.start()
    await vi.waitFor(() => expect(decryptBpenc).toHaveBeenCalledOnce())
    h[action]()
    decrypt.resolve(opened())
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(h.cached()).toBeUndefined()
    expect(h.created).not.toHaveBeenCalled()
    if (action === 'off') h.on()
    if (action === 'lock') h.unlock()
    if (action !== 'stop') await vi.waitFor(() => expect(h.cached()?.kind).toBe('media'))
  })

  it.each(['off', 'lock', 'stop'] as const)('does not cache stale decryption failures after %s', async action => {
    const h = harness()
    const decrypt = deferred<ReturnType<typeof opened>>()
    vi.mocked(decryptBpenc).mockReturnValueOnce(decrypt.promise)
    h.start()
    await vi.waitFor(() => expect(decryptBpenc).toHaveBeenCalledOnce())
    h[action]()
    decrypt.reject(new Error('old GCM failure'))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(h.cached()).toBeUndefined()
    if (action === 'off') h.on()
    if (action === 'lock') h.unlock()
    if (action !== 'stop') await vi.waitFor(() => expect(h.cached()?.kind).toBe('media'))
  })

  it('drops bytes arriving after mode-off while reading the response body', async () => {
    const h = harness()
    const body = deferred<ArrayBuffer>()
    h.fetch.mockResolvedValueOnce({ ok: true, arrayBuffer: () => body.promise })
    h.start()
    await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledOnce())
    h.off()
    body.resolve(new Uint8Array([1]).buffer)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(decryptBpenc).not.toHaveBeenCalled()
    h.on()
    await vi.waitFor(() => expect(h.cached()?.kind).toBe('media'))
  })

  it('ignores an unmounted decrypt without polluting shared cache', async () => {
    const h = harness()
    const decrypt = deferred<ReturnType<typeof opened>>()
    vi.mocked(decryptBpenc).mockReturnValueOnce(decrypt.promise)
    h.start()
    await vi.waitFor(() => expect(decryptBpenc).toHaveBeenCalledOnce())
    h.host.unmount()
    decrypt.resolve(opened())
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(h.cached()).toBeUndefined()
    expect(h.created).not.toHaveBeenCalled()
  })

  it('retries a failed download from its error chip', async () => {
    const h = harness()
    h.fetch.mockRejectedValueOnce(new Error('offline'))
    h.start()
    await vi.waitFor(() => expect(h.host.tree.props.className).toContain('bp-chip-error'))
    h.host.tree.props.onClick()
    await vi.waitFor(() => expect(h.cached()?.kind).toBe('media'))
    expect(h.fetch).toHaveBeenCalledTimes(2)
  })

  it('revokes an untransferred blob on cache failure and allows retry', async () => {
    const h = harness()
    vi.spyOn(h.cache, 'set').mockImplementationOnce(() => { throw new Error('cache unavailable') })
    h.start()
    await vi.waitFor(() => expect(h.host.tree.props.className).toContain('bp-chip-error'))
    expect(h.revoked).toHaveBeenCalledWith(h.created.mock.results[0]!.value)
    expect(h.cached()).toBeUndefined()
    h.host.tree.props.onClick()
    await vi.waitFor(() => expect(h.cached()?.kind).toBe('media'))
    const media = h.cached() as any
    h.lock()
    expect(h.revoked).toHaveBeenCalledWith(media.blobUrl)
  })

  it('caches a current auth failure but retries cleanly after relock and unlock', async () => {
    const h = harness()
    vi.mocked(decryptBpenc).mockRejectedValueOnce(new Error('GCM failure'))
    h.start()
    await vi.waitFor(() => expect(h.cached()?.kind).toBe('failed'))
    h.lock()
    h.unlock()
    await vi.waitFor(() => expect(h.cached()?.kind).toBe('media'))
  })

  it('does not remount a DOM attachment from an already queued scan after stop', () => {
    const h = harness()
    document.body.innerHTML = `<div><div class="fileWrapper"><a class="fileNameLink" href="${URL_SOURCE}">file.bpenc</a></div></div>`
    h.mutation()
    expect(h.frames).toHaveLength(1)
    h.stop()
    h.frames[0]!()
    expect(h.cancelFrame).toHaveBeenCalledWith(1)
    expect(h.roots.createRoot).not.toHaveBeenCalled()
    expect(document.querySelector('.bp-att-host')).toBeNull()
  })

  it('does not overwrite or revoke a newer successful retry when an obsolete decrypt fails', async () => {
    const h = harness()
    const old = deferred<ReturnType<typeof opened>>()
    vi.mocked(decryptBpenc).mockReturnValueOnce(old.promise)
    h.start()
    await vi.waitFor(() => expect(decryptBpenc).toHaveBeenCalledOnce())
    h.off()
    h.on()
    await vi.waitFor(() => expect(h.cached()?.kind).toBe('media'))
    const newer = h.cached()
    old.reject(new Error('obsolete failure'))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(h.cached()).toBe(newer)
    expect(h.revoked).not.toHaveBeenCalled()
  })

  it('retries instead of sticking in fetching when the key identity changes during decryption', async () => {
    const h = harness()
    const old = deferred<ReturnType<typeof opened>>()
    vi.mocked(decryptBpenc).mockReturnValueOnce(old.promise)
    h.start()
    await vi.waitFor(() => expect(decryptBpenc).toHaveBeenCalledOnce())
    h.unlock() // replaces the CryptoKey without changing the session revision
    old.resolve(opened())
    await vi.waitFor(() => expect(h.cached()?.kind).toBe('media'))
    expect(decryptBpenc).toHaveBeenCalledTimes(2)
    expect(h.created).toHaveBeenCalledOnce()
  })
})
