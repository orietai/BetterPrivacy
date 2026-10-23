import { afterEach, describe, expect, it, vi } from 'vitest'
import { createKeyring } from '../src/core/keyring'
import { createSession } from '../src/core/session'
import { createSettingsStore } from '../src/settings'
import { applyEditPatch, applySendPatch } from '../src/patches/send'
import * as cipher from '../src/crypto/cipher'
import * as wire from '../src/crypto/wire'
import { openUnlockModal } from '../src/ui/UnlockModal'
import type { PluginContext, KeyEntry } from '../src/types'

vi.mock('../src/ui/UnlockModal', () => ({ openUnlockModal: vi.fn() }))

const CHANNEL = '123456789012345678'
const MESSAGE = '987654321098765432'
const PHRASE = 'four tiny moons over the rooftop'
const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).forEach(fn => fn())
  vi.restoreAllMocks()
  vi.mocked(openUnlockModal).mockReset()
  vi.unstubAllGlobals()
})

function harness() {
  const disk = new Map<string, any>()
  const toasts = vi.fn()
  vi.stubGlobal('BdApi', {
    Data: {
      load: (_plugin: string, key: string) => disk.get(key),
      save: (_plugin: string, key: string, value: any) => disk.set(key, structuredClone(value)),
    },
    UI: { showToast: toasts },
  })
  const settings = createSettingsStore()
  const keyring = createKeyring()
  const session = createSession(keyring, settings)
  const actions = {
    sendMessage: vi.fn(async (..._args: any[]): Promise<any> => ({ ok: true })),
    editMessage: vi.fn(async function (this: any, ..._args: any[]): Promise<any> { return { ok: true } }),
  }
  const original = actions.editMessage
  const send = actions.sendMessage
  const getMessage = vi.fn((_channel: string, _message: string): any => ({ content: 'ordinary original' }))
  const selected = { channel: CHANNEL }
  const unpatches: Array<() => void> = []
  const ctx = {
    keyring, session, settings,
    modules: { MessageActions: actions, MessageStore: { getMessage }, SelectedChannelStore: { getChannelId: () => selected.channel }, failed: [] },
    patcher: { instead(_caller: string, module: any, method: string, cb: any) {
      const native = module[method]
      module[method] = function (...args: any[]) { return cb(this, args, native) }
      unpatches.push(() => { module[method] = native })
    } },
  } as unknown as PluginContext
  cleanups.push(() => { session.stop(); unpatches.reverse().forEach(fn => fn()) })
  async function arm() {
    const entry = await keyring.create('channel:' + CHANNEL, PHRASE, CHANNEL)
    await session.unlock(entry, PHRASE)
    keyring.setActiveSendKey(CHANNEL, entry.id)
    keyring.setEncryptMode(CHANNEL, true)
    return entry
  }
  async function encryptedOriginal(entry: KeyEntry) {
    const { iv, ct } = await cipher.encryptText(session.getKey(entry.id)!, 'original secret')
    const content = wire.encodeWire({ keyId: entry.id, salt: entry.salt, iv, ciphertext: ct })
    getMessage.mockReturnValue({ content })
    return content
  }
  return { ctx, actions, original, send, toasts, getMessage, selected, arm, encryptedOriginal }
}

describe('safe encrypted edits', () => {
  it('reports a missing store, blocks edits while waiting and recovers without reinstalling the hook', async () => {
    const h = harness()
    h.ctx.modules.MessageStore = null
    applyEditPatch(h.ctx)
    expect(h.ctx.modules.failed).toContain('MessageStore')
    await h.actions.editMessage(CHANNEL, MESSAGE, { content: 'must wait' })
    expect(h.original).not.toHaveBeenCalled()
    // The existing lazy-lookup loop replaces the shared field on recovery.
    h.ctx.modules.MessageStore = { getMessage: h.getMessage }
    await h.actions.editMessage(CHANNEL, MESSAGE, { content: 'known public original' })
    expect(h.original).toHaveBeenCalledOnce()
    expect(h.original.mock.calls[0]![2].content).toBe('known public original')
  })

  it('roundtrips ciphertext and preserves receiver, IDs, metadata, extra args and draft', async () => {
    const h = harness()
    const entry = await h.arm()
    applySendPatch(h.ctx)
    const metadata = { attachments: [{ id: 'existing' }], flags: 4 }
    const update = { content: 'private edit 🦇\nTürkçe', ...metadata }
    const options = { reason: 'edit', nonce: 'keep' }
    const result = await h.actions.editMessage.call(h.actions, CHANNEL, MESSAGE, update, options, false)
    expect(result).toEqual({ ok: true })
    expect(h.original).toHaveBeenCalledOnce()
    const args = h.original.mock.calls[0]!
    expect(args.slice(0, 2)).toEqual([CHANNEL, MESSAGE])
    expect(args.slice(3)).toEqual([options, false])
    expect(args[3]).toBe(options)
    expect(args[2].attachments).toBe(metadata.attachments)
    expect(args[2].flags).toBe(4)
    expect(h.original.mock.contexts[0]).toBe(h.actions)
    expect(update.content).toBe('private edit 🦇\nTürkçe')
    expect(args[2].content.length).toBeLessThanOrEqual(2000)
    const parts = wire.parseWire(args[2].content)!
    expect(parts.keyId).toBe(entry.id)
    await expect(cipher.decryptText(h.ctx.session.getKey(entry.id)!, parts.iv, parts.ciphertext)).resolves.toBe(update.content)
    expect(h.send).not.toHaveBeenCalled()
    expect(h.getMessage).toHaveBeenCalledWith(CHANNEL, MESSAGE)
  })

  it.each([false, true])('keeps the historical key with mode=%s and another selected key', async mode => {
    const h = harness()
    const first = await h.arm()
    await h.encryptedOriginal(first)
    const second = await h.ctx.keyring.create('other', PHRASE + ' other', CHANNEL)
    await h.ctx.session.unlock(second, PHRASE + ' other')
    h.ctx.keyring.setActiveSendKey(CHANNEL, second.id)
    h.ctx.keyring.setEncryptMode(CHANNEL, mode)
    applySendPatch(h.ctx)
    await h.actions.editMessage(CHANNEL, MESSAGE, { content: '/pt still private' })
    const parts = wire.parseWire(h.original.mock.calls[0]![2].content)!
    expect(parts.keyId).toBe(first.id)
    await expect(cipher.decryptText(h.ctx.session.getKey(first.id)!, parts.iv, parts.ciphertext)).resolves.toBe('/pt still private')
    expect(h.ctx.keyring.getActiveSendKey(CHANNEL)).toBe(second.id)
  })

  it('passes a known plain original through unchanged when mode is off', async () => {
    const h = harness()
    await h.arm()
    h.ctx.keyring.setEncryptMode(CHANNEL, false)
    applySendPatch(h.ctx)
    const update = { content: 'public edit' }
    await h.actions.editMessage(CHANNEL, MESSAGE, update, { flags: 3 })
    expect(h.original.mock.calls[0]![2]).toBe(update)
    expect(h.toasts).not.toHaveBeenCalled()
  })

  it.each(['absent store', 'absent method', 'missing message', 'unknown content', 'mangled wire'])('blocks %s even with mode off and keys present', async state => {
    const h = harness()
    await h.arm()
    h.ctx.keyring.setEncryptMode(CHANNEL, false)
    if (state === 'absent store') h.ctx.modules.MessageStore = null
    if (state === 'absent method') h.ctx.modules.MessageStore = {}
    if (state === 'missing message') h.getMessage.mockReturnValue(null)
    if (state === 'unknown content') h.getMessage.mockReturnValue({})
    if (state === 'mangled wire') h.getMessage.mockReturnValue({ content: '🦇<https://betterprivacy.app/m#v1.broken>' })
    applySendPatch(h.ctx)
    await h.actions.editMessage(CHANNEL, MESSAGE, { content: 'secret' })
    expect(h.original).not.toHaveBeenCalled()
    expect(h.toasts).toHaveBeenCalled()
  })

  it('blocks an unknown original while mode is on', async () => {
    const h = harness()
    await h.arm()
    h.getMessage.mockReturnValue(null)
    applySendPatch(h.ctx)
    await h.actions.editMessage(CHANNEL, MESSAGE, { content: 'secret' })
    expect(h.original).not.toHaveBeenCalled()
  })

  it.each(['missing historical key', 'salt mismatch', 'no selected key'])('blocks %s', async state => {
    const h = harness()
    const entry = await h.arm()
    if (state === 'no selected key') {
      await h.ctx.keyring.create('other', PHRASE + ' other', CHANNEL)
      h.ctx.keyring.setActiveSendKey(CHANNEL, null)
    } else {
      await h.encryptedOriginal(entry)
      const parts = wire.parseWire(h.getMessage(CHANNEL, MESSAGE).content)!
      h.getMessage.mockReturnValue({ content: wire.encodeWire({ ...parts, ...(state === 'salt mismatch' ? { salt: 'A'.repeat(22) } : { keyId: 'AAAAAAAA' }) }) })
    }
    applySendPatch(h.ctx)
    await h.actions.editMessage(CHANNEL, MESSAGE, { content: 'secret' })
    expect(h.original).not.toHaveBeenCalled()
    expect(h.toasts).toHaveBeenCalled()
  })

  it.each([false, true])('handles a locked historical key with unlock success=%s', async success => {
    const h = harness()
    const entry = await h.arm()
    await h.encryptedOriginal(entry)
    h.ctx.keyring.setEncryptMode(CHANNEL, false)
    h.ctx.session.lockKey(entry.id)
    vi.mocked(openUnlockModal).mockImplementation(async () => success ? h.ctx.session.unlock(entry, PHRASE) : false)
    applySendPatch(h.ctx)
    await h.actions.editMessage(CHANNEL, MESSAGE, { content: 'private edit' })
    expect(openUnlockModal).toHaveBeenCalledWith(h.ctx, entry)
    expect(h.original).toHaveBeenCalledTimes(success ? 1 : 0)
    if (!success) expect(h.toasts).toHaveBeenCalled()
  })

  it.each(['session', 'mode', 'selection', 'channel', 'original', 'key removed'])('cancels when %s changes during unlock', async change => {
    const h = harness()
    const entry = await h.arm()
    h.ctx.session.lockKey(entry.id)
    vi.mocked(openUnlockModal).mockImplementation(async () => {
      await h.ctx.session.unlock(entry, PHRASE)
      if (change === 'session') h.ctx.session.lockAll('manual')
      if (change === 'mode') h.ctx.keyring.setEncryptMode(CHANNEL, false)
      if (change === 'selection') h.ctx.keyring.setActiveSendKey(CHANNEL, null)
      if (change === 'channel') h.selected.channel = 'other'
      if (change === 'original') h.getMessage.mockReturnValue({ content: 'changed remotely' })
      if (change === 'key removed') vi.spyOn(h.ctx.keyring, 'get').mockReturnValue(undefined)
      return true
    })
    applySendPatch(h.ctx)
    await h.actions.editMessage(CHANNEL, MESSAGE, { content: 'secret' })
    expect(h.original).not.toHaveBeenCalled()
    expect(h.toasts).toHaveBeenCalled()
  })

  it('cancels a lock during encryption even if the key is unlocked again', async () => {
    const h = harness()
    const entry = await h.arm()
    const encrypt = cipher.encryptText
    vi.spyOn(cipher, 'encryptText').mockImplementationOnce(async (key, text) => {
      const encrypted = await encrypt(key, text)
      h.ctx.session.lockKey(entry.id)
      await h.ctx.session.unlock(entry, PHRASE)
      return encrypted
    })
    applySendPatch(h.ctx)
    await h.actions.editMessage(CHANNEL, MESSAGE, { content: 'secret' })
    expect(h.original).not.toHaveBeenCalled()
    expect(h.toasts).toHaveBeenCalled()
  })

  it.each(['a'.repeat(1361), '🦇'.repeat(341)])('blocks oversized UTF-8 text without sending extra messages', async content => {
    const h = harness()
    await h.arm()
    applySendPatch(h.ctx)
    await h.actions.editMessage(CHANNEL, MESSAGE, { content })
    expect(h.original).not.toHaveBeenCalled()
    expect(h.send).not.toHaveBeenCalled()
    expect(h.toasts).toHaveBeenCalled()
  })

  it('accepts exactly 1360 UTF-8 bytes in one encrypted message', async () => {
    const h = harness()
    await h.arm()
    applySendPatch(h.ctx)
    await h.actions.editMessage(CHANNEL, MESSAGE, { content: '🦇'.repeat(340) })
    expect(h.original).toHaveBeenCalledOnce()
    expect(h.original.mock.calls[0]![2].content.length).toBeLessThanOrEqual(2000)
  })

  it.each([null, {}, { content: null }, { content: 5 }, 'secret'])('blocks invalid update shape %j', async update => {
    const h = harness()
    await h.arm()
    applySendPatch(h.ctx)
    await h.actions.editMessage(CHANNEL, MESSAGE, update)
    expect(h.original).not.toHaveBeenCalled()
    expect(h.toasts).toHaveBeenCalled()
  })

  it.each(['store', 'crypto', 'wire limit', 'modal', 'getter', 'native', 'API rejection'])('fails closed on %s errors', async failure => {
    const h = harness()
    const entry = await h.arm()
    const error = () => { throw new Error('internal failure') }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    if (failure === 'store') h.getMessage.mockImplementation(error)
    if (failure === 'crypto') vi.spyOn(cipher, 'encryptText').mockRejectedValueOnce(new Error('crypto failure'))
    if (failure === 'wire limit') vi.spyOn(wire, 'encodeWire').mockImplementationOnce(() => { throw new Error('BP_OVERSIZE') })
    if (failure === 'modal') {
      h.ctx.session.lockKey(entry.id)
      vi.mocked(openUnlockModal).mockRejectedValueOnce(new Error('modal failure'))
    }
    if (failure === 'native') h.original.mockRejectedValueOnce(new Error('network failure'))
    if (failure === 'API rejection') h.original.mockResolvedValueOnce({ ok: false })
    applySendPatch(h.ctx)
    await h.actions.editMessage(CHANNEL, MESSAGE, failure === 'getter' ? { get content() { return error() } } : { content: 'secret' })
    expect(h.original).toHaveBeenCalledTimes(['native', 'API rejection'].includes(failure) ? 1 : 0)
    for (const args of h.original.mock.calls) expect(wire.parseWire(args[2].content)).not.toBeNull()
    expect(h.toasts).toHaveBeenCalled()
    expect(h.send).not.toHaveBeenCalled()
  })

  it('reports a missing edit hook without breaking ordinary sends', async () => {
    const h = harness()
    delete (h.actions as any).editMessage
    await h.arm()
    applySendPatch(h.ctx)
    expect(h.ctx.modules.failed).toContain('edit: editMessage unavailable')
    await h.actions.sendMessage(CHANNEL, { content: 'new message' })
    expect(h.send).toHaveBeenCalledOnce()
    expect(wire.parseWire(h.send.mock.calls[0]![1].content)).not.toBeNull()
  })

  it('installs a later available edit hook once without wrapping send again', async () => {
    const h = harness()
    const entry = await h.arm()
    delete (h.actions as any).editMessage
    applySendPatch(h.ctx)
    const patchedSend = h.actions.sendMessage
    h.actions.editMessage = h.original
    applyEditPatch(h.ctx)
    const patchedEdit = h.actions.editMessage
    applyEditPatch(h.ctx)
    expect(h.actions.editMessage).toBe(patchedEdit)
    expect(h.actions.sendMessage).toBe(patchedSend)
    await h.actions.editMessage(CHANNEL, MESSAGE, { content: 'encrypted exactly once' })
    expect(h.original).toHaveBeenCalledOnce()
    const parts = wire.parseWire(h.original.mock.calls[0]![2].content)!
    await expect(cipher.decryptText(h.ctx.session.getKey(entry.id)!, parts.iv, parts.ciphertext)).resolves.toBe('encrypted exactly once')
  })

  it('retries failed installation and installs on replacement actions independently', async () => {
    const h = harness()
    await h.arm()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const instead = vi.spyOn(h.ctx.patcher, 'instead')
    instead.mockImplementationOnce(() => { throw new Error('temporarily unavailable') })
    applyEditPatch(h.ctx)
    expect(h.ctx.modules.failed).toContain('edit: editMessage interception failed')
    applyEditPatch(h.ctx)
    applyEditPatch(h.ctx)
    expect(instead).toHaveBeenCalledTimes(2)
    const replacement = { editMessage: vi.fn(async (..._args: any[]) => ({ ok: true })) }
    const native = replacement.editMessage
    h.ctx.modules.MessageActions = replacement
    applyEditPatch(h.ctx)
    applyEditPatch(h.ctx)
    expect(instead).toHaveBeenCalledTimes(3)
    await replacement.editMessage(CHANNEL, MESSAGE, { content: 'new actions object' })
    expect(native).toHaveBeenCalledOnce()
    expect(wire.parseWire(native.mock.calls[0]![2].content)).not.toBeNull()
  })
})
