/**
 * Encrypted file container ".bpenc" (spec §5):
 *
 *   bytes 0–5   : magic "BPENC1"
 *   bytes 6–13  : keyId — the 8 ASCII chars of the b64url keyId string
 *   bytes 14–29 : KDF salt — the 16 RAW bytes of the keyring entry's salt
 *   bytes 30–41 : header IV (12 random bytes)
 *   bytes 42–45 : uint32 BE = encrypted-header length N
 *   bytes 46–.. : AES-GCM(header JSON), N bytes (includes 16-byte tag)
 *   remainder   : data chunks — plaintext chunked at 8 MB; chunk i is an
 *                 independent AES-GCM stream (own 16-byte tag) with
 *                 IV = header IV incremented by (1 + i) as a big-endian
 *                 counter on the last 4 bytes.
 *
 * The salt is key-derivation metadata, not a secret — it already rides
 * plaintext in the text wire format (see wire.ts); carrying it lets
 * betterprivacy.app/m decrypt .bpenc files from the phrase alone.
 *
 * Header JSON: BpencHeader { filename, mime, size, sha256(hex of plaintext), chunks }.
 */

import type { BpencHeader } from '../types'
import { b64urlDecode, b64urlEncode, bufsrc } from './b64'

const MAGIC = 'BPENC1'
const MAGIC_LEN = 6
const KEYID_LEN = 8
const SALT_LEN = 16
const IV_LEN = 12
const HEADER_LEN_FIELD = 4
const FIXED_PREFIX = MAGIC_LEN + KEYID_LEN + SALT_LEN + IV_LEN + HEADER_LEN_FIELD // 46
const GCM_TAG_LEN = 16
export const CHUNK_SIZE = 8 * 1024 * 1024

function toHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += bytes[i]!.toString(16).padStart(2, '0')
  return out
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bufsrc(data))))
}

/** Header IV + n, big-endian counter increment on the last 4 bytes (mod 2^32). */
function ivPlus(iv: Uint8Array, n: number) {
  const out = new Uint8Array(IV_LEN)
  out.set(iv)
  const view = new DataView(out.buffer)
  view.setUint32(IV_LEN - 4, (view.getUint32(IV_LEN - 4) + n) >>> 0)
  return out
}

export async function encryptFileToBpenc(
  key: CryptoKey,
  keyId: string,
  saltB64: string,
  data: Uint8Array,
  filename: string,
  mime: string,
): Promise<Uint8Array> {
  if (!/^[A-Za-z0-9_-]{8}$/.test(keyId)) throw new Error('BP_BAD_KEYID')

  if (!/^[A-Za-z0-9_-]{22}$/.test(saltB64)) throw new Error('BP_BAD_SALT')
  let salt: Uint8Array
  try {
    salt = b64urlDecode(saltB64)
  } catch {
    throw new Error('BP_BAD_SALT')
  }
  if (salt.length !== SALT_LEN) throw new Error('BP_BAD_SALT')

  const chunks = Math.ceil(data.length / CHUNK_SIZE)
  const header: BpencHeader = {
    filename,
    mime,
    size: data.length,
    sha256: await sha256Hex(data),
    chunks,
  }

  const headerIv = new Uint8Array(IV_LEN)
  crypto.getRandomValues(headerIv)
  const encHeader = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: headerIv },
      key,
      new TextEncoder().encode(JSON.stringify(header)),
    ),
  )

  const encChunks: Uint8Array[] = []
  let totalChunkBytes = 0
  for (let i = 0; i < chunks; i++) {
    const plain = data.subarray(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, data.length))
    const enc = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivPlus(headerIv, 1 + i) }, key, bufsrc(plain)),
    )
    encChunks.push(enc)
    totalChunkBytes += enc.length
  }

  const out = new Uint8Array(FIXED_PREFIX + encHeader.length + totalChunkBytes)
  let off = 0
  for (let i = 0; i < MAGIC_LEN; i++) out[off++] = MAGIC.charCodeAt(i)
  for (let i = 0; i < KEYID_LEN; i++) out[off++] = keyId.charCodeAt(i)
  out.set(salt, off)
  off += SALT_LEN
  out.set(headerIv, off)
  off += IV_LEN
  new DataView(out.buffer).setUint32(off, encHeader.length)
  off += HEADER_LEN_FIELD
  out.set(encHeader, off)
  off += encHeader.length
  for (const enc of encChunks) {
    out.set(enc, off)
    off += enc.length
  }
  return out
}

/** Reads only magic + keyId field. Returns null if too short, wrong magic, or non-b64url keyId bytes. */
export function peekBpencKeyId(bytes: Uint8Array): string | null {
  if (bytes.length < MAGIC_LEN + KEYID_LEN) return null
  for (let i = 0; i < MAGIC_LEN; i++) {
    if (bytes[i] !== MAGIC.charCodeAt(i)) return null
  }
  let keyId = ''
  for (let i = MAGIC_LEN; i < MAGIC_LEN + KEYID_LEN; i++) keyId += String.fromCharCode(bytes[i]!)
  if (!/^[A-Za-z0-9_-]{8}$/.test(keyId)) return null
  return keyId
}

/**
 * The container's KDF salt as b64url (22 chars), or null when the buffer isn't
 * a .bpenc header or is too short to hold the salt field. The web decrypt page
 * mirrors this read; the plugin exports it for parity/tests.
 */
export function peekBpencSalt(bytes: Uint8Array): string | null {
  if (peekBpencKeyId(bytes) === null) return null
  if (bytes.length < MAGIC_LEN + KEYID_LEN + SALT_LEN) return null
  return b64urlEncode(bytes.subarray(MAGIC_LEN + KEYID_LEN, MAGIC_LEN + KEYID_LEN + SALT_LEN))
}

/**
 * Throws on wrong magic/truncation, GCM auth failure (header or any chunk),
 * or plaintext sha256 mismatch.
 */
export async function decryptBpenc(
  key: CryptoKey,
  bytes: Uint8Array,
): Promise<{ header: BpencHeader; data: Uint8Array }> {
  if (peekBpencKeyId(bytes) === null) throw new Error('BP_BAD_MAGIC')
  if (bytes.length < FIXED_PREFIX) throw new Error('BP_TRUNCATED')

  // The salt (bytes 14–29) is skipped here — the caller already has the key.
  const IV_OFF = MAGIC_LEN + KEYID_LEN + SALT_LEN // 30
  const headerIv = bytes.subarray(IV_OFF, IV_OFF + IV_LEN)
  const headerLen = new DataView(bytes.buffer, bytes.byteOffset).getUint32(IV_OFF + IV_LEN)
  if (bytes.length < FIXED_PREFIX + headerLen) throw new Error('BP_TRUNCATED')

  const headerPlain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bufsrc(headerIv) },
    key,
    bufsrc(bytes.subarray(FIXED_PREFIX, FIXED_PREFIX + headerLen)),
  )
  const header = JSON.parse(new TextDecoder().decode(headerPlain)) as BpencHeader
  if (
    !header || typeof header !== 'object' ||
    typeof header.filename !== 'string' ||
    typeof header.mime !== 'string' ||
    typeof header.size !== 'number' ||
    typeof header.chunks !== 'number' ||
    typeof header.sha256 !== 'string' ||
    !Number.isSafeInteger(header.size) ||
    !Number.isSafeInteger(header.chunks) ||
    header.size < 0 ||
    header.chunks !== Math.ceil(header.size / CHUNK_SIZE) ||
    // Ciphertext is never smaller than plaintext (chunks only add GCM tags),
    // so a size beyond the remaining bytes is forged — reject before the
    // allocation below.
    header.size > bytes.length - FIXED_PREFIX - headerLen
  ) {
    throw new Error('BP_BAD_HEADER')
  }

  const data = new Uint8Array(header.size)
  let readOff = FIXED_PREFIX + headerLen
  let writeOff = 0
  for (let i = 0; i < header.chunks; i++) {
    const plainLen = Math.min(CHUNK_SIZE, header.size - writeOff)
    const encLen = plainLen + GCM_TAG_LEN
    if (bytes.length < readOff + encLen) throw new Error('BP_TRUNCATED')
    const plain = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivPlus(headerIv, 1 + i) },
        key,
        bufsrc(bytes.subarray(readOff, readOff + encLen)),
      ),
    )
    data.set(plain, writeOff)
    writeOff += plain.length
    readOff += encLen
  }
  if (readOff !== bytes.length) throw new Error('BP_TRAILING_DATA')

  if ((await sha256Hex(data)) !== header.sha256) throw new Error('BP_SHA256_MISMATCH')
  return { header, data }
}
