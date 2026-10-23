import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createKeyring } from '../src/core/keyring'
import { createSession } from '../src/core/session'
import { createSettingsStore } from '../src/settings'
import { createDecryptCache } from '../src/core/decryptCache'
import { applySendPatch } from '../src/patches/send'
import { applyUploadPatch } from '../src/patches/upload'
import { openChannelPhraseModal, openRecoverKeyModal } from '../src/ui/UnlockModal'
import { deriveKeyMaterial } from '../src/crypto/kdf'
import { decryptText, encryptText } from '../src/crypto/cipher'
import { encodeWire, parseWire } from '../src/crypto/wire'
import { decryptBpenc, encryptFileToBpenc, peekBpencSalt } from '../src/crypto/bpenc'
import { b64urlEncode } from '../src/crypto/b64'
import { selectSendKey } from '../src/core/sendKey'
import { applyContextMenuPatches } from '../src/patches/contextMenu'
import type { KeyEntry, PluginContext, WireParts } from '../src/types'

const CHANNEL = '123456789012345678'
const PHRASE = 'four tiny moons over the rooftop'
const cleanups: Array<() => void> = []
afterEach(() => { cleanups.splice(0).forEach((fn) => fn()); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function harness() {
  const disk = new Map<string, any>()
  const toasts = vi.fn()
  const confirm = vi.fn()
  vi.stubGlobal('BdApi', {
    Data: { load: (_plugin: string, key: string) => disk.get(key), save: (_plugin: string, key: string, value: any) => disk.set(key, structuredClone(value)) },
    UI: { showToast: toasts, showConfirmationModal: confirm },
    React: { createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }) },
  })
  const settings = createSettingsStore()
  const keyring = createKeyring()
  const session = createSession(keyring, settings)
  const actions = { sendMessage: vi.fn(async (..._args: any[]): Promise<any> => ({ ok: true })) }
  const original = actions.sendMessage
  const uploaded: File[] = []
  class CloudUpload {
    item: { file: File }
    filename: string
    size: number
    mimeType: string
    constructor(file: File) { this.item = { file }; this.filename = file.name; this.size = file.size; this.mimeType = file.type }
    async uploadFileToCloud() { uploaded.push(this.item.file); return { ok: true } }
  }
  const unpatches: Array<() => void> = []
  const patcher = {
    instead(_caller: string, module: any, method: string, cb: any) {
      const native = module[method]
      module[method] = function (...args: any[]) { return cb(this, args, native) }
      const undo = () => { module[method] = native }
      unpatches.push(undo)
      return undo
    },
  }
  const ctx = {
    keyring, session, settings, cache: createDecryptCache(settings), patcher,
    modules: { MessageActions: actions, CloudUpload, SelectedChannelStore: { getChannelId: () => CHANNEL }, failed: [] },
    disposers: [], forceRerender: vi.fn(),
  } as unknown as PluginContext
  cleanups.push(() => { session.stop(); unpatches.reverse().forEach((undo) => undo()) })
  async function arm() {
    const entry = await keyring.create('channel:' + CHANNEL, PHRASE, CHANNEL)
    await session.unlock(entry, PHRASE)
    keyring.setActiveSendKey(CHANNEL, entry.id)
    keyring.setEncryptMode(CHANNEL, true)
    return entry
  }
  return { ctx, arm, actions, original, disk, toasts, confirm, CloudUpload, uploaded }
}

async function webEnvelope(plaintext = 'private web message') {
  const salt = b64urlEncode(crypto.getRandomValues(new Uint8Array(16)))
  const { key, keyId } = await deriveKeyMaterial(PHRASE, salt)
  const { iv, ct } = await encryptText(key, plaintext)
  return { key, parts: { keyId, salt, iv, ciphertext: ct } satisfies WireParts }
}

describe('web ↔ plugin recovery', () => {
  it('opens a web-generated random-salt message with only its phrase, without replacing the channel send key', async () => {
    const h = harness()
    const active = await h.arm()
    const { parts } = await webEnvelope()
    h.confirm.mockImplementation((_title: string, content: any, options: any) => {
      content.props.passRef.value = PHRASE
      options.onConfirm()
      options.onCloseCallback()
      return 'modal'
    })
    const ok = await openRecoverKeyModal(h.ctx, parts, CHANNEL, (key) => decryptText(key, parts.iv, parts.ciphertext))
    expect(ok).toBe(true)
    const recovered = h.ctx.keyring.get(parts.keyId)!
    expect(recovered.salt).toBe(parts.salt)
    expect(h.ctx.keyring.getActiveSendKey(CHANNEL)).toBe(active.id)
    const key = h.ctx.session.getKey(parts.keyId)!
    await expect(decryptText(key, parts.iv, parts.ciphertext)).resolves.toBe('private web message')
    expect(JSON.stringify([...h.disk.values()])).not.toContain(PHRASE)
    expect(JSON.stringify([...h.disk.values()])).not.toContain('private web message')
    // A fresh local keyring can still read its saved metadata and unlock it.
    const reloaded = createKeyring()
    const other = createSession(reloaded, h.ctx.settings)
    await expect(other.unlock(reloaded.get(parts.keyId)!, PHRASE)).resolves.toBe(true)
    other.stop()
  })

  it('wrong phrases and tampered payloads never pollute the recipient keyring', async () => {
    const h = harness()
    const { parts } = await webEnvelope()
    await expect(h.ctx.keyring.recover('received', 'wrong', parts, CHANNEL,
      (key) => decryptText(key, parts.iv, parts.ciphertext))).rejects.toThrow()
    expect(h.ctx.keyring.list()).toHaveLength(0)
    const broken = (parts.ciphertext[0] === 'A' ? 'B' : 'A') + parts.ciphertext.slice(1)
    await expect(h.ctx.keyring.recover('received', PHRASE, parts, CHANNEL,
      (key) => decryptText(key, parts.iv, broken))).rejects.toThrow()
    expect(h.ctx.keyring.list()).toHaveLength(0)
  })

  it('recovers a shared file key from BPENC1 salt and authenticates all file bytes first', async () => {
    const h = harness()
    const { key, parts } = await webEnvelope()
    const data = new TextEncoder().encode('file body')
    const container = await encryptFileToBpenc(key, parts.keyId, parts.salt, data, 'notes.txt', 'text/plain')
    const entry = await h.ctx.keyring.recover('received file', PHRASE,
      { keyId: parts.keyId, salt: peekBpencSalt(container)! }, CHANNEL, (candidate) => decryptBpenc(candidate, container))
    expect(entry.id).toBe(parts.keyId)
    await h.ctx.session.unlock(entry, PHRASE)
    const opened = await decryptBpenc(h.ctx.session.getKey(entry.id)!, container)
    expect(opened.header.filename).toBe('notes.txt')
    expect(new TextDecoder().decode(opened.data)).toBe('file body')
  })

  it('reads a v1 URL copied back from a directory-index redirect', () => {
    const link = 'https://betterprivacy.app/m/#v1.AAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAA.YWJj'
    expect(parseWire(link)).toEqual({ keyId: 'AAAAAAAA', salt: 'AAAAAAAAAAAAAAAAAAAAAA', iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'YWJj' })
  })
})

describe('plugin send → share', () => {
  it('keeps history keys open while text and files both use the explicitly selected send key', async () => {
    const h = harness()
    const first = await h.arm()
    const second = await h.ctx.keyring.create('Team', PHRASE + ' second', CHANNEL)
    await h.ctx.session.unlock(second, PHRASE + ' second')
    applySendPatch(h.ctx)
    applyUploadPatch(h.ctx)
    // Opening B to read history does not switch sending away from A.
    await h.actions.sendMessage(CHANNEL, { content: 'still A' })
    expect(parseWire(h.original.mock.calls[0]![1].content)?.keyId).toBe(first.id)
    expect(await selectSendKey(h.ctx, CHANNEL, second.id, async () => true)).toBe(true)
    await h.actions.sendMessage(CHANNEL, { content: 'now B' })
    const parts = parseWire(h.original.mock.calls[1]![1].content)!
    expect(parts.keyId).toBe(second.id)
    await expect(decryptText(h.ctx.session.getKey(second.id)!, parts.iv, parts.ciphertext)).resolves.toBe('now B')
    await new h.CloudUpload(new File(['file for B'], 'note.txt', { type: 'text/plain' })).uploadFileToCloud()
    const bytes = new Uint8Array(await h.uploaded[0]!.arrayBuffer())
    const opened = await decryptBpenc(h.ctx.session.getKey(second.id)!, bytes)
    expect(new TextDecoder().decode(opened.data)).toBe('file for B')
    expect(h.ctx.session.isUnlocked(first.id)).toBe(true)
  })

  it('blocks both text and files when multiple keys have no sending selection', async () => {
    const h = harness()
    await h.arm()
    await h.ctx.keyring.create('Team', PHRASE + ' second', CHANNEL)
    h.ctx.keyring.setActiveSendKey(CHANNEL, null)
    applySendPatch(h.ctx)
    applyUploadPatch(h.ctx)
    await h.actions.sendMessage(CHANNEL, { content: 'must not guess a key' })
    await expect(new h.CloudUpload(new File(['private'], 'note.txt')).uploadFileToCloud()).rejects.toThrow()
    expect(h.original).not.toHaveBeenCalled()
    expect(h.uploaded).toHaveLength(0)
  })

  it('cancels unsent parts if the sending key changes while a long send is in flight', async () => {
    const h = harness()
    await h.arm()
    const second = await h.ctx.keyring.create('Team', PHRASE + ' second', CHANNEL)
    h.original.mockImplementationOnce(async () => {
      h.ctx.keyring.setActiveSendKey(CHANNEL, second.id)
      return { ok: true }
    })
    applySendPatch(h.ctx)
    await h.actions.sendMessage(CHANNEL, { content: 'a'.repeat(4000) })
    expect(h.original).toHaveBeenCalledOnce()
  })

  it('does not upload bytes encrypted with an obsolete selection after a key switch', async () => {
    const h = harness()
    await h.arm()
    const second = await h.ctx.keyring.create('Team', PHRASE + ' second', CHANNEL)
    const file = new File(['private file'], 'note.txt')
    const read = file.arrayBuffer.bind(file)
    vi.spyOn(file, 'arrayBuffer').mockImplementation(async () => {
      const bytes = await read()
      h.ctx.keyring.setActiveSendKey(CHANNEL, second.id)
      return bytes
    })
    applyUploadPatch(h.ctx)
    await expect(new h.CloudUpload(file).uploadFileToCloud()).rejects.toThrow()
    expect(h.uploaded).toHaveLength(0)
  })

  it('the message reply-key action selects that key without sending or locking history', async () => {
    const h = harness()
    const first = await h.arm()
    const second = await h.ctx.keyring.create('Team', PHRASE + ' second', CHANNEL)
    await h.ctx.session.unlock(second, PHRASE + ' second')
    const callbacks = new Map<string, any>()
    ;(BdApi as any).ContextMenu = {
      patch: (name: string, fn: any) => { callbacks.set(name, fn); return () => {} },
      buildItem: (item: any) => item,
    }
    applyContextMenuPatches(h.ctx)
    const { iv, ct } = await encryptText(h.ctx.session.getKey(second.id)!, 'old message')
    const content = encodeWire({ keyId: second.id, salt: second.salt, iv, ciphertext: ct })
    const tree = { props: { children: [] as any[] } }
    callbacks.get('message')(tree, { message: { content, channel_id: CHANNEL } })
    await tree.props.children.find(item => item.id === 'bp-reply-key').action()
    expect(h.ctx.keyring.getActiveSendKey(CHANNEL)).toBe(second.id)
    expect(h.ctx.session.isUnlocked(first.id)).toBe(true)
    expect(h.original).not.toHaveBeenCalled()
  })

  it('encrypts long Unicode text into ordered, individually openable links and preserves the draft', async () => {
    const h = harness()
    const entry = await h.arm()
    applySendPatch(h.ctx)
    const text = ('gece yarısı 🦇 rooftop\n').repeat(140)
    const message = { content: text, tts: false }
    await h.actions.sendMessage(CHANNEL, message, { reply: 'reference' })
    const calls = h.original.mock.calls
    expect(calls.length).toBeGreaterThan(1)
    const opened = await Promise.all(calls.map(async (args) => {
      expect(args[0]).toBe(CHANNEL)
      expect(args[1].content.length).toBeLessThanOrEqual(2000)
      const parts = parseWire(args[1].content)!
      expect(parts).not.toBeNull()
      return decryptText(h.ctx.session.getKey(entry.id)!, parts.iv, parts.ciphertext)
    }))
    expect(opened.join('')).toBe(text)
    expect(calls[0]![2]).toEqual({ reply: 'reference' })
    expect(calls[1]).toHaveLength(2)
    expect(message.content).toBe(text)
  })

  it('a declined many-part confirmation sends nothing', async () => {
    const h = harness()
    await h.arm()
    applySendPatch(h.ctx)
    h.confirm.mockImplementation((_t, _c, opts) => { opts.onCloseCallback(); return 'modal' })
    await h.actions.sendMessage(CHANNEL, { content: 'a'.repeat(16000) })
    expect(h.original).not.toHaveBeenCalled()
  })

  it('cancels remaining parts after a resolved API failure', async () => {
    const h = harness()
    await h.arm()
    h.original.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false })
    applySendPatch(h.ctx)
    await h.actions.sendMessage(CHANNEL, { content: 'a'.repeat(6000) })
    expect(h.original).toHaveBeenCalledTimes(2)
    expect(h.toasts.mock.calls.some((call) => call[1]?.type === 'error')).toBe(true)
  })

  it('stops remaining parts when the key is locked during a send', async () => {
    const h = harness()
    await h.arm()
    h.original.mockImplementationOnce(async () => { h.ctx.session.lockAll('manual'); return { ok: true } })
    applySendPatch(h.ctx)
    await h.actions.sendMessage(CHANNEL, { content: 'a'.repeat(5000) })
    expect(h.original).toHaveBeenCalledTimes(1)
  })

  it('does not call the native sender if encrypt-mode state throws', async () => {
    const h = harness()
    h.ctx.keyring.isEncryptModeOn = () => { throw new Error('state unavailable') }
    applySendPatch(h.ctx)
    await h.actions.sendMessage(CHANNEL, { content: 'private' })
    expect(h.original).not.toHaveBeenCalled()
  })
})

describe('plugin file upload', () => {
  it('uploads only a BPENC1 file that the published reader format can open', async () => {
    const h = harness()
    const entry = await h.arm()
    applyUploadPatch(h.ctx)
    const source = new File(['hello file'], 'private.txt', { type: 'text/plain' })
    await new h.CloudUpload(source).uploadFileToCloud()
    expect(h.uploaded).toHaveLength(1)
    const file = h.uploaded[0]!
    expect(file.name).toMatch(/^[a-z0-9]{8}\.bpenc$/)
    expect(file.type).toBe('application/octet-stream')
    const opened = await decryptBpenc(h.ctx.session.getKey(entry.id)!, new Uint8Array(await file.arrayBuffer()))
    expect(opened.header.filename).toBe('private.txt')
    expect(new TextDecoder().decode(opened.data)).toBe('hello file')
  })

  it('a plaintext text override cannot disable encryption on an unrelated file upload', async () => {
    const h = harness()
    await h.arm()
    applySendPatch(h.ctx); applyUploadPatch(h.ctx)
    await h.actions.sendMessage(CHANNEL, { content: '/pt public caption' })
    await new h.CloudUpload(new File(['private'], 'private.txt')).uploadFileToCloud()
    expect(h.original.mock.calls[0]![1].content).toBe('public caption')
    expect(h.uploaded[0]!.name).toMatch(/\.bpenc$/)
  })

  it('aborts a locked/cancelled upload rather than calling the native uploader', async () => {
    const h = harness()
    await h.arm()
    h.ctx.session.lockAll('manual')
    h.confirm.mockImplementation((_title, _body, opts) => { opts.onCancel(); return 'modal' })
    applyUploadPatch(h.ctx)
    await expect(new h.CloudUpload(new File(['private'], 'private.txt')).uploadFileToCloud()).rejects.toThrow()
    expect(h.uploaded).toHaveLength(0)
  })

  it('does not trust a .bpenc filename and does not double-encrypt its own upload retry', async () => {
    const h = harness()
    const entry = await h.arm()
    applyUploadPatch(h.ctx)
    const upload = new h.CloudUpload(new File(['still private plaintext'], 'fake.bpenc'))
    await upload.uploadFileToCloud()
    const first = h.uploaded[0]!
    const opened = await decryptBpenc(h.ctx.session.getKey(entry.id)!, new Uint8Array(await first.arrayBuffer()))
    expect(new TextDecoder().decode(opened.data)).toBe('still private plaintext')
    await upload.uploadFileToCloud()
    expect(h.uploaded[1]).toBe(first)
  })

  it('cancels a file whose key is locked while its bytes are still being read', async () => {
    const h = harness()
    await h.arm()
    applyUploadPatch(h.ctx)
    const file = new File(['private'], 'private.txt')
    const read = file.arrayBuffer.bind(file)
    file.arrayBuffer = async () => { h.ctx.session.lockAll('manual'); return read() }
    await expect(new h.CloudUpload(file).uploadFileToCloud()).rejects.toThrow()
    expect(h.uploaded).toHaveLength(0)
  })

  it('blocks file selection while the upload hook is missing and removes its guard on stop', async () => {
    const h = harness()
    await h.arm()
    const dom = new JSDOM('<input type="file" id="file">')
    vi.stubGlobal('document', dom.window.document)
    h.ctx.modules.CloudUpload = null
    applyUploadPatch(h.ctx)
    const input: any = dom.window.document.getElementById('file')
    Object.defineProperty(input, 'files', { value: [new File(['private'], 'private.txt')] })
    const native = vi.fn()
    input.addEventListener('change', native)
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true, cancelable: true }))
    expect(native).not.toHaveBeenCalled()
    h.ctx.keyring.setEncryptMode(CHANNEL, false)
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true, cancelable: true }))
    expect(native).toHaveBeenCalledTimes(1)
    h.ctx.disposers.forEach((dispose) => dispose())
    h.ctx.keyring.setEncryptMode(CHANNEL, true)
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true, cancelable: true }))
    expect(native).toHaveBeenCalledTimes(2)
    dom.window.close()
  })
})

describe('session lock lifecycle', () => {
  it('a lock during envelope authentication cannot import and unlock the key afterward', async () => {
    const h = harness()
    const { parts } = await webEnvelope()
    h.confirm.mockImplementation((_title, content, options) => {
      content.props.passRef.value = PHRASE
      options.onConfirm()
      return 'modal'
    })
    await expect(openRecoverKeyModal(h.ctx, parts, CHANNEL, async (key) => {
      await decryptText(key, parts.iv, parts.ciphertext)
      h.ctx.session.lockAll('manual')
    })).resolves.toBe(false)
    expect(h.ctx.keyring.list()).toHaveLength(0)
    expect(h.ctx.session.isUnlocked(parts.keyId)).toBe(false)
  })

  it('a lock while channel setup is deriving a key cannot re-arm the channel', async () => {
    const h = harness()
    const create = h.ctx.keyring.create.bind(h.ctx.keyring)
    h.ctx.keyring.create = async (...args) => {
      const entry = await create(...args)
      h.ctx.session.lockAll('manual')
      return entry
    }
    h.confirm.mockImplementation((_title, content, options) => {
      content.props.passRef.value = PHRASE
      options.onConfirm()
      return 'modal'
    })
    await expect(openChannelPhraseModal(h.ctx, CHANNEL)).resolves.toBeNull()
    expect(h.ctx.keyring.getActiveSendKey(CHANNEL)).toBeNull()
    expect(h.ctx.keyring.isEncryptModeOn(CHANNEL)).toBe(false)
  })

  it.each(['lock', 'stop', 'remove'] as const)('a pending unlock cannot resurrect a key after %s', async (action) => {
    const h = harness()
    const entry = await h.ctx.keyring.create('channel:' + CHANNEL, PHRASE, CHANNEL)
    const pending = h.ctx.session.unlock(entry, PHRASE)
    if (action === 'lock') h.ctx.session.lockAll('manual')
    if (action === 'stop') h.ctx.session.stop()
    if (action === 'remove') h.ctx.keyring.remove(entry.id)
    await expect(pending).resolves.toBe(false)
    expect(h.ctx.session.isUnlocked(entry.id)).toBe(false)
  })
})
