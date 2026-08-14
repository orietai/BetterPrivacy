/**
 * Internal base64url helpers (no padding). Pure — works in both the Discord
 * renderer and Node 18+ (btoa/atob are global in both).
 */

export function b64urlEncode(bytes: Uint8Array): string {
  let bin = ''
  // Chunked to avoid call-stack limits on large inputs.
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Throws on invalid base64url input. */
export function b64urlDecode(s: string) {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('invalid base64url')
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Type-level normalization for WebCrypto BufferSource parameters: newer TS
 * libs make typed arrays generic over their backing buffer, and a plain
 * `Uint8Array` (ArrayBufferLike-backed) no longer satisfies BufferSource.
 * Runtime no-op — our buffers are never SharedArrayBuffer-backed.
 */
export function bufsrc(u: Uint8Array): BufferSource {
  return u as BufferSource
}
