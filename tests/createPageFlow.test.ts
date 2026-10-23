import { readFileSync } from 'node:fs'
import { JSDOM, VirtualConsole } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createKeyring } from '../src/core/keyring'
import { createSession } from '../src/core/session'
import { createSettingsStore } from '../src/settings'
import { parseWire, chunkPlaintext, CHUNK_UTF8_BYTES } from '../src/crypto/wire'
import { deriveKeyMaterial } from '../src/crypto/kdf'
import { decryptText } from '../src/crypto/cipher'
import jsQR from 'jsqr'

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

// Rasterize the shipped SVG's rectangles, then use an unrelated QR decoder.
// This reads the actual download image, not the encoder's matrix or arguments.
function decodeSvg(svg: string) {
  const dom = new JSDOM('')
  try {
    const doc = new dom.window.DOMParser().parseFromString(svg, 'image/svg+xml')
    const side = Number(doc.documentElement.getAttribute('viewBox')!.split(' ')[2])
    const scale = 4, width = side * scale
    const pixels = new Uint8ClampedArray(width * width * 4).fill(255)
    for (const rect of doc.querySelectorAll('rect')) {
      if (rect.getAttribute('fill') === 'white') continue
      const x = Number(rect.getAttribute('x')), y = Number(rect.getAttribute('y'))
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const offset = ((y * scale + dy) * width + x * scale + dx) * 4
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0
      }
      expect(x).toBeGreaterThanOrEqual(4)
      expect(y).toBeGreaterThanOrEqual(4)
      expect(x).toBeLessThan(side - 4)
      expect(y).toBeLessThan(side - 4)
    }
    expect(doc.querySelector('rect[fill="white"][width="100%"][height="100%"]')).not.toBeNull()
    expect(doc.querySelector('script,foreignObject,image,a')).toBeNull()
    return jsQR(pixels, width, width, { inversionAttempts: 'dontInvert' })
  } finally { dom.window.close() }
}

describe('local short-link QR sharing', () => {
  it('decodes the actual viewer/download SVG to only the encrypted URL, with a four-module quiet zone', async () => {
    const blobs: Blob[] = []
    const p = page('create/index.html', '', w => {
      w.Blob = Blob
      w.URL.createObjectURL = (blob: Blob) => { blobs.push(blob); return 'blob:qr-download' }
    })
    try {
      p.input('message', 'short private note 🦇')
      p.input('create-phrase', PHRASE)
      p.submit('create-form')
      await until(() => !p.$('create-submit').disabled)
      const link = p.$('share-link').value
      expect(p.$('show-qr').hidden).toBe(false)
      expect(p.$('qr-panel').hidden).toBe(true)
      expect(blobs).toHaveLength(0)
      p.$('show-qr').click()
      expect(p.$('qr-panel').hidden).toBe(false)
      expect(p.$('show-qr').getAttribute('aria-expanded')).toBe('true')
      expect(p.$('show-qr').getAttribute('aria-controls')).toBe('qr-panel')
      expect(p.$('qr-image').getAttribute('src')).toBe('blob:qr-download')
      expect(p.$('download-qr').getAttribute('href')).toBe('blob:qr-download')
      expect(p.$('download-qr').getAttribute('download')).toBe('BetterPrivacy-QR.svg')
      expect(blobs[0]!.type).toBe('image/svg+xml')
      const svg = await blobs[0]!.text()
      const decoded = decodeSvg(svg)
      expect(decoded?.data).toBe(link)
      expect(svg).not.toContain(PHRASE)
      expect(svg).not.toContain('short private note')
      const parts = parseWire(decoded!.data)!
      const material = await deriveKeyMaterial(PHRASE, parts.salt)
      await expect(decryptText(material.key, parts.iv, parts.ciphertext)).resolves.toBe('short private note 🦇')
      for (const lang of ['tr', 'ru', 'en']) {
        p.w.BPUI.apply(lang)
        expect(p.$('qr-image').alt).toBe(p.w.BPUI.text('qrAlt'))
        expect(p.$('show-qr').textContent).toBe(p.w.BPUI.text('qrHide'))
        expect(p.$('download-qr').textContent).toBe(p.w.BPUI.text('qrDownload'))
        expect(p.$('qr-image').src).toBe('blob:qr-download')
      }
      expect(p.w.localStorage.length).toBe(1)
    } finally { p.w.close() }
  })

  it('enforces the exact 256-byte URL cap and independently decodes its largest allowed symbol', () => {
    const p = page()
    try {
      const prefix = 'https://betterprivacy.app/m#v1.AAAAAAAA.' + 'A'.repeat(22) + '.' + 'A'.repeat(16) + '.'
      const link = prefix + 'A'.repeat(256 - prefix.length)
      expect(p.w.BPQR.MAX_URL_BYTES).toBe(256)
      expect(p.w.BPQR.canEncode(link)).toBe(true)
      expect(decodeSvg(p.w.BPQR.svg(link))?.data).toBe(link)
      expect(p.w.BPQR.canEncode(link + 'A')).toBe(false)
      expect(() => p.w.BPQR.svg(link + 'A')).toThrow()
      expect(() => p.w.BPQR.svg(PHRASE)).toThrow()
    } finally { p.w.close() }
  })

  it.each(['a'.repeat(180), '🦇'.repeat(341)])('keeps QR hidden for a long single link or multipart message (%#)', async text => {
    const p = await makeLink(text)
    try {
      expect(p.$('show-qr').hidden).toBe(true)
      expect(p.$('qr-panel').hidden).toBe(true)
      expect(p.$('qr-image').hasAttribute('src')).toBe(false)
      expect(p.$('qr-limit').hidden).toBe(false)
      for (const lang of ['tr', 'ru', 'en']) {
        p.w.BPUI.apply(lang)
        expect(p.$('qr-limit').textContent).toBe(p.w.BPUI.text('qrLimit'))
        expect(p.$('qr-limit').textContent).toContain('256')
      }
      p.$('show-qr').click()
      expect(p.$('qr-image').hasAttribute('src')).toBe(false)
    } finally { p.w.close() }
  })

  it.each(['phrase', 'message', 'reset', 'pagehide', 'hide'])('clears QR and revokes its URL on %s', async action => {
    const p = await makeLink('short')
    try {
      const revoked = vi.fn()
      p.w.URL.revokeObjectURL = revoked
      p.$('show-qr').click()
      expect(p.$('qr-panel').hidden).toBe(false)
      if (action === 'phrase') p.input('create-phrase', 'different phrase')
      if (action === 'message') p.input('message', 'changed')
      if (action === 'reset') p.$('start-over').click()
      if (action === 'pagehide') p.w.dispatchEvent(new p.w.Event('pagehide'))
      if (action === 'hide') p.$('show-qr').click()
      expect(p.$('qr-panel').hidden).toBe(true)
      expect(p.$('qr-image').hasAttribute('src')).toBe(false)
      expect(p.$('download-qr').hasAttribute('href')).toBe(false)
      expect(p.$('show-qr').getAttribute('aria-expanded')).toBe('false')
      expect(revoked).toHaveBeenCalledExactlyOnceWith('blob:test')
    } finally { p.w.close() }
  })

  it('cleans up viewer errors, ignores obsolete image events and recovers on retry', async () => {
    const p = await makeLink('short')
    try {
      let next = 0
      const revoked = vi.fn()
      p.w.URL.createObjectURL = () => 'blob:qr-' + ++next
      p.w.URL.revokeObjectURL = revoked
      p.$('show-qr').click()
      const oldImage = p.$('qr-image')
      oldImage.dispatchEvent(new p.w.Event('error'))
      expect(revoked).toHaveBeenCalledWith('blob:qr-1')
      expect(p.$('qr-panel').hidden).toBe(true)
      expect(p.$('download-qr').hasAttribute('href')).toBe(false)
      expect(p.$('qr-status').textContent).toContain('could not be created')
      expect(p.$('generated').hidden).toBe(false)
      p.$('show-qr').click()
      oldImage.dispatchEvent(new p.w.Event('error'))
      expect(p.$('qr-panel').hidden).toBe(false)
      expect(p.$('download-qr').getAttribute('href')).toBe('blob:qr-2')
      expect(p.$('qr-status').textContent).toBe('')
      expect(revoked).toHaveBeenCalledTimes(1)
    } finally { p.w.close() }
  })

  it('leaves copy sharing intact when QR URL creation fails', async () => {
    const p = await makeLink('short')
    try {
      const link = p.$('share-link').value
      p.w.URL.createObjectURL = () => { throw new Error('URL creation unavailable') }
      p.$('show-qr').click()
      expect(p.$('qr-panel').hidden).toBe(true)
      expect(p.$('download-qr').hasAttribute('href')).toBe(false)
      expect(p.$('qr-status').classList.contains('err')).toBe(true)
      expect(p.$('share-link').value).toBe(link)
      expect(p.$('generated').hidden).toBe(false)
      p.w.URL.createObjectURL = () => 'blob:recovered'
      p.$('show-qr').click()
      expect(p.$('qr-panel').hidden).toBe(false)
    } finally { p.w.close() }
  })
})

describe('web create → share → open', () => {
  it('remasks and clears a revealed phrase before a page is restored from history', () => {
    const p = page()
    try {
      p.input('message', 'private draft')
      p.input('create-phrase', PHRASE)
      p.$('show-phrase').click()
      expect(p.$('create-phrase').type).toBe('text')
      p.w.dispatchEvent(new p.w.Event('pagehide'))
      expect(p.$('create-phrase').type).toBe('password')
      expect(p.$('create-phrase').value).toBe('')
      expect(p.$('message').value).toBe('')
      expect(p.$('show-phrase').getAttribute('aria-pressed')).toBe('false')
      expect(p.$('show-phrase').textContent).toBe('Show')
      p.input('create-phrase', 'new secret')
      expect(p.$('create-phrase').type).toBe('password')
    } finally { p.w.close() }
  })

  it('reports native-share failures even when the platform rejects without an Error', async () => {
    const p = page('create/index.html', '', w => { w.navigator.share = async () => { throw null } })
    try {
      p.input('message', 'share privately')
      p.input('create-phrase', PHRASE)
      p.submit('create-form')
      await until(() => !p.$('create-submit').disabled)
      p.$('share-native').click()
      await until(() => p.$('share-status').classList.contains('err'))
      expect(p.$('share-status').textContent).toContain('Copy the link instead')
      expect(p.$('generated').hidden).toBe(false)
      expect(p.errors).toEqual([])
    } finally { p.w.close() }
  })

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

  it('rejects empty input without treating long Unicode as invalid', () => {
    const p = page()
    p.submit('create-form')
    expect(p.$('create-status').textContent).toBe('Write a message first.')
    p.input('message', '🦇'.repeat(341))
    expect(p.$('message-budget').textContent).toContain('2 links')
    expect(p.$('message-budget').classList.contains('over')).toBe(false)
    expect(p.$('message').getAttribute('aria-invalid')).not.toBe('true')
    expect(p.$('generated').hidden).toBe(true)
    p.w.close()
  })

  it.each([
    'a'.repeat(1360),
    '🦇'.repeat(340),
    '🦇'.repeat(341),
    'a'.repeat(5000),
    '  Türkçe 🦇 Привет\n\t'.repeat(220) + '\n final space ',
  ])('splits losslessly at plugin-compatible UTF-8 boundaries (%#)', async (plaintext) => {
    const p = await makeLink(plaintext)
    const links = p.$('share-link').value.split('\n')
    const expected = chunkPlaintext(plaintext)
    expect(links).toHaveLength(expected.length)
    const first = parseWire(links[0])!
    const material = await deriveKeyMaterial(PHRASE, first.salt)
    const decoded = []
    const ivs = new Set()
    for (const link of links) {
      const wire = parseWire(link)!
      expect(wire.salt).toBe(first.salt)
      expect(wire.keyId).toBe(material.keyId)
      expect(('🦇<' + link + '>').length).toBeLessThanOrEqual(2000)
      ivs.add(wire.iv)
      const text = await decryptText(material.key, wire.iv, wire.ciphertext)
      expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(CHUNK_UTF8_BYTES)
      decoded.push(text)
    }
    expect(ivs.size).toBe(links.length)
    expect(decoded).toEqual(expected)
    expect(decoded.join('')).toBe(plaintext)
    expect(p.$('generated-parts').children.length).toBe(links.length > 1 ? links.length : 0)
    expect(p.$('open-created').hidden).toBe(links.length > 1)
    p.w.close()
  })

  it('copies all parts in order, copies individual parts, and shares multiple links as text without the phrase', async () => {
    const copied: string[] = []
    const p = page('create/index.html', '', (w) => {
      w.navigator.clipboard = { writeText: async (value: string) => { copied.push(value) } }
      w.navigator.share = async (value: unknown) => { w.shared = value }
    })
    p.input('message', '🦇'.repeat(750))
    p.input('create-phrase', PHRASE)
    p.submit('create-form')
    await until(() => !p.$('create-submit').disabled)
    const links = p.$('share-link').value.split('\n')
    expect(links).toHaveLength(3)
    expect(p.$('copy-link').textContent).toBe('Copy all links')
    p.$('copy-link').click()
    await until(() => p.$('share-status').textContent.includes('All links copied'))
    p.$('generated-parts').children[1].querySelector('button').click()
    await until(() => copied.length === 2)
    expect(copied).toEqual([links.join('\n'), links[1]])
    const rows = Array.from(p.$('generated-parts').children) as any[]
    rows.forEach((row, index) => {
      expect(row.querySelector('p').textContent).toBe('Part ' + (index + 1) + ' / 3')
      expect(row.querySelector('a').getAttribute('href')).toBe('/m/' + new URL(links[index]).hash)
    })
    p.$('share-native').click()
    await until(() => !!p.w.shared)
    expect(p.w.shared).toEqual({ title: 'BetterPrivacy', text: links.join('\n') })
    expect(JSON.stringify(p.w.shared)).not.toContain(PHRASE)
    // Each part also opens through the actual browser reader, not a new format.
    const reader = page('m/index.html', new URL(links[1]).hash)
    reader.input('phrase', PHRASE)
    reader.submit('form')
    await until(() => !reader.$('go').disabled)
    expect(reader.$('result').textContent).toBe(chunkPlaintext('🦇'.repeat(750))[1])
    for (const lang of ['tr', 'ru', 'en']) {
      p.w.BPUI.apply(lang)
      p.w.document.querySelectorAll('[data-copy]').forEach((node: any) => {
        expect(node.textContent).not.toBe(node.getAttribute('data-copy'))
      })
      expect(p.$('share-link').value).toBe(links.join('\n'))
    }
    p.input('message', 'short')
    expect(p.$('generated-parts').children).toHaveLength(0)
    p.submit('create-form')
    await until(() => !p.$('create-submit').disabled)
    expect(p.$('generated-parts').hidden).toBe(true)
    expect(p.$('copy-link').textContent).toBe('Copy link')
    expect(p.$('open-created').hidden).toBe(false)
    p.w.close(); reader.w.close()
  })

  it('selects exactly the requested part when clipboard access fails', async () => {
    const p = await makeLink('a'.repeat(3000))
    const links = p.$('share-link').value.split('\n')
    p.$('generated-parts').children[1].querySelector('button').click()
    await until(() => p.$('share-status').textContent.includes('manually'))
    const field = p.$('share-link')
    expect(field.value.slice(field.selectionStart, field.selectionEnd)).toBe(links[1])
    p.$('copy-link').click()
    await until(() => p.$('share-status').textContent.includes('selected links'))
    expect(field.value.slice(field.selectionStart, field.selectionEnd)).toBe(links.join('\n'))
    p.w.close()
  })

  it.each(['failure', 'edit', 'leave'])('never publishes partial links after a second-part %s', async (action) => {
    let calls = 0
    let finish!: () => void
    const p = page('create/index.html', '', (w) => {
      Object.defineProperty(w, 'crypto', { value: {
        getRandomValues: crypto.getRandomValues.bind(crypto),
        subtle: new Proxy(crypto.subtle, { get(target, property) {
          if (property === 'encrypt') return async (...args: Parameters<SubtleCrypto['encrypt']>) => {
            calls++
            if (calls === 2) {
              await new Promise<void>((resolve) => { finish = resolve })
              if (action === 'failure') throw new Error('simulated second-part encryption failure')
            }
            return target.encrypt(...args)
          }
          const value = Reflect.get(target, property)
          return typeof value === 'function' ? value.bind(target) : value
        } }),
      } })
    })
    p.input('message', 'a'.repeat(5000))
    p.input('create-phrase', PHRASE)
    p.submit('create-form')
    await until(() => calls === 2)
    expect(p.$('share-link').value).toBe('')
    expect(p.$('generated').hidden).toBe(true)
    if (action === 'edit') p.input('create-phrase', 'edited phrase')
    if (action === 'leave') p.w.dispatchEvent(new p.w.Event('pagehide'))
    finish()
    await until(() => !p.$('create-submit').disabled)
    expect(p.$('share-link').value).toBe('')
    expect(p.$('generated-parts').children).toHaveLength(0)
    expect(p.$('generated').hidden).toBe(true)
    expect(calls).toBe(2)
    expect(p.errors).toEqual([])
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

  it('opens the actual web composer’s complete multipart output with one derivation and copies the joined text', async () => {
    const text = '  Birlikte 🦇 Привет\n\t'.repeat(180) + ' final\n'
    const creator = await makeLink(text)
    const links = creator.$('share-link').value
    const count = links.split('\n').length
    let derives = 0
    const reader = page('m/index.html', '', (w) => {
      w.navigator.clipboard = { writeText: async (value: string) => { w.copied = value } }
      Object.defineProperty(w, 'crypto', { value: {
        subtle: new Proxy(crypto.subtle, { get(target, property) {
          const value = Reflect.get(target, property)
          if (property === 'deriveBits') return (...args: Parameters<SubtleCrypto['deriveBits']>) => {
            derives++
            return target.deriveBits(...args)
          }
          return typeof value === 'function' ? value.bind(target) : value
        } }),
      } })
    })
    reader.input('paste-link', links)
    reader.submit('paste-form')
    expect(reader.$('batch-summary').textContent).toContain(count + ' links loaded')
    expect(reader.w.location.hash).toBe('') // No misleading single-part batch URL.
    reader.input('phrase', PHRASE)
    reader.submit('form')
    await until(() => !reader.$('go').disabled)
    expect(reader.$('result').textContent).toBe(text)
    expect(reader.$('result').hidden).toBe(false)
    expect(derives).toBe(1)
    expect(reader.$('phrase').value).toBe('')
    reader.$('copy').click()
    await until(() => !!reader.w.copied)
    expect(reader.w.copied).toBe(text)
    for (const lang of ['tr', 'ru', 'en']) {
      reader.w.document.querySelector('[data-lang="' + lang + '"]').click()
      expect(reader.$('batch-summary').textContent).toContain(String(count))
      expect(reader.$('batch-summary').textContent).not.toContain('{count}')
      expect(reader.$('status').textContent).not.toContain('{count}')
      expect(reader.$('result').textContent).toBe(text)
    }
    reader.$('forget-message').click()
    expect(reader.$('result').textContent).toBe('')
    expect(reader.$('tools').hidden).toBe(true)
    creator.w.close(); reader.w.close()
  })

  it('joins independently salted links and plugin wrappers in pasted order, including from a direct-link entry', async () => {
    const a = await makeLink('first\n')
    const b = await makeLink(' second 🦇')
    const first = a.$('share-link').value
    const second = b.$('share-link').value
    const reader = page('m/index.html', new URL(first).hash)
    expect(reader.$('paste-link').value).toBe(first)
    expect(reader.$('paste-form').closest('[hidden]')).toBeNull()
    reader.input('paste-link', '🦇<' + second + '>\n\n<' + first + '>')
    reader.submit('paste-form')
    reader.input('phrase', PHRASE)
    reader.submit('form')
    await until(() => !reader.$('go').disabled)
    expect(reader.$('result').textContent).toBe(' second 🦇first\n')
    expect(reader.$('paste-help').textContent).toContain('missing parts cannot be detected')
    a.w.close(); b.w.close(); reader.w.close()
  })

  it.each(['malformed', 'external', 'duplicate'])('rejects an entire batch containing a %s link and clears previous plaintext', async (kind) => {
    const creator = await makeLink('a'.repeat(3000))
    const links = creator.$('share-link').value.split('\n')
    const reader = page('m/index.html', new URL(links[0]).hash)
    reader.input('phrase', PHRASE)
    reader.submit('form')
    await until(() => !reader.$('go').disabled)
    expect(reader.$('result').hidden).toBe(false)
    const invalid = kind === 'malformed' ? links[1].replace('#v1.', '#v2.') :
      kind === 'external' ? links[1].replace('betterprivacy.app', 'example.com') : links[0]
    reader.input('paste-link', links[0] + '\n' + invalid)
    reader.submit('paste-form')
    expect(reader.$('box').hidden).toBe(true)
    expect(reader.$('result').textContent).toBe('')
    expect(reader.$('paste-status').textContent).toContain(kind === 'duplicate' ? 'repeated' : 'not a complete')
    reader.w.document.querySelector('[data-lang="tr"]').click()
    expect(reader.$('paste-status').textContent.length).toBeGreaterThan(10)
    creator.w.close(); reader.w.close()
  })

  it.each(['wrong phrase', 'tamper'])('does not expose any partial text when part 2 has %s', async (kind) => {
    const creator = await makeLink('a'.repeat(3000))
    const links = creator.$('share-link').value.split('\n')
    if (kind === 'wrong phrase') {
      creator.input('message', 'different secret')
      creator.input('create-phrase', 'a different passphrase')
      creator.submit('create-form')
      await until(() => !creator.$('create-submit').disabled)
      links[1] = creator.$('share-link').value
    } else {
      const fields = links[1].split('.')
      const last = fields.length - 1
      fields[last] = (fields[last][0] === 'A' ? 'B' : 'A') + fields[last].slice(1)
      links[1] = fields.join('.')
    }
    const reader = page('m/index.html')
    reader.input('paste-link', links.join('\n'))
    reader.submit('paste-form')
    reader.input('phrase', PHRASE)
    reader.submit('form')
    await until(() => !reader.$('go').disabled)
    expect(reader.$('result').hidden).toBe(true)
    expect(reader.$('result').textContent).toBe('')
    expect(reader.$('tools').hidden).toBe(true)
    expect(reader.$('status').textContent).toContain('Part 2 of 3')
    expect(reader.$('status').classList.contains('err')).toBe(true)
    creator.w.close(); reader.w.close()
  })

  it.each(['links', 'phrase', 'pagehide', 'hash'])('invalidates multipart decryption when %s changes during part 2', async (action) => {
    const creator = await makeLink('a'.repeat(3000))
    let calls = 0
    let finish!: () => void
    const reader = page('m/index.html', '', (w) => {
      Object.defineProperty(w, 'crypto', { value: {
        subtle: new Proxy(crypto.subtle, { get(target, property) {
          if (property === 'decrypt') return async (...args: Parameters<SubtleCrypto['decrypt']>) => {
            if (++calls === 2) await new Promise<void>((resolve) => { finish = resolve })
            return target.decrypt(...args)
          }
          const value = Reflect.get(target, property)
          return typeof value === 'function' ? value.bind(target) : value
        } }),
      } })
    })
    reader.input('paste-link', creator.$('share-link').value)
    reader.submit('paste-form')
    reader.input('phrase', PHRASE)
    reader.submit('form')
    await until(() => calls === 2)
    expect(reader.$('result').hidden).toBe(true)
    if (action === 'links') reader.input('paste-link', '')
    if (action === 'phrase') reader.input('phrase', 'edited phrase')
    if (action === 'pagehide') reader.w.dispatchEvent(new reader.w.Event('pagehide'))
    if (action === 'hash') reader.w.location.hash = '#broken'
    finish()
    await until(() => !reader.$('go').disabled)
    await new Promise((r) => setTimeout(r, 20))
    expect(reader.$('result').textContent).toBe('')
    expect(reader.$('result').hidden).toBe(true)
    expect(reader.$('tools').hidden).toBe(true)
    expect(calls).toBe(2)
    expect(reader.errors).toEqual([])
    creator.w.close(); reader.w.close()
  })
})
