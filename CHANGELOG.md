# Changelog

## 1.0.0 — 2026-07-19

First production release, following a three-track adversarial review (security/crypto, correctness, robustness/performance) with all verified findings fixed.

### Link wire format & web decrypt (pre-launch final — see PRE-LAUNCH-REVIEW.md)
- The wire format is a **real, clickable URL**: `🦇<https://betterprivacy.app/m#v1.<keyId>.<salt>.<iv>.<ct>>`. Discord renders it as a plain link (the `<>` wrapper suppresses the embed card); recipients without the plugin can click it.
- **Web decrypt page** at `betterprivacy.app/m`: the payload rides in the URL fragment (never sent to any server); the page derives the key from the secret phrase in the browser (same PBKDF2/AES-GCM as the plugin) and decrypts locally. Text messages only — `.bpenc` attachments still need the plugin.
- The KDF **salt is now a wire field**, so the web page (and future importers) re-derive the key from the phrase alone. The salt derives from public data; disclosure delta is nil.
- **All test-era formats deleted** — 1.0.0 launches with exactly one format, named `v1` publicly. Policy going forward: parse every released format forever, emit only the newest.

### One-button UX
- The chat bar now shows a single **🦇 button**: grey = not encrypted (click → set a secret phrase, which creates, unlocks, and arms the channel in one step), amber = phrase needed, green = encrypted (click to pause/resume), red = broken.
- Keys are **channel-bound and label-free** in the primary flow: the key derives from the phrase + channel, so peers just enter the same phrase in the same channel. Sharing = telling someone the phrase.
- Unknown-key chips ask for **just the phrase** ("Unlock encrypted message").
- Right-click the 🦇 for change-phrase / forget-key / lock-everything. Multi-key, custom labels, export blobs, and `/enc` remain available via Settings → Key Manager as power features.

### Security hardening
- Upload patch now **fails safe** when the current channel can't be resolved: with any keys in the keyring, the upload is blocked instead of passing through as plaintext.
- The `/pt` plaintext override is scoped to the sending channel (was a process-global flag with a cross-channel race window).
- `.bpenc` header validation rejects crafted containers (non-string filename/mime, impossible size claims) before allocation, so a malicious key-holding peer can't break recipients' rendering.
- Thread URLs resolve to the thread's channel id, closing a plaintext-send edge when the channel store is unavailable.
- Documented (README threat model): identical label + passphrase pairs derive identical keys globally — passphrases must be long **and** unique.

### Reliability
- **Lookup retry:** Discord internals that fail to resolve at startup (lazy-loaded chunks) are retried at 15 s / 45 s / 120 s, and recovered patches re-apply automatically with a toast.
- **Broken-state visibility:** if message interception is broken (e.g., after a Discord update), the chat-bar lock renders red with a PLAINTEXT warning and refuses to arm; the settings panel gained a persistent Health section.
- Toggling encrypt mode ON no longer leaves messages stuck on "Decrypting…".
- Plugin stop/restart fully restores attachment cards hidden by the DOM fallback; duplicate attachment mounts and post-eviction dead-end chips fixed.
- Decrypt cache: just-inserted entries can no longer self-evict; total entry cap (20 000) prevents unbounded growth in long sessions.
- Settings-panel key deletion now locks the session key and purges cached plaintext, matching what its confirmation dialog promises.
- Unlock modal can no longer leave a send hanging when closed mid-unlock.
- Chat-bar DOM fallback observer is rAF-debounced and can no longer double-mount controls.
- Messages beginning with `/enc…` that aren't the command (e.g. `/encyclopedia`) are no longer swallowed.

### Earlier milestones (0.1 → 0.2)
- AES-256-GCM message encryption (wire format finalized for release — see the link format above; test-era formats were removed before launch).
- Deterministic key derivation: **label + passphrase fully determine the key** — survives reinstalls; unknown-key messages recoverable in place.
- Encrypted attachments (`.bpenc`) with inline decrypted previews; CORS-proof CDN fetch via `BdApi.Net`.
- Lockdown & inactivity-timeout session model, per-channel encrypt mode with display gating, key picker + Key Manager UI, `/pt` & `/enc` overrides.
