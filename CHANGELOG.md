# Changelog

## 1.0.0 — Unreleased

First public release. No earlier BetterPrivacy version or format is supported.

### Encryption

- AES-256-GCM text encryption with PBKDF2-HMAC-SHA256 at 600,000 iterations.
- One message envelope: `🦇<https://betterprivacy.app/m#v1.<keyId>.<salt>.<iv>.<ciphertext>>`.
- One attachment container: `BPENC1`, with a 46-byte fixed prefix that includes the KDF salt.
- Phrase-only authenticated key recovery works for web-created messages, shared files and channel keys.
- Channel keys derive from the secret phrase and channel label. Key import/export supports sharing current key entries.
- Encrypted text is split into 1,360-byte UTF-8 parts that fit Discord's message limit.
- Parts are encrypted before sending, then sent sequentially. Large sends ask for confirmation.
- Decrypted content stays in memory; session locking purges cached plaintext and media URLs.

### Discord plugin

- One 🦇 button for setting a phrase, unlocking, and pausing encryption.
- Visible per-channel sending key with an explicit picker; reading older messages never changes it.
- Reply-key actions select a key without sending a message; history can stay unlocked with multiple keys.
- Shared text/file key selection, cancelled-unlock protection, and no guessing between multiple keys.
- Direct language choices instead of native popup menus; chat-bar DOM fallback also starts when the webpack lookup is missing.
- Context actions for changing a phrase, forgetting a key, and locking all keys.
- Encrypted attachment upload and inline decrypted media.
- `/pt` overrides text only; attachments follow channel mode. Missing upload hooks block normal file-selection/drop/paste flows while encryption is armed.
- Locking invalidates pending unlocks and cancels remaining message parts/file uploads.
- Composer validation and paste-prompt patches let long encrypted text reach the splitter.
- Requires current BetterDiscord APIs, including `BdApi.Net.fetch` and `BdApi.Webpack.getWithKey`.
- Current-client DOM rendering paths, lazy-module retries, and visible integration health.
- English, Turkish, and Russian interfaces.

### Website

- Official oriet.ai attribution and locally served logo with pointer-gated hover effects.

- Browser message creation at `/create/`, with copy and native sharing.
- Message opening at `/m#v1.…`, plus pasted-link and local `.bpenc` file opening.
- Shared mobile layouts and English, Turkish, and Russian language controls.
- Encryption/decryption runs locally. Payloads travel in URL fragments; phrases are not transmitted.
- No expiry or server-side deletion: retain the link and phrase to reopen a message.
