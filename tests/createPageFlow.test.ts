import { readFileSync } from 'node:fs'
import { JSDOM, VirtualConsole } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createKeyring } from '../src/core/keyring'
import { createSession } from '../src/core/session'
import { createSettingsStore } from '../src/settings'
import { parseWire } from '../src/crypto/wire'
import { deriveKeyMaterial } from '../src/crypto/kdf'
import { decryptText } from '../src/crypto/cipher'

const read = (path: string) => readFileSync(new URL('../site/' + path, import.meta.url), 'utf8')
const PHRASE = 'four tiny moons over the rooftop'
afterEach(() => { vi.unstubAllGlobals() })

// Execute the shipped scripts in their actual order, without a server or network.
function page(path = 'create/index.html', hash = '', setup?: (w: any) => void) {
  const scripts: string[] = []
  let html = read(path).replace(/<script src="\/assets\/([^"]+)"[^>]*><\/script>/g, (_match, file) => {
    scripts.push(read('assets/' + file))
    return ''
  })
  html = html.replace('</body>', scripts.map((script) => '<script>' + script + '</script>').join('\n') + '</body>')
  const errors: string[] = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', (e: any) => errors.push(String(e)))
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://betterprivacy.app/' + (path.startsWith('create') ? 'create/' : 'm/') + hash,
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(w: any) {
      Object.defineProperty(w, 'crypto', { value: crypto, configurable: true })
      w.TextEncoder = TextEncoder
      w.TextDecoder = TextDecoder
      w.URL.createObjectURL = () => 'blob:test'
      w.URL.revokeObjectURL = () => {}
      setup?.(w)
    },
  })
  expect(errors).toEqual([])
  const w: any = dom.window
  return {
    w, errors,
    $(id: string): any { return w.document.getElementById(id) },
    input(id: string, value: string) {
      const input = w.document.getElementById(id)
      input.value = value
      input.dispatchEvent(new w.Event('input', { bubbles: true }))
    },
    submit(id: string) { w.document.getElementById(id).dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })) },
  }
}

async function until(test: () => boolean) {
  const end = Date.now() + 10000
  while (!test() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 10))
  expect(test(), 'page operation did not settle').toBe(true)
}

async function makeLink(text = 'Meet at midnight 🦇 <img src=x onerror=alert(1)>') {
  const p = page()
  p.input('message', text)
  p.input('create-phrase', PHRASE)
  p.submit('create-form')
  await until(() => !p.$('create-submit').disabled)
  expect(p.$('generated').hidden).toBe(false)
  expect(p.errors).toEqual([])
  return p
}

describe('web create → share → open', () => {
  it('the real composer creates v1 links the plugin and existing reader both decrypt', async () => {
    const plaintext = 'Meet at midnight 🦇 <img src=x onerror=alert(1)>'
    const p = await makeLink(plaintext)
    const link = p.$('share-link').value
    const wire = parseWire(link)!
    expect(wire).not.toBeNull()
    expect(('🦇<' + link + '>').length).toBeLessThanOrEqual(2000)
    const material = await deriveKeyMaterial(PHRASE, wire.salt)
    expect(material.keyId).toBe(wire.keyId)
    await expect(decryptText(material.key, wire.iv, wire.ciphertext)).resolves.toBe(plaintext)
    // Admit the REAL web composer's result through the plugin's keyring/session,
    // not just through the shared low-level cipher.
    const disk = new Map<string, unknown>()
    vi.stubGlobal('BdApi', { Data: {
      load: (_p: string, name: string) => disk.get(name),
      save: (_p: string, name: string, value: unknown) => disk.set(name, value),
    } })
    const keyring = createKeyring()
    const session = createSession(keyring, createSettingsStore())
    const recovered = await keyring.recover('web message', PHRASE, wire, 'global',
      (key) => decryptText(key, wire.iv, wire.ciphertext))
    await expect(session.unlock(recovered, PHRASE)).resolves.toBe(true)
    await expect(decryptText(session.getKey(recovered.id)!, wire.iv, wire.ciphertext)).resolves.toBe(plaintext)
    session.stop()
    // Visit what the recipient actually gets and submit through the real reader form.
    const reader = page('m/index.html', new URL(link).hash)
    reader.input('phrase', PHRASE)
    reader.submit('form')
    await until(() => !reader.$('go').disabled)
    expect(reader.$('result').hidden).toBe(false)
    expect(reader.$('result').textContent).toBe(plaintext)
    expect(reader.$('result').querySelector('img')).toBeNull()
    expect(reader.$('phrase').value).toBe('')
    reader.$('forget-message').click()
    expect(reader.$('result').textContent).toBe('')
    expect(reader.$('result').hidden).toBe(true)
    expect(p.w.localStorage.getItem('bp-lang')).toBe('en')
    expect(p.w.localStorage.length).toBe(1)
    p.w.close(); reader.w.close()
  })

  it('creates fresh salts and IVs on repeated encryption, and hides outdated links after edits', async () => {
    const p = await makeLink('hello')
    const a = parseWire(p.$('share-link').value)!
    p.submit('create-form')
    await until(() => !p.$('create-submit').disabled)
    const b = parseWire(p.$('share-link').value)!
    expect(b.salt).not.toBe(a.salt)
    expect(b.iv).not.toBe(a.iv)
    p.input('message', 'edited')
    expect(p.$('generated').hidden).toBe(true)
    expect(p.$('share-link').value).toBe('')
    expect(p.$('open-created').hasAttribute('href')).toBe(false)
    p.w.close()
  })

  it('rejects empty input and Unicode beyond the one-link byte budget', () => {
    const p = page()
    p.submit('create-form')
    expect(p.$('create-status').textContent).toBe('Write a message first.')
    p.input('message', '🦇'.repeat(341))
    p.input('create-phrase', PHRASE)
    p.submit('create-form')
    expect(p.$('create-status').textContent).toContain('too long')
    expect(p.$('message-budget').classList.contains('over')).toBe(true)
    expect(p.$('generated').hidden).toBe(true)
    p.w.close()
  })

  it('does not publish an obsolete result if a phrase is edited while encrypting', async () => {
    const p = page()
    p.input('message', 'hello')
    p.input('create-phrase', PHRASE)
    p.submit('create-form')
    p.input('create-phrase', 'a different phrase')
    await until(() => !p.$('create-submit').disabled)
    expect(p.$('generated').hidden).toBe(true)
    expect(p.$('create-status').textContent).toContain('edited')
    p.w.close()
  })

  it('supports mobile sharing and manual copy when clipboard permission is unavailable', async () => {
    const p = page('create/index.html', '', (w) => {
      w.navigator.share = async (data: unknown) => { w.shared = data }
    })
    p.input('message', 'hello')
    p.input('create-phrase', PHRASE)
    p.submit('create-form')
    await until(() => !p.$('create-submit').disabled)
    expect(p.$('share-native').hidden).toBe(false)
    p.$('share-native').click()
    await until(() => !!p.w.shared)
    expect(p.w.shared.url).toBe(p.$('share-link').value)
    expect(JSON.stringify(p.w.shared)).not.toContain(PHRASE)
    p.$('copy-link').click()
    await until(() => p.$('share-status').textContent.includes('manually'))
    expect(p.$('share-link').selectionStart).toBe(0)
    expect(p.$('share-link').selectionEnd).toBe(p.$('share-link').value.length)
    p.$('start-over').click()
    expect(p.$('message').value).toBe('')
    expect(p.$('create-phrase').value).toBe('')
    expect(p.$('generated').hidden).toBe(true)
    p.w.close()
  })

  it('accepts pasted plugin wrappers and rejects external or incomplete links', async () => {
    const creator = await makeLink('private')
    const reader = page('m/index.html')
    reader.input('paste-link', 'https://example.org/m#v1.AAAAAAAA')
    reader.submit('paste-form')
    expect(reader.$('paste-status').textContent).toContain('not a complete')
    expect(reader.$('box').hidden).toBe(true)
    reader.input('paste-link', '🦇<' + creator.$('share-link').value + '>')
    reader.submit('paste-form')
    await until(() => !reader.$('box').hidden)
    // Let the browser's hashchange finish before typing the phrase.
    await new Promise((r) => setTimeout(r, 25))
    reader.input('phrase', PHRASE)
    reader.submit('form')
    await until(() => !reader.$('go').disabled)
    expect(reader.$('result').textContent).toBe('private')
    expect(reader.errors).toEqual([])
    creator.w.close(); reader.w.close()
  })

  it('switches the whole create flow between EN/TR/RU without losing the draft', () => {
    const p = page()
    p.input('message', 'keep this draft')
    for (const lang of ['tr', 'ru', 'en']) {
      p.w.document.querySelector('[data-lang="' + lang + '"]').click()
      expect(p.w.document.documentElement.lang).toBe(lang)
      expect(p.$('message').value).toBe('keep this draft')
      p.w.document.querySelectorAll('[data-copy]').forEach((node: any) => {
        expect(node.textContent).not.toBe(node.getAttribute('data-copy'))
      })
    }
    p.w.close()
  })

  it('ignores an old clipboard failure after the sender edits the message', async () => {
    let rejectCopy!: (reason: Error) => void
    const p = page('create/index.html', '', (w) => {
      w.navigator.clipboard = { writeText: () => new Promise((_resolve, reject) => { rejectCopy = reject }) }
    })
    p.input('message', 'before edit')
    p.input('create-phrase', PHRASE)
    p.submit('create-form')
    await until(() => !p.$('create-submit').disabled)
    p.$('copy-link').click()
    p.input('message', 'after edit')
    rejectCopy(new Error('clipboard permission denied'))
    await new Promise((r) => setTimeout(r, 20))
    expect(p.$('generated').hidden).toBe(true)
    expect(p.$('share-status').textContent).toBe('')
    expect(p.$('share-link').value).toBe('')
    p.w.close()
  })

  it('reveals nothing on a wrong phrase and clears plaintext when the recipient leaves', async () => {
    const creator = await makeLink('only between us')
    const reader = page('m/index.html', new URL(creator.$('share-link').value).hash)
    reader.input('phrase', 'wrong phrase')
    reader.submit('form')
    await until(() => !reader.$('go').disabled)
    expect(reader.$('result').hidden).toBe(true)
    expect(reader.$('status').classList.contains('err')).toBe(true)
    reader.input('phrase', PHRASE)
    reader.submit('form')
    await until(() => !reader.$('go').disabled)
    expect(reader.$('result').textContent).toBe('only between us')
    reader.$('copy').click()
    await until(() => reader.$('status').textContent.includes('manually'))
    expect(reader.w.getSelection().toString()).toBe('only between us')
    reader.w.dispatchEvent(new reader.w.Event('pagehide'))
    expect(reader.$('result').textContent).toBe('')
    expect(reader.$('phrase').value).toBe('')
    creator.w.close(); reader.w.close()
  })
})
