# BetterPrivacy — BetterDiscord E2E Encryption Plugin: Build Specification

**Version:** 1.0 · **Target:** BetterDiscord (single `.plugin.js`) · **Audience:** AI implementation workers

---

## 1. Product Summary

A BetterDiscord plugin that adds a client-side encryption layer over Discord chats, channels, and DMs. Messages are encrypted before they leave the client and decrypted on render, so Discord's servers only ever see ciphertext. No external servers, no backend — keys are pre-shared passphrases exchanged out-of-band, and all crypto happens locally via WebCrypto.

**Core behaviors:**

1. Encrypt outgoing messages with a user-selected key; decrypt incoming ones on the fly at render time.
2. Multiple independent keys usable simultaneously — even within one channel, per message.
3. Recipients decrypt only messages whose key they possess; others see ciphertext.
4. Decrypted messages are visually distinguished (fore-color + lock indicator).
5. **Lockdown mode ON:** switching the focused channel/DM re-locks everything — decrypted views revert to ciphertext until keys are re-supplied (unlocked) again.
6. **Lockdown mode OFF:** once a key is unlocked, messages stay decrypted until an inactivity timeout (default **3 hours**, configurable), after which keys are purged from memory and views re-lock.

7. **Full chat-feature coverage:** encrypted rich text (markdown, code blocks, emojis, spoilers, mentions-as-text), encrypted images/attachments with inline decrypted preview, and client-side equivalents for features Discord controls server-side (see coverage matrix, §12).

**Explicit non-goals:** forward secrecy / ratcheting, automatic key exchange, encrypted voice/video calls, encrypting Discord's server-side objects (native reactions, stickers, polls — see §12 for why and for the fallbacks). Note in README: this is passphrase-based symmetric E2E without forward secrecy or automatic key exchange; modifying the Discord client violates Discord ToS — users assume that risk.

---

## 2. Architecture

Single distributable file `BetterPrivacy.plugin.js`, built from modular TypeScript sources via esbuild (bundle → IIFE, BD meta header prepended).

```
src/
  index.ts            // BD plugin class: start/stop, patch lifecycle
  crypto/
    kdf.ts            // passphrase → key derivation
    cipher.ts         // encrypt/decrypt primitives
    wire.ts           // wire format encode/parse
  core/
    keyring.ts        // persistent key store (encrypted at rest)
    session.ts        // in-memory unlocked keys, lockdown & timeout logic
    decryptCache.ts   // messageId → plaintext cache (memory only)
  patches/
    send.ts           // outgoing message interception
    render.ts         // message content render patch (feeds Discord's own markdown parser)
    upload.ts         // outgoing attachment interception (CloudUpload)
    attachments.ts    // incoming .bpenc attachment render patch (decrypt → blob preview)
    channelSwitch.ts  // flux CHANNEL_SELECT subscriber (lockdown)
    contextMenu.ts    // message + channel context menu items
  ui/
    ChatBarControls.tsx   // lock toggle + active-key picker in chat input
    KeyManagerPanel.tsx   // settings: add/remove/label keys, scopes
    UnlockModal.tsx       // passphrase entry
    indicators.ts         // styles for encrypted/decrypted messages
  settings.ts         // config schema + BdApi.Data persistence
```

**BdApi surfaces used** (see docs.betterdiscord.app/api): `BdApi.Webpack` (locate Discord internals: `MessageActions`, `MessageStore`, `SelectedChannelStore`, `Dispatcher`, message content component), `BdApi.Patcher` (`before` on send, `after` on render), `BdApi.Data` (persistence), `BdApi.React`/`BdApi.DOM` (UI), `BdApi.UI` (toasts, modals), `BdApi.ContextMenu`.

**Golden rule:** never mutate the Flux message store with plaintext. Decryption happens only in the render layer (Patcher.after on the message content component). This makes re-locking trivial: clear the plaintext cache and force re-render — ciphertext is what the store always held.

---

## 3. Cryptography

| Item | Choice | Notes |
|---|---|---|
| KDF | PBKDF2-HMAC-SHA256, 600,000 iterations, 16-byte random salt per key | WebCrypto-native, no wasm dependency. Salt generated at key creation and stored in the keyring; the *sharer exports key as passphrase+salt blob* (see §4). |
| Cipher | AES-256-GCM, 12-byte random IV per message | Authenticated; tampering → decrypt failure, render as ciphertext with warning tint. |
| Key ID | First 6 bytes of SHA-256(derived key), base64url | Embedded in each message so receivers pick the right keyring entry without trial-decrypting against every key. Not secret (it's a fingerprint, reveals "same key as that other message" — document this). |
| RNG | `crypto.getRandomValues` | |
| Plaintext hygiene | Derived `CryptoKey`s non-extractable where possible; plaintext only in `decryptCache`; cache cleared on lock/timeout/stop; no `console.log` of plaintext or keys. | |

## 4. Key Model & Keyring

A **key entry**: `{ id: keyId, label: string, salt: b64, scope: 'global' | channelId | userId, createdAt }`. The passphrase itself is never persisted — only needed to *unlock* (re-derive) the key.

- **Create/import key:** user enters label + passphrase (+ optional scope). Plugin generates salt, derives key, computes keyId, stores entry. To share, user exports a **key blob** `betterprivacy-key:<b64(json{label,salt,check})>` and sends it to peers out-of-band (or via an already-encrypted channel); peer imports blob + types the passphrase. `check` = 4-byte KCV (encrypt-and-truncate of a constant) so wrong passphrases are detected at unlock time.
- **Multiple keys per channel:** keyring is a flat list; any number of entries can apply to one channel (scope match or global). The **active send key** is user-selected per channel via the chat-bar picker and remembered per channel.
- **Unlocked key:** a derived `CryptoKey` held in `session.ts` memory only, tagged with `unlockedAt` / `lastUsedAt`.
- **At-rest protection (optional, default off):** master passphrase encrypts the keyring JSON in `BdApi.Data` (AES-GCM, its own PBKDF2 salt). Without it, keyring metadata (labels/salts — not passphrases) is stored plaintext.

## 5. Wire Format

Outgoing encrypted message body (must fit Discord's 2000-char limit; ~33% base64 overhead + header). Because ciphertext is bigger than plaintext, one wire message holds a **per-part budget of 1360 plaintext bytes measured in UTF-8** (`CHUNK_UTF8_BYTES` — bytes, not UTF-16 units: multi-byte text inflates through UTF-8 → ciphertext → base64url). Longer plaintext is **split, not rejected**: `chunkPlaintext()` cuts it into as many parts as it needs — no cap (lossless, never splitting a surrogate pair, preferring a break just after the last whitespace once past 60% of the budget). Each part is encrypted to its own complete wire message, and the parts are sent sequentially — each awaited before the next — so they arrive in order. Recipients need no multipart support: each part decrypts independently and renders as its own message. Past `CONFIRM_PARTS_THRESHOLD` = 10 parts, `send.ts` asks once before any crypto runs ("this will be N separate encrypted messages — send them all?"); declining sends nothing. `patches/composerLimit.ts` raises the composer's own character ceiling while the focused channel is encrypted, so long text actually reaches the splitter instead of being blocked by the chat box. `encodeWire` still hard-fails with `BP_OVERSIZE` as the definitive per-part guard:

```
🦇<https://betterprivacy.app/m#v1.<keyId>.<salt_b64url>.<iv_b64url>.<ciphertext_b64url>>
```

- The payload **is a real URL**, so Discord linkifies it and anyone without the plugin can click through to the decrypt page; the `<>` wrapper suppresses the embed card. `.` separates fields because it is outside the base64url alphabet and, unlike `|`, never terminates Discord's link detection. See PRE-LAUNCH-REVIEW.md D1.
- The salt rides along so betterprivacy.app/m can re-derive the key from the phrase alone, with no keyring and no channel context (D2).
- Everything after `#` is a URL fragment, which browsers never send to any server — the site cannot see ciphertext even in its own logs.
- Parser must ignore malformed candidates silently (regular messages containing 🦇 or links must not break). Detection regex anchored at message start, tolerating a stripped 🦇 and/or `<>` from copy/paste but rejecting a mismatched wrapper.
- `v1` in the fragment carries the version; a future `v2` can change the payload while `parseWire` keeps accepting every released format (D3). Note that **multipart is deliberately not a format concern** — long messages are split into several ordinary wire messages (above), so there is no part header, no group id, and no reassembly state.

**Encrypted file format (`.bpenc`)** — for images and any attachment:

```
bytes 0–5   : magic "BPENC1"
bytes 6–13  : keyId (8 ASCII chars of the b64url keyId string)
bytes 14–29 : KDF salt (16 raw bytes — the keyring entry's salt)
bytes 30–41 : header IV (12 random bytes)
bytes 42–45 : header length N (uint32 BE)
bytes 46–.. : AES-GCM(header JSON, N bytes)  // {filename, mime, size, sha256, chunks}
remainder   : data chunks — plaintext cut at 8 MB; chunk i is its own AES-GCM
              stream (own 16-byte tag) with IV = header IV + (1 + i) as a
              big-endian counter on the last 4 bytes
```

Fixed prefix = 46 bytes. The **salt is carried in the clear** for the same reason it rides in the message wire format: it is key-derivation metadata derived from public data, not a secret, and carrying it lets `betterprivacy.app/m` derive the key from the phrase alone and decrypt a `.bpenc` file the visitor drops on the page. `encryptFileToBpenc(key, keyId, saltB64, data, filename, mime)` validates the salt as 22 b64url chars decoding to 16 bytes (`BP_BAD_SALT`); `peekBpencKeyId()` / `peekBpencSalt()` read the two clear fields without a key.

Uploaded to Discord as `<random-8-chars>.bpenc` so the true filename and type are hidden. Real filename/mime live inside the encrypted header, and the plaintext `sha256` is verified after decryption. Files ≥ ~64 MB or above the user's Discord upload cap are rejected with a toast. Encrypt/decrypt of large files runs in a chunked loop (8 MB chunks, each with derived per-chunk IV) to avoid blocking the renderer — one AES-GCM stream per chunk, chunk count stored in the header.

## 6. Message Pipelines

**Send (`patches/send.ts`):** `Patcher.instead` on `MessageActions.sendMessage(channelId, message, ...)` — `before` cannot cancel a send, and cancellation is load-bearing here (never silently send plaintext). If encrypt-mode is ON for that channel and an active key is unlocked: replace `message.content` with wire format. If active key is locked → open UnlockModal, abort send until unlocked (never silently send plaintext). Slash-style prefix override: a message starting with `/pt ` sends plaintext once; `/enc <label> message` encrypts one message with a specific key (case: *user A sends another message with a different key*).

**Receive/render (`patches/render.ts`):** `Patcher.after` on the message content component's render (locate via Webpack; fall back to `Dispatcher` MESSAGE_CREATE pre-processing only for detection, never store mutation). For each message matching the wire regex:

1. Look up `keyId` → keyring entry.
2. If key **unlocked** and session not locked → decrypt (memoize in `decryptCache` by messageId+editTimestamp), render plaintext wrapped in `<span class="bp-decrypted">` (distinct fore-color, e.g. `#3ba55d`, lock-open icon, tooltip: key label). Update `lastUsedAt`.
3. If key **known but locked** → render placeholder: `🔒 Encrypted message (key: <label>) — click to unlock` (click → UnlockModal).
4. If key **unknown** → render collapsed ciphertext chip: `🔒 Encrypted message (unknown key <keyId>)`, expandable to raw ciphertext; context-menu → "Import key…".
5. GCM auth failure → red-tinted `⚠ Decryption failed (tampered or wrong key)`.

Handle edits (re-parse on editTimestamp change) and the sender's own optimistic messages (encrypt-before-send means sender also sees ciphertext → decrypt path covers it symmetrically).

**Rich content rendering:** decrypted plaintext is NOT rendered as a plain span — it is fed through Discord's own markdown parser module (locate via Webpack: the `parse`/`parseTopic` markdown module). This makes every text-level feature work inside encrypted messages for free: **bold/italic/underline/strikethrough, `inline code`, fenced code blocks with syntax highlighting, blockquotes, spoiler tags `||…||`, headings/lists, unicode emoji, custom emoji syntax `<:name:id>` and `<a:name:id>`, mention syntax `<@id>/<#id>/<@&id>`, and links.** The parsed React tree is then wrapped in the `.bp-decrypted` container for the indicator styling. Caveats to document: mentions inside encrypted text render correctly but never trigger server-side notifications (the server never saw them); links never generate Discord embeds/link-previews (privacy win — optional client-side preview toggle, default off, since fetching the URL leaks it to that site).

**Encrypted attachments — send (`patches/upload.ts`):** `Patcher.instead` on Discord's `CloudUpload` (or the addFiles action feeding it). When encrypt-mode is ON: read the `File`, produce the `.bpenc` blob per §5, swap it in before upload. Toast confirms "attachment encrypted with <label>". `/pt` skips encryption for that message's files too.

**Encrypted attachments — receive (`patches/attachments.ts`):** `Patcher.after` on the attachment/media component render. For `.bpenc` attachments: render a locked chip (`🔒 Encrypted file — key <label|keyId>`). If key unlocked → auto-fetch (respecting a max auto-download size, default 25 MB), decrypt in memory, and by decrypted mime: images/gif → inline `<img>` from `URL.createObjectURL` (revoked on re-lock/unload); video/audio → inline player from blob URL; anything else → "Save decrypted file" button showing the true filename. Blob URLs and decrypted buffers are part of `decryptCache` — purged on lockdown/timeout exactly like text. Locked/unknown key → chip stays, with unlock/import affordances mirroring §6 text behavior.

## 7. Lockdown & Timeout (`core/session.ts`)

State machine per the two modes:

- **Lockdown ON:** subscribe to Flux `CHANNEL_SELECT` (and thread/DM selection events). On any focused-channel change: clear `decryptCache`, drop all unlocked `CryptoKey`s (or mark them locked — config: `relockScope: 'all' | 'previousChannelOnly'`, default `all`), force re-render of message list. Result: user must re-enter passphrases in the new (or returned-to) channel. Do **not** re-lock on mere window blur (out of scope v1).
- **Lockdown OFF:** unlocked keys persist. A single timer (checked every 60s) purges any key whose `lastUsedAt` exceeds `decryptTimeout` (default `10800s` = 3h; range 5min–24h; `0` = never). On purge: clear affected cache entries, re-render, toast "BetterPrivacy: session keys expired".
- **Always:** full purge on plugin `stop()`, Discord logout, and manual "Lock now" button/hotkey (default `Ctrl+Shift+L`).

## 8. UI Spec

- **Chat bar:** lock-toggle button (grey = plaintext mode, green = encrypt mode) + active-key dropdown listing keys applicable to the current channel, with per-key locked/unlocked badge and "Unlock…" / "New key…" entries. Encrypt-mode + active key are remembered per channel.
- **Message styling:** decrypted = colored text + small open-lock glyph + key-label tooltip; locked/unknown = muted chip as in §6. All styling injected via `BdApi.DOM.addStyle`, namespaced `.bp-*`, dark/light theme aware.
- **Settings panel (`getSettingsPanel`):** Key Manager table (label, keyId, scope, created, delete/export), toggles: lockdown mode, timeout duration, master passphrase on/off, indicator color picker.
- **Context menus:** message → "Copy ciphertext", "Re-decrypt", "Import key for this message"; channel → "Set default key".
- **Feedback:** `BdApi.UI.showToast` for unlock success/failure, timeout purge, oversize message rejection.

## 9. Acceptance Criteria (map to user cases)

| # | Scenario | Pass condition |
|---|---|---|
| A1 | A sends encrypted msg with key K1 to #XY | Server/API payload contains only wire-format ciphertext; A sees plaintext rendered with indicator |
| A2 | A sends second msg with different key K2 (via key picker or `/enc`) | Both messages coexist; each carries its own keyId |
| B1 | B has unlocked K1 only | B reads K1 messages decrypted+indicated; K2 messages show locked chip with K2's keyId |
| B2 | B imports K2 blob + passphrase mid-session | K2 messages decrypt immediately on re-render, no reload |
| L1 | Lockdown ON, B switches #XY → #general → back | All previously decrypted messages show locked; passphrase re-entry restores them |
| L2 | Lockdown OFF, timeout 3h (test with 1min override) | Messages stay decrypted across channel switches; after timeout, re-lock + toast |
| S1 | Non-plugin user views channel | Sees a 🦇 link / a `.bpenc` file; nothing breaks for them, and either one opens at betterprivacy.app/m with the phrase |
| S2 | Tampered ciphertext (flip a char) | Renders decryption-failed warning, no crash |
| S3 | Plugin stop/restart | No plaintext, decrypted blobs, or derived keys persisted anywhere on disk |
| R1 | A sends encrypted msg containing code block, custom emoji, spoiler, @mention | B (unlocked) sees syntax-highlighted code, rendered emoji, working spoiler, styled mention — identical to native rendering plus indicator |
| F1 | A sends an image with encrypt-mode ON | Server stores only `xxxxxxxx.bpenc`; B (unlocked) sees the image inline; B (locked) sees locked chip |
| F2 | A sends a PDF/zip encrypted | B decrypts via "Save decrypted file", original filename restored, sha256 verified |
| F3 | Lockdown/timeout fires with decrypted media on screen | Inline images/players revert to locked chips; blob URLs revoked |

## 10. Milestones for AI Workers

1. **M1 — Crypto core (pure, no Discord):** `kdf.ts`, `cipher.ts`, `wire.ts` + unit tests (vitest): roundtrip, keyId stability, KCV, tamper detection, oversize handling. *Exit: 100% tests green in Node with webcrypto.*
2. **M2 — BD scaffold + send/receive:** plugin class, Webpack module resolution (with defensive null checks + graceful degrade), send patch, render patch, hardcoded single key. *Exit: A1, S1 pass manually between two accounts.*
3. **M3 — Keyring + multi-key + unlock modal:** persistence, import/export blobs, key picker, `/enc`. *Exit: A2, B1, B2 pass.*
4. **M4 — Session model:** lockdown, timeout, lock-now hotkey, purge paths. *Exit: L1, L2, S3 pass.*
5. **M5 — Rich content:** route decrypted text through Discord's markdown parser (code blocks, emojis, spoilers, mentions, formatting). *Exit: R1 passes.*
6. **M6 — Encrypted attachments:** `.bpenc` format, upload interception, inline decrypted previews, blob lifecycle tied to session purge. *Exit: F1–F3 pass.*
7. **M7 — Polish:** settings panel, context menus, styling/theming, edit handling, error toasts, S2. *Exit: full acceptance table green.*
8. **M8 — Hardening & docs:** review for plaintext leaks (store mutation, logging, un-revoked blob URLs, disk cache), update-resilience notes (Webpack lookups by props not by mangled names), README with threat model + coverage matrix + ToS disclaimer.

**Worker ground rules:** TypeScript strict; no network calls of any kind; no eval; all Discord-internal lookups centralized in one `modules.ts` with feature-detection fallbacks; every patch registered through `Patcher` bound instance so `stop()` fully unpatches; plaintext must never touch `BdApi.Data`, localStorage, or the Flux store.

## 11. Key Risks

- **Discord internal churn:** webpack module shapes change with Discord updates — mitigate via prop-based lookups + a startup self-test that toasts "BetterPrivacy degraded" listing which patch failed instead of crashing.
- **Render-path variance:** message content, markdown parser, and attachment components differ across BD/Discord versions; M2/M5/M6 should validate against current stable BD (v1.13+).
- **Upload pipeline fragility:** `CloudUpload` internals are less stable than render components; keep a fallback path (manual "encrypt file → save → attach yourself" utility) if the intercept breaks.
- **Metadata leakage:** who/when/where, message length, attachment size, and keyId linkage remain visible to Discord. Document.
- **Memory pressure:** large decrypted media held as blobs — enforce the auto-download cap and LRU-evict decrypted blobs beyond a memory budget (default 200 MB).
- **ToS:** client modification risks account action. Prominent disclaimer required.

## 12. Discord Feature Coverage Matrix

| Feature | Coverage | How |
|---|---|---|
| Plain text, markdown (bold/italic/etc.) | ✅ Encrypted | Content string encrypted; decrypt → Discord markdown parser |
| Code (inline + fenced blocks, syntax highlight) | ✅ Encrypted | Same — parser renders it natively post-decrypt |
| Unicode emoji | ✅ Encrypted | Part of content string |
| Custom/animated emoji `<:n:id>` | ✅ Encrypted (display) | Syntax survives encryption; renders post-decrypt. Note: emoji usage isn't reported to server, so no server-side emoji stats |
| Spoilers, quotes, headings, lists | ✅ Encrypted | Parser handles post-decrypt |
| Mentions `@user @role #channel` | ✅ Encrypted (display only) | Render fine post-decrypt; **no notification fires** — server never saw the mention. Document loudly |
| Images / GIFs (uploads) | ✅ Encrypted | `.bpenc` + inline blob preview |
| Video / audio files | ✅ Encrypted | `.bpenc` + inline blob player |
| Any other file type | ✅ Encrypted | `.bpenc` + save-decrypted button, filename hidden |
| Replies / threads | ✅ Compatible | Reply metadata is server-side; the referenced content stays encrypted. Reply preview line shows ciphertext chip |
| Edits | ✅ Supported | Re-encrypt on edit; render layer re-parses on editTimestamp |
| Links | ✅ Encrypted | No server link preview (privacy win); optional client-side preview, default off |
| Stickers | ⚠️ Fallback | Server-side object; cannot carry ciphertext. Fallback: block sticker send while encrypt-mode ON (toast suggests custom emoji in text) |
| Native reactions | ❌ Not encryptable | Server-side counters. v1: leave as-is, document. v2 idea: encrypted "reaction" mini-messages rendered as overlay |
| Polls, forms, activities | ❌ Not encryptable | Fully server-side structures |
| Voice/video calls | ❌ Out of scope | Media pipeline, not chat |
| GIF picker / Tenor embeds | ⚠️ Fallback | Tenor is a URL fetched by Discord. Encrypt-mode ON: plugin downloads the GIF client-side and sends it as encrypted `.bpenc` upload instead |

