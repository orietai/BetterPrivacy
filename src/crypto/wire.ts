/**
 * Wire format v1 — the release format, and the only one that exists
 * (test-era formats were deleted before first release; see
 * PRE-LAUNCH-REVIEW.md D1/D3):
 *
 *   🦇<https://betterprivacy.app/m#v1.<keyId>.<salt>.<iv>.<ciphertext>>
 *
 * The payload IS a real URL, wrapped in <> so Discord renders a clickable
 * link without an embed card. Recipients without the plugin can click it:
 * the decrypt page at betterprivacy.app/m reads the fragment — which
 * browsers never send to any server — and decrypts locally once the secret
 * phrase is entered. Every encrypted message doubles as a signpost to the
 * plugin.
 *
 * Field notes:
 * - "." separates fields: it is outside the b64url alphabet and, unlike "|",
 *   never terminates Discord's link detection.
 * - salt (16 bytes → 22 chars b64url) rides along so the web page can
 *   re-derive the key from the phrase alone, without knowing the
 *   channel/label the salt came from. The salt derives from public data and
 *   is stored plaintext in the keyring — carrying it discloses nothing new;
 *   phrase strength remains the entire defense.
 * - parseWire tolerates a stripped 🦇 and/or <> wrapper (copy/paste, other
 *   clients), but a mismatched wrapper means mangling → null.
 *
 * Anchored regex; parseWire returns null silently on anything malformed so
 * ordinary messages (even ones containing 🦇 or links) never break.
 */

import type { WireParts } from '../types'

const WIRE_URL_PREFIX = 'https://betterprivacy.app/m#v1.'

export const WIRE_REGEX =
  /^(?:🦇)?<?https:\/\/betterprivacy\.app\/m#v1\.([A-Za-z0-9_-]{8})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]+)>?$/

/**
 * Conservative plaintext cap. Fixed wire overhead is ≈ 84 UTF-16 units
 * (🦇 + <> + URL prefix + keyId + salt + iv + separators); worst-case ASCII
 * plaintext of 1400 chars encodes to base64url(1400 + 16-byte GCM tag)
 * ≈ 1888 chars → ≈ 1972 total, under Discord's 2000. This guards typical
 * input length up front; the definitive guard is encodeWire, which throws
 * BP_OVERSIZE if the final wire string exceeds the limit (multi-byte-heavy
 * plaintext inflates the UTF-8 → ciphertext → base64url length beyond the
 * char count).
 */
export const MAX_PLAINTEXT_CHARS = 1400

const DISCORD_MESSAGE_LIMIT = 2000

/** Throws Error('BP_OVERSIZE') if the encoded message would exceed 2000 chars. */
export function encodeWire(p: WireParts): string {
  const wire = `🦇<${WIRE_URL_PREFIX}${p.keyId}.${p.salt}.${p.iv}.${p.ciphertext}>`
  if (wire.length > DISCORD_MESSAGE_LIMIT) throw new Error('BP_OVERSIZE')
  return wire
}

/** Returns null silently on malformed input. */
export function parseWire(content: string): WireParts | null {
  if (typeof content !== 'string') return null
  const m = WIRE_REGEX.exec(content)
  if (!m) return null
  // Both wrappers stripped is fine (copy/paste); exactly one is mangling.
  if (content.includes('<') !== content.includes('>')) return null
  return { keyId: m[1]!, salt: m[2]!, iv: m[3]!, ciphertext: m[4]! }
}
