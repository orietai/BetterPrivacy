# Changelog

## 1.0.0 — Unreleased

First public release. No earlier BetterPrivacy version or format is supported.

### Encryption

- Preserve literal U+FEFF characters at independent plaintext-part boundaries.
- AES-256-GCM text encryption with PBKDF2-HMAC-SHA256 at 600,000 iterations.
- One message envelope: `🦇<https://betterprivacy.app/m#v1.<keyId>.<salt>.<iv>.<ciphertext>>`.
- One attachment container: `BPENC1`, with a 46-byte fixed prefix that includes the KDF salt.
- Phrase-only authenticated key recovery works for web-created messages, shared files and channel keys.
- Channel keys derive from the secret phrase and channel label. Key import/export supports sharing current key entries.
- Encrypted text is split into 1,360-byte UTF-8 parts that fit Discord's message limit.
- Parts are encrypted before sending, then sent sequentially. Large sends ask for confirmation.
- Decrypted content stays in memory; session locking purges cached plaintext and media URLs.

### Discord plugin

- Remove unused master-passphrase and link-preview settings; keep media limits in a collapsed settings section.
- Keyboard activation and visible focus for encrypted-message and attachment controls; channel key labels use readable names with distinct key IDs.
- Key import respects intervening locks and plugin shutdown before automatically unlocking; active-content attachments are downloaded with an inert MIME type.
- Ambiguous `/enc` labels and deleted sending keys require explicit selection instead of silently choosing another key.
- Cancel pending modal and attachment work on lock, stop, or channel changes; dismissing an unlock prompt no longer locks other readers of that key.
- Read password inputs at confirmation time and prevent cancelled operations from reopening keys or restoring decrypted previews.
- Intercept message edits, preserve historical encryption keys and block unsafe or oversized edits without a plaintext fallback.
- Open encrypted edits in a private plaintext editor instead of Discord's ciphertext URL draft; locking clears the draft without writing plaintext to message stores.
- Bind rendered edit caches to the exact ciphertext so optimistic edits cannot reuse old plaintext or stale authentication failures; cancelled unlocks are not reported as wrong phrases.
- Unlock received text against its actual authenticated envelope; repair inconsistent saved salt/check metadata only after fingerprint and payload verification, without changing the sending key.
- Resolve attachment destinations from queue metadata, never focus. Revalidate destination, lock state, mode and selected key for encrypted retries.
- Key Manager adapts to the settings panel width: compact stacked key details in narrow modals, wrapped identifiers and actions, and a wrapping toolbar.
- One 🦇 button for setting a phrase, unlocking, and pausing encryption.
- Visible per-channel sending key with an explicit picker; reading older messages never changes it.
- Reply-key actions select a key without sending a message; history can stay unlocked with multiple keys.
- Shared text/file key selection, cancelled-unlock protection, and no guessing between multiple keys.
- Language and relock-scope choices use BetterDiscord's own DropdownInput rather than native Electron select popups; chat-bar DOM fallback also starts when the webpack lookup is missing.
- Context actions for changing a phrase, forgetting a key, and locking all keys.
- Encrypted attachment upload and inline decrypted media.
- `/pt` overrides text only; attachments follow destination-channel mode. Missing upload hooks block normal file-selection/drop/paste flows while keys are configured.
- Locking invalidates pending unlocks and cancels remaining message parts/file uploads.
- Composer validation and paste-prompt patches let long encrypted text reach the splitter.
- Requires current BetterDiscord APIs, including `BdApi.Net.fetch` and `BdApi.Webpack.getWithKey`.
- Current-client DOM rendering paths, lazy-module retries, and visible integration health.
- English, Turkish, and Russian interfaces.

### Website

- Static-host frame, MIME, referrer and browser-permission restrictions; release verification checks the required header configuration.
- Reduced-motion reveal controls remain interactive; leaving the composer remasks phrases; native sharing handles unusual rejection values safely.
- Editing a file's phrase clears decrypted previews and invalidates pending decryption, including late failures.
- The web reader accepts multiple links and joins authenticated plaintext in pasted order using one phrase, with per-part errors and no partial result. It cannot infer missing parts or their intended order from v1 links.
- Long messages automatically split into numbered, independently readable v1 links, with per-part copy/open and ordered bulk copy/share. Unicode and whitespace survive unchanged; every link fits Discord's message limit.
- Shared button hierarchy across message creation, decryption and file download; responsive result actions and consistent phrase visibility controls.
- Restored EN/TR/RU landing-page language controls, including translated animated states and persistent language preference across tools.
- Official oriet.ai attribution and locally served logo with pointer-gated hover effects.
- Browser message creation at `/create/`, with copy and native sharing.
- Message opening at `/m#v1.…`, plus pasted-link and local `.bpenc` file opening.
- Shared mobile layouts and English, Turkish, and Russian language controls.
- Encryption/decryption runs locally. Payloads travel in URL fragments; phrases are not transmitted.
- No expiry or server-side deletion: retain the link and phrase to reopen a message.

### Development tooling

- Upgrade esbuild and Vitest and refresh transitive dependencies to clear the full npm security audit.
