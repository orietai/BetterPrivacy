/**
 * Wire format v1 — the first public release's sole message format:
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
  /^(?:🦇)?<?https:\/\/betterprivacy\.app\/m\/?#v1\.([A-Za-z0-9_-]{8})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]+)>?$/

/**
 * Per-chunk plaintext budget in UTF-8 BYTES (not UTF-16 chars — multi-byte
 * text inflates through UTF-8 → ciphertext → base64url). Fixed wire overhead
 * is ≈ 84 UTF-16 units (🦇 + <> + URL prefix + keyId + salt + iv +
 * separators); 1360 plaintext bytes + 16-byte GCM tag encode to
 * ceil(1376 × 4 / 3) = 1835 b64url chars → ≈ 1919 total, safely under
 * Discord's 2000. The definitive guard is still encodeWire's BP_OVERSIZE.
 */
export const CHUNK_UTF8_BYTES = 1360

/**
 * Splits plaintext into chunks that each fit one wire message. Chunks are
 * lossless (concatenating them reproduces the input exactly), never split a
 * surrogate pair (code-point iteration), and prefer breaking just after
 * whitespace when one occurred past 60% of the byte budget — so parts read
 * naturally instead of cutting mid-word.
 *
 * UNBOUNDED: as many chunks as the text needs, no cap and no throw. A cap
 * here would only reintroduce the "encryption is broken" failure a user sees
 * when a paste is refused; the friction for genuinely huge sends belongs in
 * the UI instead, so send.ts asks for one confirmation past its
 * many-parts threshold.
 */
export function chunkPlaintext(text: string): string[] {
  const chunks: string[] = []
  let start = 0 // UTF-16 index where the current chunk begins
  let i = 0
  let bytes = 0
  let breakAt = -1 // UTF-16 index just after the last whitespace in this chunk
  let breakBytes = 0

  while (i < text.length) {
    const cp = text.codePointAt(i)!
    const cpUnits = cp > 0xffff ? 2 : 1
    const cpBytes = cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4

    if (bytes + cpBytes > CHUNK_UTF8_BYTES) {
      const cut = breakAt > start && breakBytes >= CHUNK_UTF8_BYTES * 0.6 ? breakAt : i
      chunks.push(text.slice(start, cut))
      start = cut
      i = cut
      bytes = 0
      breakAt = -1
      breakBytes = 0
      continue
    }

    bytes += cpBytes
    i += cpUnits
    if (cp === 0x20 /* space */ || cp === 0x0a /* \n */ || cp === 0x09 /* \t */) {
      breakAt = i
      breakBytes = bytes
    }
  }

  chunks.push(text.slice(start))
  return chunks
}

/**
 * Discord's own per-message character ceiling. Exported because the send
 * patch's '/pt ' passthrough has to enforce it client-side now that
 * patches/composerLimit.ts lets longer text reach the patch.
 */
export const DISCORD_MESSAGE_LIMIT = 2000

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
