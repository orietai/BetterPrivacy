/**
 * Cross-executes the REAL decrypt page (site/m/index.html) against the plugin's
 * own encryptors.
 *
 * betterprivacy.app/m re-implements the crypto in plain browser JS because it
 * ships as one static file with no build step. That duplication is the whole
 * risk: a change to the wire format or the .bpenc container that isn't
 * mirrored in the page turns every 🦇 link into a dead end for people without
 * the plugin — and nothing in a normal test run would notice.
 *
 * So this suite extracts the page's actual functions out of the HTML, runs
 * them in-process, and feeds them containers produced by src/crypto/*. If the
 * two implementations drift apart, these tests fail.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { deriveKeyMaterial, deriveSaltFromLabel } from '../src/crypto/kdf'
import { encryptText } from '../src/crypto/cipher'
import { encodeWire } from '../src/crypto/wire'
import { encryptFileToBpenc, CHUNK_SIZE } from '../src/crypto/bpenc'
import { bufsrc } from '../src/crypto/b64'

const html = readFileSync(new URL('../site/m/index.html', import.meta.url), 'utf8')

/** Source text of a top-level `function NAME(...) {...}`, brace-matched. */
function extractFunction(name: string): string {
  const start = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(html)
  if (!start) throw new Error(`page function ${name}() not found — did site/m/index.html change?`)
  let i = html.indexOf('{', start.index)
  let depth = 0
  for (let k = i; k < html.length; k++) {
    if (html[k] === '{') depth++
    else if (html[k] === '}' && --depth === 0) return html.slice(start.index, k + 1)
  }
  throw new Error(`unbalanced braces in page function ${name}()`)
}

/** Source text of a top-level `var NAME = <single line>`. */
function extractConst(name: string): string {
  const m = new RegExp(`var\\s+${name}\\s*=.*`).exec(html)
  if (!m) throw new Error(`page constant ${name} not found — did site/m/index.html change?`)
  return m[0]
}

interface PageApi {
  FRAG_RE: RegExp
  b64d(s: string): Uint8Array
  b64e(bytes: Uint8Array): string
  derive(phrase: string, saltB64: string): Promise<{ key: CryptoKey; keyId: string }>
  parseContainer(bytes: Uint8Array): {
    keyId: string
    saltB64: string
    headerLen: number
  } | null
  decryptContainer(
    key: CryptoKey,
    c: unknown,
  ): Promise<{ header: { filename: string; mime: string; size: number; chunks: number }; data: Uint8Array }>
}

/**
 * The page's own code, lifted verbatim and evaluated. Everything it needs
 * (crypto, TextEncoder, atob/btoa) is global in Node 18+, exactly as it is in
 * a browser — so this really is the shipped implementation, not a copy.
 */
const page: PageApi = new Function(
  [
    ...['ITERATIONS', 'FRAG_RE', 'CHUNK_SIZE', 'GCM_TAG_LEN', 'MAGIC', 'FIXED_PREFIX'].map(extractConst),
    ...['b64d', 'b64e', 'derive', 'ivPlus', 'toHex', 'sha256Hex', 'parseContainer', 'decryptContainer'].map(
      extractFunction,
    ),
    'return { FRAG_RE, b64d, b64e, derive, parseContainer, decryptContainer }',
  ].join('\n'),
)() as PageApi

const PASS = 'correct horse battery staple'
const CHANNEL_LABEL = 'channel:123456789012345678'

/** The plugin's channel key, as a real send would use it. */
let cached: { salt: string; keyId: string; key: CryptoKey } | undefined
async function channelKey() {
  if (!cached) {
    const salt = await deriveSaltFromLabel(CHANNEL_LABEL)
    const { key, keyId } = await deriveKeyMaterial(PASS, salt)
    cached = { salt, keyId, key }
  }
  return cached
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function patternedBytes(n: number): Uint8Array {
  const data = new Uint8Array(n)
  for (let i = 0; i < n; i++) data[i] = (i * 31 + (i >> 8) * 7 + (i >> 16)) & 0xff
  return data
}

describe('decrypt page ↔ plugin parity: messages', () => {
  it('the page reads a wire message the plugin just encrypted', async () => {
    const { key, keyId, salt } = await channelKey()
    const plaintext = 'meet at the rooftop 🛰 — bring the ünïcödé'
    const { iv, ct } = await encryptText(key, plaintext)
    const wire = encodeWire({ keyId, salt, iv, ciphertext: ct })

    // What a browser sees after clicking the link: location.hash.
    const hash = '#' + wire.slice(wire.indexOf('#') + 1, -1)
    const m = page.FRAG_RE.exec(hash)
    expect(m, 'page fragment regex rejected a freshly encoded wire message').not.toBeNull()

    const derived = await page.derive(PASS, m![2]!)
    expect(derived.keyId).toBe(m![1]) // the page's wrong-phrase check
    const buf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bufsrc(page.b64d(m![3]!)) },
      derived.key,
      bufsrc(page.b64d(m![4]!)),
    )
    expect(new TextDecoder().decode(buf)).toBe(plaintext)
  })

  it('a wrong phrase fails on the fingerprint, before any decryption', async () => {
    const { key, keyId, salt } = await channelKey()
    const { iv, ct } = await encryptText(key, 'secret')
    const wire = encodeWire({ keyId, salt, iv, ciphertext: ct })
    const m = page.FRAG_RE.exec('#' + wire.slice(wire.indexOf('#') + 1, -1))!
    const derived = await page.derive('not the phrase', m[2]!)
    expect(derived.keyId).not.toBe(m[1])
  })
})

describe('decrypt page ↔ plugin parity: .bpenc files', () => {
  it('the page opens a container the plugin just wrote (phrase alone)', async () => {
    const { key, keyId, salt } = await channelKey()
    const data = patternedBytes(4096)
    const enc = await encryptFileToBpenc(key, keyId, salt, data, 'photo.png', 'image/png')

    // The page has ONLY the file and the phrase — no keyring, no channel.
    const c = page.parseContainer(enc)
    expect(c, 'page failed to recognize a plugin-written container').not.toBeNull()
    expect(c!.keyId).toBe(keyId)
    expect(c!.saltB64).toBe(salt) // the salt field is what makes phrase-only decryption work

    const derived = await page.derive(PASS, c!.saltB64)
    expect(derived.keyId).toBe(c!.keyId)

    const out = await page.decryptContainer(derived.key, c)
    expect(out.header.filename).toBe('photo.png')
    expect(out.header.mime).toBe('image/png')
    expect(out.header.size).toBe(data.length)
    expect(bytesEqual(out.data, data)).toBe(true)
  })

  it('the chunk loop agrees across the 8 MB boundary', async () => {
    const { key, keyId, salt } = await channelKey()
    const data = patternedBytes(CHUNK_SIZE + 4096) // 2 chunks, second one tiny
    const enc = await encryptFileToBpenc(key, keyId, salt, data, 'big.bin', 'application/octet-stream')
    const c = page.parseContainer(enc)!
    const derived = await page.derive(PASS, c.saltB64)
    const out = await page.decryptContainer(derived.key, c)
    expect(out.header.chunks).toBe(2)
    expect(bytesEqual(out.data, data)).toBe(true)
  }, 60_000)

  it('the page rejects tampering and non-containers exactly like the plugin', async () => {
    const { key, keyId, salt } = await channelKey()
    const enc = await encryptFileToBpenc(key, keyId, salt, patternedBytes(2048), 'a.txt', 'text/plain')
    const derived = await page.derive(PASS, salt)

    const tampered = enc.slice()
    tampered[tampered.length - 5]! ^= 0x01
    await expect(page.decryptContainer(derived.key, page.parseContainer(tampered))).rejects.toThrow()

    const truncated = enc.subarray(0, enc.length - 1024)
    await expect(page.decryptContainer(derived.key, page.parseContainer(truncated))).rejects.toThrow()

    expect(page.parseContainer(new TextEncoder().encode('this is just a jpeg'))).toBeNull()
    expect(page.parseContainer(new Uint8Array(4))).toBeNull()
  })
})
