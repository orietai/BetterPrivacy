# Pre-Launch Review — v1.0.0

Decision log from the product-owner pass before first release. v1.0.0 has no
released users, so this is the last moment breaking changes are free. Every
decision below was taken with that window in mind.

## D1 — The wire format becomes a real URL

**Finding:** Discord only auto-links text with an `https://` scheme. The
test-era format (`🦇betterprivacy.app/v1|…`) would **never** have been
clickable — the "every message advertises us" goal silently didn't work.

**Decision:** The one and only release wire format is:

```
🦇<https://betterprivacy.app/m#v1.<keyId>.<salt>.<iv>.<ciphertext>>
```

- A real URL → clickable for everyone, in and out of Discord.
- Wrapped in `<>` → Discord renders a plain clickable link with **no embed
  card** (no per-message preview spam) and **no crawler fetch** per message.
- `.` separates fields: it is outside the b64url alphabet and, unlike `|`,
  never terminates Discord's link detection.
- Fixed overhead ≈ 84 UTF-16 units; worst-case ASCII plaintext at the 1400
  cap encodes to ≈ 1972 chars — under Discord's 2000. `encodeWire` still
  hard-fails with `BP_OVERSIZE` past the limit.
- Parsing tolerates a stripped `🦇` and/or `<>` (copy/paste, other clients),
  but rejects mismatched wrappers as mangled.

## D2 — The salt rides in the wire

The decrypt page receives only the URL. Key derivation needs the salt, which
was previously reconstructed from the channel label — something the page
can't know. The salt (16 bytes, 22 chars b64url) is therefore now a wire
field.

**Security delta: none meaningful.** For channel keys the salt is
`SHA-256('BetterPrivacy/v1/label-salt:' + 'channel:<id>')[:16]` — derived
from data every channel member already sees, and stored plaintext in the
keyring. Carrying it discloses nothing an attacker in scope didn't have;
phrase strength remains the entire defense (documented in the README threat
model). Side benefit: recovery and web decryption now work for
custom-labeled keys too, without knowing the label.

## D3 — No legacy at launch

All test-era formats (`🦇betterprivacy.app/v1|…`, `🔐betterprivacy.app/v1|…`,
`🔐BP1|…`) and the unused `generateSalt()` are **deleted**, not deprecated.
Messages sent during development become permanently unreadable — acceptable,
they were ours. The public format is named `v1` because for users it is the
first format that ever existed.

**Versioning policy from here:** the fragment's `v1.` prefix is the format
version. Post-release rule: parse every format ever released, emit only the
newest. Breaking parse compatibility after release is not an option.

## D4 — The decrypt page (`/m`)

Static page, no backend, no analytics. The payload lives in the URL
**fragment**, which browsers never send in HTTP requests — betterprivacy.app
(and any CDN in front of it) never sees ciphertext, let alone plaintext. All
crypto runs in the visitor's browser via WebCrypto, mirroring the plugin
exactly: PBKDF2-HMAC-SHA256 × 600,000 → AES-256-GCM; wrong phrases are
detected by keyId mismatch before any decrypt attempt.

Scope for v1: **text messages only.** Encrypted attachments (`.bpenc`) are
out — fetching Discord CDN URLs from a third-party origin is CORS-blocked,
and files can be large. The page tells attachment recipients to install the
plugin instead.

## Accepted risks

- **R1 — AutoMod link filters.** Servers with "block links" rules will block
  wire messages. The send fails visibly (Discord rejects it; nothing leaks —
  the fail-closed model is unaffected). Accepted for v1; a compact no-link
  format toggle is on the backlog if reports warrant it.
- **R2 — Non-Discord unfurlers.** Other chat apps may fetch the URL for a
  preview; they get the generic OG card (the fragment never leaves the
  client), so nothing sensitive is exposed.
- **R3 — Long visible URLs.** Non-plugin users see a long 🦇 link instead of
  short gibberish. Trade accepted: the link is the distribution channel.

## Backlog (explicitly deferred, not forgotten)

1. Compact no-link wire format as an opt-in setting (AutoMod-hostile servers).
2. `.bpenc` support on the decrypt page (user drags the downloaded file in).
3. In-plugin "recover from message" using the wire salt (works for custom
   labels; today's recover modal only reconstructs channel-labeled keys).
4. Self-host the two web fonts so the site makes zero third-party requests.
5. `masterPassphrase` setting is stubbed/disabled — ship or remove in 1.1.
