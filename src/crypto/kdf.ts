/**
 * Passphrase → key derivation. PBKDF2-HMAC-SHA256, 600_000 iterations,
 * 16-byte salt → 256-bit AES-GCM key (imported NON-extractable).
 *
 * The raw derived bits exist only transiently: we hash them for the keyId,
 * import them as a non-extractable CryptoKey, compute the KCV via that key,
 * and then overwrite the raw buffer with zeros.
 */

import type { DerivedKeyMaterial } from '../types'
import { b64urlDecode, b64urlEncode } from './b64'

export const PBKDF2_ITERATIONS = 600_000

/** Domain-separation prefix so label-derived salts can never collide with other uses of SHA-256. */
const LABEL_SALT_DOMAIN = 'BetterPrivacy/v1/label-salt:'

/**
 * Deterministic salt: first 16 bytes of SHA-256(domain ‖ normalized label).
 *
 * This is what makes "label + passphrase is the whole key" true: the same
 * label and passphrase re-derive the identical key (same keyId) on any
 * machine, after any reinstall or config loss — no stored salt required.
 * The label is normalized (trimmed, lowercased) so "Friends" and " friends "
 * agree across peers.
 *
 * SECURITY TRADE-OFF (documented in README): salts are no longer random, so
 * an attacker who guesses the label can precompute a dictionary for it.
 * Resistance rests entirely on passphrase strength; PBKDF2's 600k iterations
 * still apply per guess.
 */
export async function deriveSaltFromLabel(label: string): Promise<string> {
  const normalized = label.trim().toLowerCase()
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(LABEL_SALT_DOMAIN + normalized)),
  )
  return b64urlEncode(digest.subarray(0, 16))
}

export async function deriveKeyMaterial(passphrase: string, saltB64: string): Promise<DerivedKeyMaterial> {
  const salt = b64urlDecode(saltB64)
  const passKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits'],
  )

  // 1. Derive the raw 256-bit key material.
  const rawBuf = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    passKey,
    256,
  )
  const raw = new Uint8Array(rawBuf)

  try {
    // 2. keyId = first 6 bytes of SHA-256(raw bits), b64url => exactly 8 chars.
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', raw))
    const keyId = b64urlEncode(digest.subarray(0, 6))

    // 3. Import as a NON-extractable AES-256-GCM key.
    const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
      'encrypt',
      'decrypt',
    ])

    // 4. KCV: AES-GCM-encrypt the constant "BPKCV" with an all-zero 12-byte IV,
    //    take the first 4 ciphertext bytes, b64url. Detects wrong passphrases
    //    at unlock time; reveals nothing useful about the key.
    const zeroIv = new Uint8Array(12)
    const kcvCt = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv: zeroIv }, key, new TextEncoder().encode('BPKCV')),
    )
    const kcv = b64urlEncode(kcvCt.subarray(0, 4))

    return { key, keyId, kcv }
  } finally {
    // 5. Drop the raw bits — overwrite with zeros.
    raw.fill(0)
    new Uint8Array(rawBuf).fill(0)
  }
}
