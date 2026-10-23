import { afterEach, describe, expect, it, vi } from 'vitest'
import * as kdf from '../src/crypto/kdf'
import { createKeyring } from '../src/core/keyring'
import { createSession } from '../src/core/session'
import { createSettingsStore } from '../src/settings'
import { encryptText, decryptText } from '../src/crypto/cipher'
import { openUnlockModal, openRecoverKeyModal, openChannelPhraseModal } from '../src/ui/UnlockModal'
import type { PluginContext } from '../src/types'

const phrase = 'synthetic shared history phrase'
const channel = '123456789012345678'
const cleanups: Array<() => void> = []
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); vi.restoreAllMocks(); vi.unstubAllGlobals() })
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(r => { resolve = r })
  return { promise, resolve }
}
async function harness() {
  const disk = new Map<string, any>()
  let modal: any
  const toasts = vi.fn()
  vi.stubGlobal('BdApi', {
    Data: { load: (_: string, key: string) => disk.get(key), save: (_: string, key: string, value: any) => disk.set(key, structuredClone(value)) },
    UI: { showToast: toasts, showConfirmationModal: (_: string, content: any, options: any) => { modal = { content, options } } },
    React: { createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }) },
  })
  const keyring = createKeyring(), settings = createSettingsStore(), session = createSession(keyring, settings)
  const primary = await keyring.create('primary', phrase, channel)
  const history = await keyring.create('old random salt equivalent', phrase, channel)
  const global = await keyring.create('global history', phrase, 'global')
  const wrong = await keyring.create('unrelated phrase', 'different phrase', channel)
  const elsewhere = await keyring.create('other channel', phrase, 'other-channel')
  keyring.setActiveSendKey(channel, wrong.id)
  keyring.setEncryptMode(channel, false)
  const focused = { channel }
  const ctx = { keyring, session, settings, modules: { failed: [], SelectedChannelStore: { getChannelId: () => focused.channel } }, disposers: [], forceRerender: vi.fn() } as unknown as PluginContext
  cleanups.push(() => { ctx.disposers.forEach(fn => fn()); session.stop() })
  async function open(kind = 'unlock') {
    let done: Promise<unknown>
    if (kind === 'recover') {
      const material = await kdf.deriveKeyMaterial(phrase, primary.salt)
      const encrypted = await encryptText(material.key, 'authenticated primary')
      done = openRecoverKeyModal(ctx, { keyId: primary.id, salt: primary.salt }, channel,
        candidate => decryptText(candidate, encrypted.iv, encrypted.ct))
    } else if (kind === 'setup') done = openChannelPhraseModal(ctx, channel)
    else done = openUnlockModal(ctx, primary)
    const opened = modal
    opened.content.props.passRef.value = phrase
    return { done, modal: opened }
  }
  function pauseHistory() {
    const actual = kdf.deriveKeyMaterial
    const started = deferred(), release = deferred(), finished = deferred()
    let active = 0, maxActive = 0
    const calls: string[] = []
    vi.spyOn(kdf, 'deriveKeyMaterial').mockImplementation(async (value, salt) => {
      calls.push(salt); active++; maxActive = Math.max(maxActive, active)
      try {
        if (salt === history.salt) { started.resolve(); await release.promise }
        return await actual(value, salt)
      } finally { active--; if (salt === history.salt) finished.resolve() }
    })
    return { started, release, finished, calls, maxActive: () => maxActive }
  }
  return { ctx, primary, history, global, wrong, elsewhere, focused, open, pauseHistory, toasts, disk }
}

describe('one phrase opens compatible channel history', () => {
  it.each(['unlock', 'recover', 'setup'])('%s opens matching different salts and globals, silently skips mismatches, never opens another channel', async kind => {
    const h = await harness()
    const { done, modal } = await h.open(kind)
    const before = structuredClone(h.disk.get('channelPrefs'))
    const gate = h.pauseHistory()
    modal.options.onConfirm()
    modal.options.onCloseCallback()
    await gate.started.promise
    expect(h.ctx.forceRerender).toHaveBeenCalled()
    expect(h.ctx.session.isUnlocked(h.primary.id)).toBe(true)
    gate.release.resolve()
    expect(await done).toBeTruthy()
    expect(h.ctx.session.isUnlocked(h.history.id)).toBe(true)
    expect(h.ctx.session.isUnlocked(h.global.id)).toBe(true)
    expect(h.ctx.session.isUnlocked(h.wrong.id)).toBe(false)
    expect(h.ctx.session.isUnlocked(h.elsewhere.id)).toBe(false)
    expect(gate.calls).not.toContain(h.elsewhere.salt)
    expect(gate.maxActive()).toBe(1)
    if (kind !== 'setup') expect(h.disk.get('channelPrefs')).toEqual(before)
    else {
      expect(h.ctx.keyring.isEncryptModeOn(channel)).toBe(true)
      expect(h.ctx.keyring.getActiveSendKey(channel)).toBe((await done as any).id)
    }
    const feedback = h.toasts.mock.calls.map(call => String(call[0])).join(' ')
    expect(feedback).not.toContain('Wrong passphrase')
    expect(feedback).toContain(kind === 'setup' ? '4 compatible' : '3 compatible')
    expect(modal.content.props.passRef.value).toBe('')
    expect(JSON.stringify([...h.disk.values()])).not.toContain(phrase)
  })

  it.each(['cancel', 'close', 'lock', 'stop', 'switch', 'scope', 'remove', 'metadata'])("stops pending history work after %s", async action => {
    const h = await harness()
    const { done, modal } = await h.open()
    const gate = h.pauseHistory()
    // Exercise the real Enter fallback so a user can still dismiss the modal.
    modal.content.props.onEnter({ closest: () => null })
    await gate.started.promise
    expect(h.ctx.session.isUnlocked(h.primary.id)).toBe(true)
    if (action === 'cancel') modal.options.onCancel()
    if (action === 'close') modal.options.onCloseCallback()
    if (action === 'lock') h.ctx.session.lockAll('manual')
    if (action === 'stop') h.ctx.session.stop()
    if (action === 'switch') h.focused.channel = 'other-channel'
    if (action === 'scope') h.history.scope = 'other-channel'
    if (action === 'remove') h.ctx.keyring.remove(h.history.id)
    if (action === 'metadata') h.history.check = 'AAAAAA'
    gate.release.resolve()
    await gate.finished.promise
    const result = await done
    expect(h.ctx.session.isUnlocked(h.history.id)).toBe(false)
    expect(h.ctx.session.isUnlocked(h.global.id)).toBe(false)
    expect(gate.calls).not.toContain(h.global.salt)
    if (['scope', 'remove', 'metadata'].includes(action)) {
      expect(result).toBe(true)
      expect(h.ctx.session.isUnlocked(h.primary.id)).toBe(true)
    } else expect(result).toBe(false)
    expect(h.ctx.keyring.getActiveSendKey(channel)).toBe(h.wrong.id)
    expect(h.ctx.keyring.isEncryptModeOn(channel)).toBe(false)
  })

  it('takes a finite candidate snapshot and does not rederive already open keys', async () => {
    const h = await harness()
    await h.ctx.session.unlock(h.global, phrase)
    const { done, modal } = await h.open()
    const gate = h.pauseHistory()
    modal.options.onConfirm()
    await gate.started.promise
    const late = await h.ctx.keyring.create('added during batch', phrase, channel)
    gate.release.resolve()
    expect(await done).toBe(true)
    expect(h.ctx.session.isUnlocked(late.id)).toBe(false)
    expect(gate.calls).not.toContain(h.global.salt)
  })
})
