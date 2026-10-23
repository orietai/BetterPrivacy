import { describe, expect, it, vi } from 'vitest'
import { resolveSendKey, selectSendKey } from '../src/core/sendKey'
import type { KeyEntry, PluginContext } from '../src/types'

const CHANNEL = '123'
function setup() {
  const entries = ['AAAAAAAA', 'BBBBBBBB'].map(id => ({ id, label: id, scope: CHANNEL } as KeyEntry))
  const state = { active: 'AAAAAAAA' as string | null, on: true, revision: 0 }
  const unlocked = new Set(['AAAAAAAA'])
  const ctx = {
    modules: { failed: [] }, forceRerender: vi.fn(),
    keyring: {
      forChannel: (id: string) => entries.filter(e => e.scope === id || e.scope === 'global'),
      getActiveSendKey: () => state.active,
      setActiveSendKey: (_channel: string, id: string) => { state.active = id },
      isEncryptModeOn: () => state.on,
      setEncryptMode: (_channel: string, value: boolean) => { state.on = value },
    },
    session: { get revision() { return state.revision }, isUnlocked: (id: string) => unlocked.has(id) },
  } as unknown as PluginContext
  return { ctx, entries, state, unlocked }
}

describe('explicit per-channel sending key', () => {
  it('uses the selected key, not the last key unlocked for reading', () => {
    const h = setup()
    h.unlocked.add('BBBBBBBB')
    expect(resolveSendKey(h.ctx.keyring, CHANNEL)?.id).toBe('AAAAAAAA')
  })

  it('never chooses the first of several keys when there is no selection', () => {
    const h = setup()
    h.state.active = null
    expect(resolveSendKey(h.ctx.keyring, CHANNEL)).toBeUndefined()
    h.entries.pop()
    expect(resolveSendKey(h.ctx.keyring, CHANNEL)?.id).toBe('AAAAAAAA')
  })

  it('refuses a selected key from a different channel rather than guessing', () => {
    const h = setup()
    h.state.active = 'BBBBBBBB'
    h.entries[1]!.scope = 'other-channel'
    expect(resolveSendKey(h.ctx.keyring, CHANNEL)).toBeUndefined()
  })

  it('preserves the old selection when unlock is cancelled', async () => {
    const h = setup()
    expect(await selectSendKey(h.ctx, CHANNEL, 'BBBBBBBB', async () => false)).toBe(false)
    expect(h.state.active).toBe('AAAAAAAA')
    expect(h.ctx.forceRerender).not.toHaveBeenCalled()
  })

  it('switches explicitly without locking other keys used to read history', async () => {
    const h = setup()
    expect(await selectSendKey(h.ctx, CHANNEL, 'BBBBBBBB', async entry => {
      h.unlocked.add(entry.id); return true
    })).toBe(true)
    expect(h.state.active).toBe('BBBBBBBB')
    expect(h.unlocked.has('AAAAAAAA')).toBe(true)
    expect(h.state.on).toBe(true)
  })

  it('does not commit an unlock after lock-all invalidates it', async () => {
    const h = setup()
    expect(await selectSendKey(h.ctx, CHANNEL, 'BBBBBBBB', async entry => {
      h.state.revision++; h.unlocked.add(entry.id); return true
    })).toBe(false)
    expect(h.state.active).toBe('AAAAAAAA')
  })

  it('a late unlock cannot replace a more recent explicit choice', async () => {
    const h = setup()
    let finish!: (value: boolean) => void
    const older = selectSendKey(h.ctx, CHANNEL, 'BBBBBBBB', () => new Promise(resolve => { finish = resolve }))
    expect(await selectSendKey(h.ctx, CHANNEL, 'AAAAAAAA', async () => true)).toBe(true)
    h.unlocked.add('BBBBBBBB')
    finish(true)
    expect(await older).toBe(false)
    expect(h.state.active).toBe('AAAAAAAA')
  })

  it.each(['upload: unavailable', 'edit: unavailable', 'editComposer: unavailable', 'MessageStore'])('cannot arm a channel when integration is broken: %s', async (failure) => {
    const h = setup()
    h.ctx.modules.failed.push(failure)
    const unlock = vi.fn(async () => true)
    expect(await selectSendKey(h.ctx, CHANNEL, 'BBBBBBBB', unlock)).toBe(false)
    expect(unlock).not.toHaveBeenCalled()
    expect(h.state.active).toBe('AAAAAAAA')
  })
})
