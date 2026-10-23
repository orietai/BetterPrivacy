import { describe, expect, it } from 'vitest'

import { deriveKeyMaterial, deriveSaltFromLabel } from '../src/crypto/kdf'
import { decryptText, encryptText } from '../src/crypto/cipher'
import {
  CHUNK_UTF8_BYTES,
  WIRE_REGEX,
  chunkPlaintext,
  encodeWire,
  parseWire,
} from '../src/crypto/wire'
import {
  CHUNK_SIZE,
  decryptBpenc,
  encryptFileToBpenc,
  peekBpencKeyId,
  peekBpencSalt,
} from '../src/crypto/bpenc'
import { b64urlEncode, bufsrc } from '../src/crypto/b64'

// Node 18+: WebCrypto is available as globalThis.crypto — no setup needed.

const PASS = 'correct horse battery staple'

/** 16 random bytes, b64url — arbitrary valid salt for tests. */
function randomSalt(): string {
  const salt = new Uint8Array(16)
  crypto.getRandomValues(salt)
  return b64urlEncode(salt)
}

// PBKDF2 at 600k iterations is intentionally slow; derive once and share.
let sharedSalt: string
let shared: Awaited<ReturnType<typeof deriveKeyMaterial>>
async function material() {
  if (!shared) {
    sharedSalt = randomSalt()
    shared = await deriveKeyMaterial(PASS, sharedSalt)
  }
  return shared
}

describe('kdf', () => {
  it('is deterministic: same passphrase + salt → same keyId and kcv', async () => {
    const a = await material()
    const b = await deriveKeyMaterial(PASS, sharedSalt)
    expect(b.keyId).toBe(a.keyId)
    expect(b.kcv).toBe(a.kcv)
    expect(a.keyId).toMatch(/^[A-Za-z0-9_-]{8}$/) // 6 bytes → exactly 8 b64url chars
    expect(a.kcv).toMatch(/^[A-Za-z0-9_-]{6}$/) // 4 bytes → 6 b64url chars
  })

  it('different salt → different keyId', async () => {
    const a = await material()
    const b = await deriveKeyMaterial(PASS, randomSalt())
    expect(b.keyId).not.toBe(a.keyId)
  })

  it('produces a non-extractable AES-GCM key', async () => {
    const { key } = await material()
    expect(key.extractable).toBe(false)
    expect(key.algorithm).toMatchObject({ name: 'AES-GCM' })
  })

  it('deriveSaltFromLabel is deterministic and normalizes case/whitespace', async () => {
    const a = await deriveSaltFromLabel('Friends')
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/) // 16 bytes → 22 unpadded b64url chars
    expect(await deriveSaltFromLabel('Friends')).toBe(a)
    expect(await deriveSaltFromLabel('  friends ')).toBe(a)
    expect(await deriveSaltFromLabel('FRIENDS')).toBe(a)
    expect(await deriveSaltFromLabel('friends2')).not.toBe(a)
  })

  it('label + passphrase fully determine the key (reinstall recovery)', async () => {
    // Simulates: create key → lose the keyring → re-create with the same
    // label + passphrase → identical keyId, so old messages decrypt.
    const first = await deriveKeyMaterial(PASS, await deriveSaltFromLabel('team-chat'))
    const recovered = await deriveKeyMaterial(PASS, await deriveSaltFromLabel('Team-Chat '))
    expect(recovered.keyId).toBe(first.keyId)
    expect(recovered.kcv).toBe(first.kcv)
    const wrongPass = await deriveKeyMaterial(PASS + 'x', await deriveSaltFromLabel('team-chat'))
    expect(wrongPass.keyId).not.toBe(first.keyId)
  })
})

describe('cipher', () => {
  it.each(['\uFEFF', '\uFEFF\uFEFFhello 🔐\uFEFF', 'hello\uFEFFworld'])('preserves U+FEFF in %j', async plaintext => {
    const { key } = await material()
    const { iv, ct } = await encryptText(key, plaintext)
    await expect(decryptText(key, iv, ct)).resolves.toBe(plaintext)
  })

  it('roundtrips text (incl. multi-byte)', async () => {
    const { key } = await material()
    const plaintext = 'hello 🔐 world — ünïcödé ||spoiler|| `code`'
    const { iv, ct } = await encryptText(key, plaintext)
    expect(iv).toMatch(/^[A-Za-z0-9_-]{16}$/) // 12-byte IV → 16 b64url chars
    await expect(decryptText(key, iv, ct)).resolves.toBe(plaintext)
  })

  it('uses a fresh IV per message', async () => {
    const { key } = await material()
    const a = await encryptText(key, 'same')
    const b = await encryptText(key, 'same')
    expect(a.iv).not.toBe(b.iv)
    expect(a.ct).not.toBe(b.ct)
  })

  it('rejects tampered ciphertext (GCM auth failure)', async () => {
    const { key } = await material()
    const { iv, ct } = await encryptText(key, 'attack at dawn')
    // Flip one char to a *different valid* b64url char so decode succeeds but auth fails.
    const flipped = (ct[0] === 'A' ? 'B' : 'A') + ct.slice(1)
    await expect(decryptText(key, iv, flipped)).rejects.toThrow()
  })

  it('rejects decryption with a different key', async () => {
    const { key } = await material()
    const other = await deriveKeyMaterial('wrong passphrase', sharedSalt)
    const { iv, ct } = await encryptText(key, 'secret')
    await expect(decryptText(other.key, iv, ct)).rejects.toThrow()
  })
})

describe('wire', () => {
  const K = 'A'.repeat(8)
  const S = 'A'.repeat(22)
  const I = 'A'.repeat(16)

  it('encode/parse roundtrip (URL wire format)', async () => {
    const { key, keyId } = await material()
    const { iv, ct } = await encryptText(key, 'wire roundtrip ✅')
    const wire = encodeWire({ keyId, salt: sharedSalt, iv, ciphertext: ct })
    // A real, clickable URL wrapped in <> (suppresses Discord's embed card),
    // branded with the 🦇 logo. The fragment carries the payload.
    expect(wire.startsWith('🦇<https://betterprivacy.app/m#v1.')).toBe(true)
    expect(wire.endsWith('>')).toBe(true)
    expect(WIRE_REGEX.test(wire)).toBe(true)
    const parts = parseWire(wire)
    expect(parts).toEqual({ keyId, salt: sharedSalt, iv, ciphertext: ct })
    await expect(decryptText(key, parts!.iv, parts!.ciphertext)).resolves.toBe('wire roundtrip ✅')
  })

  it('parse tolerates stripped 🦇 and <> wrappers, rejects mismatched ones', async () => {
    const { key, keyId } = await material()
    const { iv, ct } = await encryptText(key, 'tolerance')
    const wire = encodeWire({ keyId, salt: sharedSalt, iv, ciphertext: ct })
    const parts = { keyId, salt: sharedSalt, iv, ciphertext: ct }
    expect(parseWire(wire.slice(2))).toEqual(parts) // 🦇 stripped (2 UTF-16 units)
    expect(parseWire('🦇' + wire.slice(3, -1))).toEqual(parts) // <> stripped
    expect(parseWire(wire.slice(3, -1))).toEqual(parts) // bare URL
    expect(parseWire(wire.slice(0, -1))).toBeNull() // '<' without '>' = mangled
    expect(parseWire(wire.slice(2).replace('<', ''))).toBeNull() // '>' without '<'
  })

  it('web decrypt parity: phrase + wire alone recreate the key', async () => {
    // Exactly what betterprivacy.app/m does: it has only the URL fragment
    // and the phrase the visitor types — no keyring, no channel context.
    const salt = await deriveSaltFromLabel('channel:123456789012345678')
    const sender = await deriveKeyMaterial(PASS, salt)
    const { iv, ct } = await encryptText(sender.key, 'meet at the rooftop 🛰')
    const wire = encodeWire({ keyId: sender.keyId, salt, iv, ciphertext: ct })

    const parts = parseWire(wire)!
    const receiver = await deriveKeyMaterial(PASS, parts.salt)
    expect(receiver.keyId).toBe(parts.keyId) // the page's wrong-phrase check
    await expect(decryptText(receiver.key, parts.iv, parts.ciphertext)).resolves.toBe(
      'meet at the rooftop 🛰',
    )
    const wrong = await deriveKeyMaterial('not the phrase', parts.salt)
    expect(wrong.keyId).not.toBe(parts.keyId)
  })

  it('parseWire returns null on malformed candidates', () => {
    expect(parseWire(`🦇<https://betterprivacy.app/m#v1.${K}.${S}.${I}.abc>`)).not.toBeNull() // sanity
    expect(parseWire('just a normal message')).toBeNull()
    expect(parseWire('🦇 https://betterprivacy.app — check this plugin out')).toBeNull()
    expect(parseWire(`🦇<https://betterprivacy.app/m#v2.${K}.${S}.${I}.abc>`)).toBeNull() // future version
    expect(parseWire(`🦇<http://betterprivacy.app/m#v1.${K}.${S}.${I}.abc>`)).toBeNull() // not https
    expect(parseWire(`🦇<https://betterprivacy.app/m#v1.short.${S}.${I}.abc>`)).toBeNull() // keyId length
    expect(parseWire(`🦇<https://betterprivacy.app/m#v1.${K}.short.${I}.abc>`)).toBeNull() // salt length
    expect(parseWire(`🦇<https://betterprivacy.app/m#v1.${K}.${S}.${I}>`)).toBeNull() // missing ct
    expect(parseWire(`🦇<https://betterprivacy.app/m#v1.${K}.${S}.${I}.ab+c>`)).toBeNull() // non-b64url
    expect(parseWire(`xx🦇<https://betterprivacy.app/m#v1.${K}.${S}.${I}.abc>`)).toBeNull() // not anchored
    expect(parseWire(`🦇<https://betterprivacy.app/m#v1.${K}.${S}.${I}.abc>\nmore`)).toBeNull() // trailing junk
  })

  it('test-era formats are rejected — 1.0.0 launches with exactly one format', () => {
    for (const old of [
      '🦇betterprivacy.app/v1|AAAAAAAA|AAAAAAAAAAAAAAAA|abc',
      '🔐betterprivacy.app/v1|AAAAAAAA|AAAAAAAAAAAAAAAA|abc',
      '🔐BP1|AAAAAAAA|AAAAAAAAAAAAAAAA|abc',
    ]) {
      expect(parseWire(old)).toBeNull()
    }
  })

  it('encodeWire throws BP_OVERSIZE beyond 2000 chars', async () => {
    const { key, keyId } = await material()
    const { iv, ct } = await encryptText(key, 'x'.repeat(1900))
    expect(() => encodeWire({ keyId, salt: sharedSalt, iv, ciphertext: ct })).toThrow('BP_OVERSIZE')
    // ...while a full CHUNK_UTF8_BYTES ASCII chunk fits.
    const ok = await encryptText(key, 'y'.repeat(CHUNK_UTF8_BYTES))
    expect(
      encodeWire({ keyId, salt: sharedSalt, iv: ok.iv, ciphertext: ok.ct }).length,
    ).toBeLessThanOrEqual(2000)
  })
})

describe('chunkPlaintext', () => {
  const utf8Len = (s: string) => new TextEncoder().encode(s).length

  it('preserves U+FEFF at the start of independently encrypted wire parts', async () => {
    const { key, keyId } = await material()
    const input = '\uFEFF' + 'x'.repeat(CHUNK_UTF8_BYTES - 3) + '\uFEFF\uFEFFtail 🔐'
    const chunks = chunkPlaintext(input)
    expect(chunks).toHaveLength(2)
    expect(chunks.every(chunk => chunk.startsWith('\uFEFF'))).toBe(true)
    const decoded: string[] = []
    for (const chunk of chunks) {
      const { iv, ct } = await encryptText(key, chunk)
      const wire = encodeWire({ keyId, salt: sharedSalt, iv, ciphertext: ct })
      const parts = parseWire(wire)!
      decoded.push(await decryptText(key, parts.iv, parts.ciphertext))
    }
    expect(decoded).toEqual(chunks)
    expect(decoded.join('')).toBe(input)
  })

  it('returns a single identical chunk for short text', () => {
    expect(chunkPlaintext('hello')).toEqual(['hello'])
  })

  it('is lossless and respects the UTF-8 byte budget', () => {
    const input = ('word '.repeat(400) + 'çınar ünïcödé 🦇 ').repeat(3)
    const chunks = chunkPlaintext(input)
    expect(chunks.join('')).toBe(input)
    for (const c of chunks) expect(utf8Len(c)).toBeLessThanOrEqual(CHUNK_UTF8_BYTES)
  })

  it('prefers breaking on word boundaries', () => {
    const input = 'word '.repeat(800) // 4000 ASCII bytes → 3 chunks
    const chunks = chunkPlaintext(input)
    expect(chunks.length).toBe(3)
    expect(chunks.join('')).toBe(input)
    for (const c of chunks.slice(0, -1)) expect(c.endsWith(' ')).toBe(true)
  })

  it('never splits a surrogate pair', () => {
    const input = '🦇'.repeat(1200) // 4800 UTF-8 bytes → multiple chunks
    const chunks = chunkPlaintext(input)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join('')).toBe(input)
    for (const c of chunks) {
      new TextEncoder().encode(c)
      expect(/[\uD800-\uDBFF]$/.test(c)).toBe(false) // no trailing high surrogate
      expect(/^[\uDC00-\uDFFF]/.test(c)).toBe(false) // no leading low surrogate
      expect(utf8Len(c)).toBeLessThanOrEqual(CHUNK_UTF8_BYTES)
    }
  })

  it('is unbounded — splits into as many chunks as the text needs', () => {
    const input = 'x'.repeat(CHUNK_UTF8_BYTES * 50)
    const chunks = chunkPlaintext(input)
    expect(chunks.length).toBe(50)
    for (const c of chunks) expect(utf8Len(c)).toBeLessThanOrEqual(CHUNK_UTF8_BYTES)
    expect(chunks.join('')).toBe(input)
  })

  it('every chunk of a long message round-trips the wire under 2000 chars', async () => {
    const { key, keyId } = await material()
    const input = 'lorem ipsum '.repeat(417) // ~5000 ASCII chars
    const chunks = chunkPlaintext(input)
    expect(chunks.join('')).toBe(input)
    for (const chunk of chunks) {
      const { iv, ct } = await encryptText(key, chunk)
      const wire = encodeWire({ keyId, salt: sharedSalt, iv, ciphertext: ct })
      expect(wire.length).toBeLessThanOrEqual(2000)
      const parts = parseWire(wire)
      expect(parts).toEqual({ keyId, salt: sharedSalt, iv, ciphertext: ct })
      await expect(decryptText(key, parts!.iv, parts!.ciphertext)).resolves.toBe(chunk)
    }
  }, 30_000)
})

/** Fast byte-wise equality (vitest's deep toEqual is too slow for multi-MB arrays). */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function patternedBytes(n: number): Uint8Array {
  const data = new Uint8Array(n)
  for (let i = 0; i < n; i++) data[i] = (i * 31 + ((i >> 8) * 7) + (i >> 16)) & 0xff
  // Sprinkle real randomness so chunks are not fully predictable.
  const rnd = new Uint8Array(Math.min(n, 1024))
  crypto.getRandomValues(rnd)
  data.set(rnd, n - rnd.length)
  return data
}

describe('bpenc', () => {
  it('roundtrips a small file', async () => {
    const { key, keyId } = await material()
    const data = patternedBytes(4096)
    const enc = await encryptFileToBpenc(key, keyId, sharedSalt, data, 'photo.png', 'image/png')
    expect(peekBpencKeyId(enc)).toBe(keyId)

    const out = await decryptBpenc(key, enc)
    expect(out.header.filename).toBe('photo.png')
    expect(out.header.mime).toBe('image/png')
    expect(out.header.size).toBe(4096)
    expect(out.header.chunks).toBe(1)
    expect(out.header.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(out.data).toEqual(data)
  })

  it('roundtrips a >8MB file through the multi-chunk path', async () => {
    const { key, keyId } = await material()
    const data = patternedBytes(9 * 1024 * 1024) // ~9 MB → 2 chunks
    const enc = await encryptFileToBpenc(
      key,
      keyId,
      sharedSalt,
      data,
      'big.bin',
      'application/octet-stream',
    )

    // 2 chunks → 2 independent GCM tags, plus the 46-byte prefix and encrypted header.
    expect(enc.length).toBe(46 + encHeaderLen(enc) + data.length + 2 * 16)

    const out = await decryptBpenc(key, enc)
    expect(out.header.chunks).toBe(2)
    expect(out.header.size).toBe(data.length)
    expect(out.data.length).toBe(data.length)
    expect(bytesEqual(out.data, data)).toBe(true)
  }, 30_000)

  it('roundtrips an exactly-8MB file as a single chunk', async () => {
    const { key, keyId } = await material()
    const data = patternedBytes(CHUNK_SIZE)
    const enc = await encryptFileToBpenc(
      key,
      keyId,
      sharedSalt,
      data,
      'exact.bin',
      'application/octet-stream',
    )
    const out = await decryptBpenc(key, enc)
    expect(out.header.chunks).toBe(1)
    expect(bytesEqual(out.data, data)).toBe(true)
  }, 30_000)

  it('throws on tampered bytes', async () => {
    const { key, keyId } = await material()
    const enc = await encryptFileToBpenc(
      key,
      keyId,
      sharedSalt,
      patternedBytes(2048),
      'a.txt',
      'text/plain',
    )
    const tamperedData = enc.slice()
    tamperedData[tamperedData.length - 5] ^= 0x01 // flip a bit in a data chunk
    await expect(decryptBpenc(key, tamperedData)).rejects.toThrow()

    const tamperedHeader = enc.slice()
    tamperedHeader[51] ^= 0x01 // flip a bit inside the encrypted header (starts at 46)
    await expect(decryptBpenc(key, tamperedHeader)).rejects.toThrow()
  })

  it('throws with the wrong key', async () => {
    const { key, keyId } = await material()
    const other = await deriveKeyMaterial('not the passphrase', sharedSalt)
    const enc = await encryptFileToBpenc(
      key,
      keyId,
      sharedSalt,
      patternedBytes(64),
      'a.txt',
      'text/plain',
    )
    await expect(decryptBpenc(other.key, enc)).rejects.toThrow()
  })

  it('peekBpencSalt returns the salt the container was built with', async () => {
    const { key, keyId } = await material()
    const enc = await encryptFileToBpenc(
      key,
      keyId,
      sharedSalt,
      patternedBytes(64),
      'a.txt',
      'text/plain',
    )
    expect(peekBpencSalt(enc)).toBe(sharedSalt)

    // Parity with the web page: keyId + salt are readable without the key.
    expect(peekBpencSalt(new Uint8Array(0))).toBeNull()
    expect(peekBpencSalt(new TextEncoder().encode('this is not a bpenc file'))).toBeNull()
    expect(peekBpencSalt(enc.subarray(0, 29))).toBeNull() // magic + keyId ok, salt truncated
  })

  it('rejects a malformed salt (BP_BAD_SALT)', async () => {
    const { key, keyId } = await material()
    const data = patternedBytes(64)
    await expect(
      encryptFileToBpenc(key, keyId, 'short', data, 'a.txt', 'text/plain'),
    ).rejects.toThrow('BP_BAD_SALT')
    await expect(
      encryptFileToBpenc(key, keyId, 'A'.repeat(21) + '+', data, 'a.txt', 'text/plain'),
    ).rejects.toThrow('BP_BAD_SALT')
  })

  it('peekBpencKeyId returns null on garbage', () => {
    expect(peekBpencKeyId(new Uint8Array(0))).toBeNull()
    expect(peekBpencKeyId(new Uint8Array([1, 2, 3]))).toBeNull() // too short
    expect(peekBpencKeyId(new TextEncoder().encode('this is not a bpenc file'))).toBeNull() // wrong magic
    const badKeyId = new TextEncoder().encode('BPENC1\x00\x01\x02\x03\x04\x05\x06\x07rest')
    expect(peekBpencKeyId(badKeyId)).toBeNull() // magic ok, keyId bytes not b64url ASCII
  })

  it('decryptBpenc throws on garbage input', async () => {
    const { key } = await material()
    await expect(decryptBpenc(key, new TextEncoder().encode('garbage'))).rejects.toThrow()
  })

  it('rejects a crafted header with non-string mime/filename (BP_BAD_HEADER)', async () => {
    const { key, keyId } = await material()
    const data = patternedBytes(64)
    const sha = await sha256HexOf(data)

    // encryptFileToBpenc only writes well-formed headers, so hostile ones are
    // assembled by hand (buildContainer mirrors the container layout).
    const numericMime = await buildContainer(
      key,
      keyId,
      { filename: 'a.txt', mime: 123, size: 64, sha256: sha, chunks: 1 },
      [data],
    )
    await expect(decryptBpenc(key, numericMime)).rejects.toThrow('BP_BAD_HEADER')

    const numericFilename = await buildContainer(
      key,
      keyId,
      { filename: 42, mime: 'text/plain', size: 64, sha256: sha, chunks: 1 },
      [data],
    )
    await expect(decryptBpenc(key, numericFilename)).rejects.toThrow('BP_BAD_HEADER')

    // Sanity: the same hand-rolled builder with a well-formed header decrypts,
    // so the rejections above are the validator's doing, not the builder's.
    const wellFormed = await buildContainer(
      key,
      keyId,
      { filename: 'a.txt', mime: 'text/plain', size: 64, sha256: sha, chunks: 1 },
      [data],
    )
    const out = await decryptBpenc(key, wellFormed)
    expect(out.header.mime).toBe('text/plain')
    expect(bytesEqual(out.data, data)).toBe(true)
  })

  it('rejects a header whose size exceeds the remaining container bytes (BP_BAD_HEADER)', async () => {
    const { key, keyId } = await material()
    const enc = await encryptFileToBpenc(
      key,
      keyId,
      sharedSalt,
      patternedBytes(2048),
      'a.bin',
      'application/octet-stream',
    )
    // Chop off part of the data section: header.size (2048) now exceeds the
    // remaining bytes, which the pre-allocation sanity check must catch.
    const truncated = enc.subarray(0, enc.length - 1024)
    await expect(decryptBpenc(key, truncated)).rejects.toThrow('BP_BAD_HEADER')
  })
})

/** Hex SHA-256 of `data` (matches the sha256 field decryptBpenc verifies). */
async function sha256HexOf(data: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bufsrc(data)))
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Minimal b64url → bytes, so the hand-rolled container can embed a real salt. */
function b64urlToBytes(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Assembles a .bpenc container by hand — same layout as src/crypto/bpenc.ts
 * (magic, keyId, 16 raw salt bytes, header IV, uint32 BE header length,
 * AES-GCM header, then chunks under IV+1+i) — but with an arbitrary `header`
 * object, so tests can craft hostile headers the real encryptor would never
 * emit.
 */
async function buildContainer(
  key: CryptoKey,
  keyId: string,
  header: unknown,
  chunks: Uint8Array[],
): Promise<Uint8Array> {
  const salt = b64urlToBytes(sharedSalt)
  const headerIv = new Uint8Array(12)
  crypto.getRandomValues(headerIv)
  const ivPlus = (n: number) => {
    const iv = headerIv.slice()
    const view = new DataView(iv.buffer)
    view.setUint32(8, (view.getUint32(8) + n) >>> 0)
    return iv
  }

  const encHeader = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: headerIv },
      key,
      new TextEncoder().encode(JSON.stringify(header)),
    ),
  )
  const encChunks: Uint8Array[] = []
  for (let i = 0; i < chunks.length; i++) {
    encChunks.push(
      new Uint8Array(
        await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivPlus(1 + i) }, key, bufsrc(chunks[i]!)),
      ),
    )
  }

  const out = new Uint8Array(46 + encHeader.length + encChunks.reduce((n, c) => n + c.length, 0))
  let off = 0
  for (const ch of 'BPENC1') out[off++] = ch.charCodeAt(0)
  for (const ch of keyId) out[off++] = ch.charCodeAt(0)
  out.set(salt, off)
  off += 16
  out.set(headerIv, off)
  off += 12
  new DataView(out.buffer).setUint32(off, encHeader.length)
  off += 4
  out.set(encHeader, off)
  off += encHeader.length
  for (const c of encChunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

/** Encrypted-header length as recorded in the container (uint32 BE at bytes 42–45). */
function encHeaderLen(enc: Uint8Array): number {
  return new DataView(enc.buffer, enc.byteOffset).getUint32(42)
}
