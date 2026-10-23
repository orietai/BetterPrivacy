import { afterEach, describe, expect, it, vi } from 'vitest'
import { createKeyring } from '../src/core/keyring'
import { createSession } from '../src/core/session'
import { createSettingsStore } from '../src/settings'
import { resolveSendKey, selectSendKey } from '../src/core/sendKey'
import { applySendPatch } from '../src/patches/send'
import { applyUploadPatch } from '../src/patches/upload'
import { parseWire } from '../src/crypto/wire'
import type { PluginContext } from '../src/types'

const channel = '123456789012345678'
const cleanup: Array<() => void> = []
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); vi.unstubAllGlobals() })
async function harness() {
  const disk = new Map<string, any>()
  vi.stubGlobal('BdApi', { Data: { load: (_: string, key: string) => disk.get(key), save: (_: string, key: string, value: any) => disk.set(key, structuredClone(value)) }, UI: { showToast: vi.fn() } })
  const keyring = createKeyring(), settings = createSettingsStore(), session = createSession(keyring, settings)
  const old = await keyring.create('Team', 'old synthetic phrase', channel)
  const chosen = await keyring.create('team', 'current synthetic phrase', channel)
  await session.unlock(old, 'old synthetic phrase')
  await session.unlock(chosen, 'current synthetic phrase')
  keyring.setActiveSendKey(channel, chosen.id)
  keyring.setEncryptMode(channel, true)
  const native = vi.fn(async (..._args: any[]) => ({ ok: true }))
  const actions = { sendMessage: native, editMessage: vi.fn() }
  const uploaded = vi.fn()
  class Upload {
    channelId = channel
    item = { file: new File(['secret'], 'secret.txt') }
    async uploadFileToCloud() { uploaded(this.item.file) }
  }
  const ctx = { keyring, session, settings, modules: { MessageActions: actions, MessageStore: { getMessage() {} }, CloudUpload: Upload, failed: [] }, disposers: [], forceRerender: vi.fn(),
    patcher: { instead(_: string, target: any, method: string, callback: any) { const original = target[method]; target[method] = function (...args: any[]) { return callback(this, args, original) } } },
  } as unknown as PluginContext
  cleanup.push(() => session.stop())
  applySendPatch(ctx)
  applyUploadPatch(ctx)
  return { ctx, old, chosen, actions, native, disk, Upload, uploaded }
}

describe('sending never silently changes recipients', () => {
  it('rejects /enc when its case-insensitive label identifies multiple keys', async () => {
    const h = await harness()
    await h.actions.sendMessage(channel, { content: '/enc TEAM intended for current team' })
    expect(h.native).not.toHaveBeenCalled()
  })

  it('keeps an unambiguous explicit command working', async () => {
    const h = await harness()
    h.ctx.keyring.remove(h.old.id)
    await h.actions.sendMessage(channel, { content: '/enc team current team only' })
    expect(parseWire(h.native.mock.calls[0]![1].content)?.keyId).toBe(h.chosen.id)
  })

  it('forgetting the selected key blocks text and files until a new explicit choice, including after reload', async () => {
    const h = await harness()
    h.ctx.session.lockKey(h.chosen.id)
    h.ctx.keyring.remove(h.chosen.id)
    expect(resolveSendKey(h.ctx.keyring, channel)).toBeUndefined()
    expect(resolveSendKey(createKeyring(), channel)).toBeUndefined()
    expect(h.ctx.keyring.isEncryptModeOn(channel)).toBe(true)
    await h.actions.sendMessage(channel, { content: 'must not use historical recipient key' })
    await expect(new h.Upload().uploadFileToCloud()).rejects.toThrow()
    expect(h.native).not.toHaveBeenCalled()
    expect(h.uploaded).not.toHaveBeenCalled()
    expect(await selectSendKey(h.ctx, channel, h.old.id, async () => true)).toBe(true)
    await h.actions.sendMessage(channel, { content: 'explicitly selected history key' })
    expect(parseWire(h.native.mock.calls[0]![1].content)?.keyId).toBe(h.old.id)
  })
})
