/**
 * AES-256-GCM text encrypt/decrypt primitives. 12-byte random IV per message.
 * All strings on the wire are base64url (no padding).
 */

import { b64urlDecode, b64urlEncode } from './b64'

export async function encryptText(key: CryptoKey, plaintext: string): Promise<{ iv: string; ct: string }> {
  const iv = new Uint8Array(12)
  crypto.getRandomValues(iv)
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)),
  )
  return { iv: b64urlEncode(iv), ct: b64urlEncode(ct) }
}

/** Throws on GCM auth failure (tampered ciphertext or wrong key) or malformed base64url. */
export async function decryptText(key: CryptoKey, ivB64: string, ctB64: string): Promise<string> {
  const iv = b64urlDecode(ivB64)
  const ct = b64urlDecode(ctB64)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  // A leading U+FEFF is plaintext, including at independent part boundaries.
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(pt)
}
