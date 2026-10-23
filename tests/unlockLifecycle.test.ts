import { afterEach, describe, expect, it, vi } from 'vitest'
import * as kdf from '../src/crypto/kdf'
import { createKeyring } from '../src/core/keyring'
import { createSession } from '../src/core/session'
import { createSettingsStore } from '../src/settings'
import { encryptText, decryptText } from '../src/crypto/cipher'
import { openUnlockModal, openRecoverKeyModal, openChannelPhraseModal, openCreateKeyModal } from '../src/ui/UnlockModal'
import type { PluginContext } from '../src/types'

const phrase = 'synthetic modal lifecycle phrase'
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
    UI: { showToast: toasts, showConfirmationModal: vi.fn((_: string, content: any, options: any) => { modal = { content, options }; return '' }) },
    React: { createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }), useState: () => ['', vi.fn()] },
  })
  const keyring = createKeyring(), settings = createSettingsStore(), session = createSession(keyring, settings)
  const entry = await keyring.create('historical', phrase, channel)
  const selected = { id: channel }
  const ctx = { keyring, settings, session, disposers: [], forceRerender: vi.fn(), modules: { failed: [], SelectedChannelStore: { getChannelId: () => selected.id } } } as unknown as PluginContext
  cleanups.push(() => { ctx.disposers.forEach(fn => fn()); session.stop() })
  const actual = kdf.deriveKeyMaterial
  function pauseDerivation() {
    const started = deferred(), release = deferred(), finished = deferred()
    vi.spyOn(kdf, 'deriveKeyMaterial').mockImplementationOnce(async (...args) => {
      started.resolve()
      await release.promise
      try { return await actual(...args) } finally { finished.resolve() }
    })
    return { started, release, finished }
  }
  async function launch(kind: string) {
    let done: Promise<unknown>
    if (kind === 'unlock') done = openUnlockModal(ctx, entry)
    else if (kind === 'channel') done = openChannelPhraseModal(ctx, channel)
    else if (kind === 'create') done = openCreateKeyModal(ctx, channel)
    else {
      const key = await actual(phrase, entry.salt)
      const encrypted = await encryptText(key.key, 'authenticated payload')
      done = openRecoverKeyModal(ctx, { keyId: entry.id, salt: entry.salt }, channel,
        candidate => decryptText(candidate, encrypted.iv, encrypted.ct))
    }
    const current = modal
    if (kind === 'create') Object.assign(current.content.props.state, { label: 'new key', passphrase: phrase })
    else current.content.props.passRef.value = phrase
    return { done, modal: current }
  }
  return { ctx, entry, selected, disk, toasts, launch, pauseDerivation }
}

describe('modal operation lifecycle', () => {
  for (const kind of ['unlock', 'recover', 'channel', 'create']) {
    it.each(['cancel', 'close', 'lock', 'stop', 'dispose', 'switch'])(`${kind}: abandoning derivation via %s cannot unlock or arm`, async action => {
      const h = await harness()
      const { done, modal } = await h.launch(kind)
      const gate = h.pauseDerivation()
      // Enter's fallback leaves the dialog open; cancellation must still work.
      modal.content.props.onEnter({ closest: () => null })
      await gate.started.promise
      if (action === 'cancel') modal.options.onCancel()
      if (action === 'close') modal.options.onCloseCallback()
      if (action === 'lock') h.ctx.session.lockAll('manual')
      if (action === 'stop') h.ctx.session.stop()
      if (action === 'dispose') h.ctx.disposers.forEach(fn => fn())
      if (action === 'switch') h.selected.id = 'another-channel'
      gate.release.resolve()
      await gate.finished.promise
      expect(await done).toBeFalsy()
      expect(h.ctx.keyring.list().every(entry => !h.ctx.session.isUnlocked(entry.id))).toBe(true)
      expect(h.ctx.keyring.isEncryptModeOn(channel)).toBe(false)
      expect(h.ctx.keyring.getActiveSendKey(channel)).toBeNull()
      expect(h.toasts.mock.calls.flat().join(' ')).not.toContain('Wrong passphrase')
    })

    it(`${kind}: confirm survives its normal close and captures one phrase across awaits`, async () => {
      const h = await harness()
      const { done, modal } = await h.launch(kind)
      const gate = h.pauseDerivation()
      modal.options.onConfirm()
      modal.options.onCloseCallback()
      await gate.started.promise
      if (kind === 'create') modal.content.props.state.passphrase = 'changed while deriving'
      else modal.content.props.passRef.value = 'changed while deriving'
      gate.release.resolve()
      expect(await done).toBeTruthy()
      expect(h.ctx.keyring.list().some(entry => h.ctx.session.isUnlocked(entry.id))).toBe(true)
    })
  }

  it('cancelling an idle unlock dialog does not relock another reader', async () => {
    const h = await harness()
    await h.ctx.session.unlock(h.entry, phrase)
    const { done, modal } = await h.launch('unlock')
    modal.options.onCancel()
    expect(await done).toBe(false)
    expect(h.ctx.session.isUnlocked(h.entry.id)).toBe(true)
  })

  it('cancel during real payload authentication cannot repair persisted metadata', async () => {
    const h = await harness()
    const damaged = { ...h.entry, check: 'AAAAAA' }
    h.disk.set('keyring', [damaged])
    h.ctx.keyring = createKeyring()
    h.ctx.session = createSession(h.ctx.keyring, h.ctx.settings)
    const key = await kdf.deriveKeyMaterial(phrase, h.entry.salt)
    const encrypted = await encryptText(key.key, 'verified payload')
    const started = deferred(), release = deferred(), finished = deferred()
    let modal: any
    vi.mocked(BdApi.UI.showConfirmationModal).mockImplementation((_: any, content: any, options: any) => { modal = { content, options }; return '' })
    const done = openRecoverKeyModal(h.ctx, { keyId: h.entry.id, salt: h.entry.salt }, channel, async candidate => {
      await decryptText(candidate, encrypted.iv, encrypted.ct)
      started.resolve(); await release.promise; finished.resolve()
    })
    modal.content.props.passRef.value = phrase
    modal.content.props.onEnter({ closest: () => null })
    await started.promise
    modal.options.onCancel()
    release.resolve()
    await finished.promise
    expect(await done).toBe(false)
    expect(h.disk.get('keyring')).toEqual([damaged])
    expect(h.ctx.session.isUnlocked(h.entry.id)).toBe(false)
  })

  it('reads the actual password input on confirm, including input without onChange', async () => {
    const h = await harness()
    const { done, modal } = await h.launch('unlock')
    const tree = modal.content.type(modal.content.props)
    const input = tree.props.children.find((child: any) => child?.type === 'input')
    const dom = { value: phrase, disabled: false }
    input.props.ref(dom)
    modal.content.props.passRef.value = 'stale ref'
    modal.options.onConfirm()
    expect(await done).toBe(true)
    expect(dom.value).toBe('')
    expect(dom.disabled).toBe(true)
  })
})
