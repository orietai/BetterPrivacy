/**
 * End-to-end UI flow test for the REAL decrypt page (site/m/index.html),
 * driven through a real DOM.
 *
 * tests/webPageParity.test.ts lifts the page's crypto FUNCTIONS out of the
 * HTML and proves they agree with src/crypto/*. That leaves a whole class of
 * breakage invisible: an element id that no longer resolves, a handler that
 * never attaches because an earlier line threw during script evaluation, a
 * card left `hidden`, a status line that never updates. The crypto would still
 * be perfect and the page would still be dead.
 *
 * So this suite loads the shipped HTML into jsdom with `runScripts:
 * 'dangerously'`, then touches nothing but the DOM: it dispatches the same
 * change/submit events a browser would, and asserts on what a visitor would
 * actually see — the status text, the filename, the download link, the inline
 * preview. Any script error during parse also fails the test, because a page
 * whose script died attaches no handlers at all.
 */

import { readFileSync } from 'node:fs'
import { JSDOM, VirtualConsole } from 'jsdom'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { deriveKeyMaterial, deriveSaltFromLabel } from '../src/crypto/kdf'
import { encryptText } from '../src/crypto/cipher'
import { CHUNK_UTF8_BYTES, chunkPlaintext, encodeWire } from '../src/crypto/wire'
import { encryptFileToBpenc } from '../src/crypto/bpenc'

const HTML = readFileSync(new URL('../site/m/index.html', import.meta.url), 'utf8')

const PASS = 'test phrase one two'
const CHANNEL_LABEL = 'channel:123456789012345678'

/** A real 1×1 PNG, so the page's image branch is exercised on honest bytes. */
const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
])

/** Fixtures the plugin itself produced — derived ONCE (PBKDF2 ×600,000). */
let container: Uint8Array
let fragment: string
const UNICODE_TEXT = '\uFEFF' + 'x'.repeat(CHUNK_UTF8_BYTES - 3) + '\uFEFF\uFEFFtail 🔐'
let unicodeLinks: string[]

beforeAll(async () => {
  const salt = await deriveSaltFromLabel(CHANNEL_LABEL)
  const { key, keyId } = await deriveKeyMaterial(PASS, salt)
  container = await encryptFileToBpenc(key, keyId, salt, PNG, 'photo.png', 'image/png')
  const { iv, ct } = await encryptText(key, 'meet at the rooftop 🛰')
  const wire = encodeWire({ keyId, salt, iv, ciphertext: ct })
  // What a browser sees after clicking the 🦇 link: the fragment alone.
  fragment = '#' + wire.slice(wire.indexOf('#') + 1, -1)
  unicodeLinks = await Promise.all(chunkPlaintext(UNICODE_TEXT).map(async plaintext => {
    const { iv, ct } = await encryptText(key, plaintext)
    return encodeWire({ keyId, salt, iv, ciphertext: ct })
  }))
}, 30_000)

interface Page {
  window: any
  $: (id: string) => any
  /** Feeds a file through the real <input type=file> change handler. */
  loadFile: (bytes: Uint8Array, name: string) => Promise<void>
  /** Submits a form and resolves with the status text once it stops saying "deriving". */
  submit: (formId: string, statusId: string, inputId: string, phrase: string) => Promise<string>
}

/**
 * The shipped page, parsed and executed. Polyfills only what jsdom genuinely
 * lacks (WebCrypto, object URLs) — everything else is the page's own doing.
 * A script error during parse throws here rather than silently producing a
 * handler-less page.
 */
const pages: any[] = []
afterEach(() => { for (const window of pages.splice(0)) window.close() })

function openPage(hash = '', configure?: (window: any) => void): Page {
  const virtualConsole = new VirtualConsole()
  const scriptErrors: string[] = []
  virtualConsole.on('jsdomError', (err: any) => scriptErrors.push(String(err?.stack || err)))

  let blobSeq = 0
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://betterprivacy.app/m' + hash,
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window: any) {
      // Node's WebCrypto — the same implementation the plugin's own tests use.
      Object.defineProperty(window, 'crypto', { value: crypto, configurable: true, writable: true })
      if (!window.TextEncoder) window.TextEncoder = TextEncoder
      if (!window.TextDecoder) window.TextDecoder = TextDecoder
      window.URL.createObjectURL = () => 'blob:test-' + ++blobSeq
      window.URL.revokeObjectURL = () => {}
      window.addEventListener('error', (e: any) => scriptErrors.push(String(e.message)))
      configure?.(window)
    },
  })

  if (scriptErrors.length) throw new Error('page script failed to evaluate:\n' + scriptErrors.join('\n'))

  const window = dom.window
  pages.push(window)
  const $ = (id: string) => window.document.getElementById(id)

  async function tick(ms = 15) {
    await new Promise((r) => setTimeout(r, ms))
  }

  return {
    window,
    $,
    async loadFile(bytes, name) {
      const file = new window.File([bytes], name, { type: 'application/octet-stream' })
      // jsdom offers no way to populate a FileList; the page only ever reads
      // `fileInput.files[0]`, so this is the same input the handler sees.
      Object.defineProperty($('file-input'), 'files', { value: [file], configurable: true })
      $('file-input').dispatchEvent(new window.Event('change', { bubbles: true }))
      // loadFile() awaits file.arrayBuffer() before it settles.
      for (let i = 0; i < 60; i++) {
        if (!$('file-unlock').hidden || $('file-status').textContent) break
        await tick(10)
      }
      await tick()
      if (scriptErrors.length) throw new Error('page threw while loading a file:\n' + scriptErrors.join('\n'))
    },
    async submit(formId, statusId, inputId, phrase) {
      const status = $(statusId)
      $(inputId).value = phrase
      $(formId).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
      await tick(25)
      const deriving = status.textContent
      const deadline = Date.now() + 25_000
      while (status.textContent === deriving && Date.now() < deadline) await tick(25)
      if (scriptErrors.length) throw new Error('page threw while decrypting:\n' + scriptErrors.join('\n'))
      if (status.textContent === deriving) throw new Error('decrypt never settled: ' + deriving)
      return status.textContent as string
    },
  }
}

describe('decrypt page: it loads and wires itself up', () => {
  it('evaluates without error and attaches the drop-zone handlers', () => {
    const page = openPage()
    let clicks = 0
    page.$('file-input').click = () => clicks++
    page.$('drop').dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }))
    expect(clicks, 'clicking the drop zone must open the file picker').toBe(1)

    // No fragment → the "nothing to decrypt" card, and the file card is always up.
    expect(page.$('empty').hidden).toBe(false)
    expect(page.$('box').hidden).toBe(true)
    expect(page.$('file-unlock').hidden).toBe(true)
    expect(page.$('file-result').hidden).toBe(true)
  })
})

/** Hold one real WebCrypto completion to exercise races without timing guesses. */
function cryptoGate(method: 'deriveBits' | 'decrypt') {
  let entered!: () => void
  let release!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const held = new Promise<void>(resolve => { release = resolve })
  let fail = false
  let used = false
  return {
    started,
    release(reject = false) { fail = reject; release() },
    configure(window: any) {
      const subtle = new Proxy(crypto.subtle, {
        get(target, property) {
          const original = (target as any)[property].bind(target)
          if (property !== method) return original
          return async (...args: any[]) => {
            if (used) return original(...args)
            used = true
            const out = await original(...args)
            entered()
            await held
            if (fail) throw new Error('delayed failure')
            return out
          }
        },
      })
      Object.defineProperty(window, 'crypto', { value: { subtle }, configurable: true })
    },
  }
}

function start(page: Page, file = false, phrase = PASS) {
  page.$(file ? 'fphrase' : 'phrase').value = phrase
  page.$(file ? 'file-form' : 'form').dispatchEvent(
    new page.window.Event('submit', { bubbles: true, cancelable: true }),
  )
}

async function settled(page: Page, file = false) {
  await vi.waitFor(() => expect(page.$(file ? 'fgo' : 'go').disabled).toBe(false))
}

async function flush() { await new Promise(resolve => setTimeout(resolve, 40)) }

function expectNoFile(page: Page) {
  expect(page.$('file-result').hidden).toBe(true)
  expect(page.$('file-meta').textContent).toBe('')
  expect(page.$('file-dl').hasAttribute('href')).toBe(false)
  expect(page.$('file-dl').hasAttribute('download')).toBe(false)
  expect(page.$('file-media').childElementCount).toBe(0)
}

describe('decrypt page: lifecycle races through the real DOM', () => {
  it('editing the file phrase clears visible plaintext and revokes its URL immediately', async () => {
    const revoked = vi.fn()
    const page = openPage('', window => { window.URL.revokeObjectURL = revoked })
    await page.loadFile(container, 'photo.bpenc')
    await page.submit('file-form', 'file-status', 'fphrase', PASS)
    const url = page.$('file-dl').getAttribute('href')
    page.$('fphrase').value = 'new draft'
    page.$('fphrase').dispatchEvent(new page.window.Event('input', { bubbles: true }))
    expectNoFile(page)
    expect(revoked).toHaveBeenCalledWith(url)
    expect(page.$('fwrap').classList.contains('lit')).toBe(false)
    expect(page.$('file-status').textContent).toBe('')
    expect(page.$('fgo').disabled).toBe(false)
    expect(page.$('fphrase').value).toBe('new draft')
    expect(page.$('file-unlock').hidden).toBe(false)
  })

  it.each([
    { method: 'deriveBits' as const, fail: false },
    { method: 'deriveBits' as const, fail: true },
    { method: 'decrypt' as const, fail: false },
    { method: 'decrypt' as const, fail: true },
  ])('editing the file phrase invalidates pending $method (failure=$fail)', async ({ method, fail }) => {
    const gate = cryptoGate(method)
    const created = vi.fn(() => 'blob:unexpected')
    const page = openPage('', window => {
      gate.configure(window)
      window.URL.createObjectURL = created
    })
    await page.loadFile(container, 'photo.bpenc')
    start(page, true)
    await gate.started
    page.$('fphrase').value = 'new draft'
    page.$('fphrase').dispatchEvent(new page.window.Event('input', { bubbles: true }))
    expect(page.$('fgo').disabled).toBe(false)
    expect(page.$('file-status').textContent).toBe('')
    gate.release(fail)
    await flush()
    expectNoFile(page)
    expect(created).not.toHaveBeenCalled()
    expect(page.$('fphrase').value).toBe('new draft')
    expect(page.$('file-status').textContent).toBe('')
    expect(page.$('file-status').classList.contains('err')).toBe(false)
    expect(page.$('fgo').disabled).toBe(false)
    // Editing cancels the operation, but retains the container for a retry.
    start(page, true)
    await settled(page, true)
    expect(page.$('file-result').hidden).toBe(false)
  })

  it.each([false, true])('obsolete file completion cannot reset controls or clear a newer phrase (failure=%s)', async fail => {
    const old = cryptoGate('decrypt')
    const next = cryptoGate('deriveBits')
    const page = openPage('', old.configure)
    await page.loadFile(container, 'photo.bpenc')
    start(page, true)
    await old.started
    page.$('fphrase').value = PASS
    page.$('fphrase').dispatchEvent(new page.window.Event('input', { bubbles: true }))
    next.configure(page.window)
    start(page, true)
    await next.started
    const status = page.$('file-status').textContent
    old.release(fail)
    await flush()
    expectNoFile(page)
    expect(page.$('fgo').disabled).toBe(true)
    expect(page.$('file-status').textContent).toBe(status)
    expect(page.$('fphrase').value).toBe(PASS)
    next.release()
    await settled(page, true)
    expect(page.$('file-result').hidden).toBe(false)
  })

  it('clears a successful file before a wrong phrase and revokes its download', async () => {
    const revoked = vi.fn()
    const page = openPage('', window => { window.URL.revokeObjectURL = revoked })
    await page.loadFile(container, 'photo.bpenc')
    await page.submit('file-form', 'file-status', 'fphrase', PASS)
    const url = page.$('file-dl').getAttribute('href')
    start(page, true, 'wrong phrase')
    expectNoFile(page)
    expect(revoked).toHaveBeenCalledWith(url)
    await settled(page, true)
    expect(page.$('file-status').textContent).toContain('key fingerprint mismatch')
    expectNoFile(page)
  })

  it('clears successful text and copy feedback before a wrong phrase', async () => {
    const page = openPage(fragment, window => {
      Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async () => {} } })
    })
    await page.submit('form', 'status', 'phrase', PASS)
    page.$('copy').click()
    await flush()
    expect(page.$('copy').textContent).toContain('✓')
    start(page, false, 'wrong phrase')
    expect(page.$('result').textContent).toBe('')
    expect(page.$('wrap').classList.contains('lit')).toBe(false)
    expect(page.$('copy').textContent).toBe('Copy plaintext')
    await settled(page)
    expect(page.$('status').textContent).toContain('key fingerprint mismatch')
    expect(page.$('tools').hidden).toBe(true)
  })

  it.each(['deriveBits', 'decrypt'] as const)('file replacement cancels a pending %s result', async method => {
    const gate = cryptoGate(method)
    const page = openPage('', gate.configure)
    await page.loadFile(container, 'old.bpenc')
    start(page, true)
    await gate.started
    await page.loadFile(new Uint8Array([1, 2, 3]), 'replacement.txt')
    const status = page.$('file-status').textContent
    expect(page.$('fgo').disabled).toBe(false)
    expect(page.$('fphrase').value).toBe('')
    gate.release()
    await flush()
    expectNoFile(page)
    expect(page.$('file-unlock').hidden).toBe(true)
    expect(page.$('file-status').textContent).toBe(status)
  })

  it('the latest file read wins even when an older read finishes last', async () => {
    const page = openPage()
    let finish!: (bytes: Uint8Array) => void
    const oldRead = new Promise<Uint8Array>(resolve => { finish = resolve })
    Object.defineProperty(page.$('file-input'), 'files', {
      value: [{ arrayBuffer: () => oldRead }], configurable: true,
    })
    page.$('file-input').dispatchEvent(new page.window.Event('change'))
    await page.loadFile(new Uint8Array([1]), 'new.txt')
    const status = page.$('file-status').textContent
    finish(container)
    await flush()
    expect(page.$('file-unlock').hidden).toBe(true)
    expect(page.$('file-status').textContent).toBe(status)
  })

  it.each([
    { file: false, method: 'deriveBits' as const },
    { file: false, method: 'decrypt' as const },
    { file: true, method: 'deriveBits' as const },
    { file: true, method: 'decrypt' as const },
  ])('pagehide cancels pending $method (file=$file) and restores idle controls', async ({ file, method }) => {
    const gate = cryptoGate(method)
    const page = openPage(fragment, gate.configure)
    if (file) await page.loadFile(container, 'old.bpenc')
    start(page, file)
    await gate.started
    page.window.dispatchEvent(new page.window.Event('pagehide'))
    expect(page.$('go').disabled).toBe(false)
    expect(page.$('fgo').disabled).toBe(false)
    expect(page.$('phrase').value).toBe('')
    expect(page.$('fphrase').value).toBe('')
    gate.release()
    await flush()
    expect(page.$('result').textContent).toBe('')
    expectNoFile(page)
    // A restored page can start a fresh operation.
    start(page, file)
    await settled(page, file)
    expect(page.$(file ? 'file-result' : 'result').hidden).toBe(false)
  })

  it.each(['deriveBits', 'decrypt'] as const)('hash change suppresses late %s errors and resets controls', async method => {
    const gate = cryptoGate(method)
    const page = openPage(fragment, gate.configure)
    start(page)
    await gate.started
    page.window.location.hash = '#broken'
    await vi.waitFor(() => expect(page.$('box').hidden).toBe(true))
    expect(page.$('go').disabled).toBe(false)
    const status = page.$('status').textContent
    gate.release(true)
    await flush()
    expect(page.$('status').textContent).toBe(status)
    expect(page.$('result').textContent).toBe('')
    expect(page.$('wrap').classList.contains('lit')).toBe(false)
  })

  it('hide invalidates a pending decrypt and keeps the form usable', async () => {
    const gate = cryptoGate('decrypt')
    const page = openPage(fragment, gate.configure)
    start(page)
    await gate.started
    page.$('forget-message').click()
    expect(page.$('go').disabled).toBe(false)
    gate.release()
    await flush()
    expect(page.$('result').textContent).toBe('')
    expect(page.$('tools').hidden).toBe(true)
    start(page)
    await settled(page)
    expect(page.$('result').hidden).toBe(false)
  })

  it.each([false, true])('late clipboard completion cannot alter hidden text (reject=%s)', async reject => {
    let finish!: () => void
    const copied = new Promise<void>((resolve, fail) => { finish = () => reject ? fail(new Error('denied')) : resolve() })
    const page = openPage(fragment, window => {
      Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: () => copied } })
    })
    await page.submit('form', 'status', 'phrase', PASS)
    page.$('copy').click()
    page.$('forget-message').click()
    const status = page.$('status').textContent
    finish()
    await flush()
    expect(page.$('status').textContent).toBe(status)
    expect(page.$('copy').textContent).toBe('Copy plaintext')
    expect(page.window.getSelection().toString()).toBe('')
    expect(page.window.document.activeElement).toBe(page.$('phrase'))
    expect(page.$('result').textContent).toBe('')
  })

  it('clipboard fallback selects the current plaintext for manual copying', async () => {
    const page = openPage(fragment)
    await page.submit('form', 'status', 'phrase', PASS)
    page.$('copy').click()
    await flush()
    expect(page.window.getSelection().toString()).toBe('meet at the rooftop 🛰')
    expect(page.$('status').textContent).toMatch(/select|copy/i)
    page.$('forget-message').click()
    expect(page.window.getSelection().toString()).toBe('')
  })

  it('an old clipboard rejection cannot select a newly decrypted message', async () => {
    let reject!: (error: Error) => void
    const copied = new Promise<void>((_, fail) => { reject = fail })
    const page = openPage(fragment, window => {
      Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: () => copied } })
    })
    await page.submit('form', 'status', 'phrase', PASS)
    page.$('copy').click()
    page.$('forget-message').click()
    await page.submit('form', 'status', 'phrase', PASS)
    const status = page.$('status').textContent
    reject(new Error('denied'))
    await flush()
    expect(page.$('status').textContent).toBe(status)
    expect(page.window.getSelection().toString()).toBe('')
  })

  it.each([false, true])('an obsolete failure cannot unlock a newer operation (file=%s)', async file => {
    const first = cryptoGate('decrypt')
    const second = cryptoGate('deriveBits')
    const page = openPage(fragment, first.configure)
    if (file) await page.loadFile(container, 'photo.bpenc')
    start(page, file)
    await first.started
    // Replace the provider only after the old operation has reached decrypt.
    // Both gates still execute real WebCrypto with the plugin-written fixture.
    second.configure(page.window)
    start(page, file)
    await second.started
    const status = page.$(file ? 'file-status' : 'status').textContent
    first.release(true)
    await flush()
    expect(page.$(file ? 'fgo' : 'go').disabled).toBe(true)
    expect(page.$(file ? 'file-status' : 'status').textContent).toBe(status)
    second.release()
    await settled(page, file)
    expect(page.$(file ? 'file-result' : 'result').hidden).toBe(false)
  })

  it('a valid hash change allows a fresh decrypt while the old derivation is pending', async () => {
    const gate = cryptoGate('deriveBits')
    const page = openPage(fragment, gate.configure)
    start(page)
    await gate.started
    // Same salt and key, different authenticated ciphertext.
    const salt = await deriveSaltFromLabel(CHANNEL_LABEL)
    const { key, keyId } = await deriveKeyMaterial(PASS, salt)
    const { iv, ct } = await encryptText(key, 'replacement message')
    const wire = encodeWire({ keyId, salt, iv, ciphertext: ct })
    page.window.location.hash = '#' + wire.slice(wire.indexOf('#') + 1, -1)
    await vi.waitFor(() => expect(page.$('go').disabled).toBe(false))
    start(page)
    await settled(page)
    expect(page.$('result').textContent).toBe('replacement message')
    gate.release()
    await flush()
    expect(page.$('result').textContent).toBe('replacement message')
  })

  it('pagehide invalidates a pending file read', async () => {
    const page = openPage()
    let finish!: (bytes: Uint8Array) => void
    const read = new Promise<Uint8Array>(resolve => { finish = resolve })
    Object.defineProperty(page.$('file-input'), 'files', {
      value: [{ arrayBuffer: () => read }], configurable: true,
    })
    page.$('file-input').dispatchEvent(new page.window.Event('change'))
    page.window.dispatchEvent(new page.window.Event('pagehide'))
    finish(container)
    await flush()
    expect(page.$('file-unlock').hidden).toBe(true)
    expect(page.$('file-status').textContent).toBe('')
    expectNoFile(page)
  })
})

describe('decrypt page: .bpenc file flow', () => {
  it('decrypts a plugin-written container and shows name, preview and download', async () => {
    const page = openPage()
    await page.loadFile(container, 'ehks5pz5.bpenc')

    // Recognized: the drop zone summarizes it and the phrase form appears.
    expect(page.$('file-unlock').hidden).toBe(false)
    expect(page.$('drop-text').textContent).toMatch(/^BPENC1 · key [A-Za-z0-9_-]{8} · /)

    const status = await page.submit('file-form', 'file-status', 'fphrase', PASS)
    expect(status, 'the page should report a successful file decrypt').toBe(
      'Decrypted locally — nothing left this tab.',
    )
    expect(page.$('file-status').classList.contains('err')).toBe(false)
    expect(page.$('file-result').hidden).toBe(false)
    // The true filename comes out of the ENCRYPTED header, not the upload name.
    expect(page.$('file-meta').textContent).toContain('photo.png')
    expect(page.$('file-dl').getAttribute('download')).toBe('photo.png')
    expect(page.$('file-dl').getAttribute('href')).toMatch(/^blob:/)
    expect(page.$('file-dl').textContent).toBe('Save photo.png')
    // image/* gets an inline <img>.
    expect(page.$('file-media').hidden).toBe(false)
    expect(page.$('file-media').firstChild.tagName).toBe('IMG')
  }, 30_000)

  it('reports a fingerprint mismatch for the wrong phrase, and reveals nothing', async () => {
    const page = openPage()
    await page.loadFile(container, 'ehks5pz5.bpenc')
    const status = await page.submit('file-form', 'file-status', 'fphrase', 'not the phrase')
    expect(status).toContain('key fingerprint mismatch')
    expect(page.$('file-status').classList.contains('err')).toBe(true)
    expect(page.$('file-result').hidden).toBe(true)
  }, 30_000)

  it('rejects a file that is not a container, without offering the phrase form', async () => {
    const page = openPage()
    await page.loadFile(new TextEncoder().encode('this is just a jpeg, honest'), 'kitten.jpg')
    expect(page.$('file-status').textContent).toBe(
      'That file isn’t a BetterPrivacy container (missing BPENC1 header).',
    )
    expect(page.$('file-status').classList.contains('err')).toBe(true)
    expect(page.$('file-unlock').hidden, 'no point asking for a phrase').toBe(true)
  }, 30_000)
})

describe('decrypt page: message fragment flow', () => {
  it('preserves leading U+FEFF in a single v1 link', async () => {
    const wire = unicodeLinks[0]!
    const page = openPage('#' + wire.slice(wire.indexOf('#') + 1, -1))
    await page.submit('form', 'status', 'phrase', PASS)
    expect(page.$('result').textContent).toBe(chunkPlaintext(UNICODE_TEXT)[0])
  })

  it('preserves U+FEFF at multipart boundaries when joining real encrypted links', async () => {
    expect(unicodeLinks).toHaveLength(2)
    const page = openPage()
    page.$('paste-link').value = unicodeLinks.join('\n')
    page.$('paste-form').dispatchEvent(new page.window.Event('submit', { bubbles: true, cancelable: true }))
    await page.submit('form', 'status', 'phrase', PASS)
    expect(page.$('result').hidden).toBe(false)
    expect(page.$('result').textContent).toBe(UNICODE_TEXT)
    expect(page.$('status').textContent).toBe('All 2 provided links decrypted and joined locally.')
  })

  it('decrypts a wire message carried in location.hash', async () => {
    const page = openPage(fragment)
    // boot() read the fragment: the decrypt card is up, the fingerprint shown.
    expect(page.$('box').hidden).toBe(false)
    expect(page.$('empty').hidden).toBe(true)
    expect(page.$('fp').textContent).toMatch(/^[A-Za-z0-9_-]{8}$/)

    const status = await page.submit('form', 'status', 'phrase', PASS)
    expect(status).toBe('Decrypted locally — this plaintext exists only on your screen.')
    expect(page.$('result').hidden).toBe(false)
    expect(page.$('result').textContent).toBe('meet at the rooftop 🛰')
    expect(page.$('tools').hidden).toBe(false)
  }, 30_000)
})

describe('decrypt page: insecure origin', () => {
  it('names the real problem instead of asking the visitor to try again', async () => {
    // Plain http:// on a non-localhost address: crypto exists, crypto.subtle
    // does not. Without the guard this surfaced as "try again" forever.
    const realCrypto = crypto
    const stub = { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) }
    const dom = new JSDOM(HTML, {
      runScripts: 'dangerously',
      url: 'http://192.168.1.10:8080/m',
      pretendToBeVisual: true,
      beforeParse(window: any) {
        Object.defineProperty(window, 'crypto', { value: stub, configurable: true, writable: true })
        window.URL.createObjectURL = () => 'blob:test'
        window.URL.revokeObjectURL = () => {}
      },
    })
    pages.push(dom.window)
    const $ = (id: string) => dom.window.document.getElementById(id)

    // The container still PARSES — that path needs no crypto — so the visitor
    // reaches the phrase form and the guard is what has to speak.
    const file = new dom.window.File([container], 'ehks5pz5.bpenc', { type: 'application/octet-stream' })
    Object.defineProperty($('file-input'), 'files', { value: [file], configurable: true })
    $('file-input').dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 100))
    expect($('file-unlock').hidden).toBe(false)

    $('fphrase').value = PASS
    $('file-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
    await new Promise((r) => setTimeout(r, 50))
    expect($('file-status').textContent).toContain('WebCrypto needs a secure origin')
    expect($('file-status').classList.contains('err')).toBe(true)
    // The button must not be left stuck in its disabled/"wait" state.
    expect($('fgo').disabled).toBe(false)
  }, 30_000)
})
