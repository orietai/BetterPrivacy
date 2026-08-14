# 🦇 BetterPrivacy

A BetterDiscord plugin that adds **client-side end-to-end encryption** to Discord chats, channels, and DMs. Messages are encrypted before they leave your client and decrypted only on render, so Discord's servers see only ciphertext. No external servers, no backend — all crypto happens locally using WebCrypto.

---

## Table of Contents

- [What It Is](#what-it-is)
- [Installation](#installation)
- [Quick Start: Usage Walkthrough](#quick-start-usage-walkthrough)
- [Features & Coverage Matrix](#features--coverage-matrix)
- [Threat Model & Security](#threat-model--security)
- [Important Caveats](#important-caveats)
- [FAQ](#faq)
- [License](#license)

---

## What It Is

**BetterPrivacy** encrypts your Discord messages client-side using pre-shared passphrases. Each message is encrypted with AES-256-GCM before sending; recipients decrypt only if they have the key.

### Core behaviors

- **Multiple independent keys:** use different passphrases in different channels or even within the same channel.
- **Recipient filtering:** only users with the key can read encrypted messages; others see raw ciphertext.
- **Visual distinction:** decrypted messages are highlighted (colored text + lock-open icon) so you always know what's encrypted.
- **Rich content:** encrypted messages support all Discord text formatting — **bold**, `code`, spoiler tags, custom emoji, mentions (as text), links, and more. Code blocks render with syntax highlighting.
- **Encrypted files:** images, videos, audio, and any file attachment can be encrypted and uploaded as `.bpenc` blobs. Recipients see inline previews (images/video) or a download button.
- **Two locking modes:**
  - **Timeout mode (default):** keys stay unlocked across channel switches until an inactivity timer expires (default 3 hours).
  - **Lockdown mode (opt-in):** switching channels or DMs re-locks everything; you must re-enter your passphrase for each space. For maximum paranoia.

---

## Installation

### Build

```bash
npm run build
```

This creates a distributable bundle at **`dist/BetterPrivacy.plugin.js`**.

### Deploy to BetterDiscord

1. Locate your BetterDiscord plugins folder:
   - **Windows:** `%APPDATA%\BetterDiscord\plugins\`
   - **macOS:** `~/Library/Application Support/BetterDiscord/plugins/`
   - **Linux:** `~/.config/BetterDiscord/plugins/`

2. Copy **`dist/BetterPrivacy.plugin.js`** into the plugins folder.

3. Open Discord, go to **Settings → BetterDiscord → Plugins**, and toggle **BetterPrivacy** ON.

---

## Quick Start: Usage Walkthrough

Everything runs through **one button**: the 🦇 in the chat bar.

| 🦇 color | Meaning | Click does |
|---|---|---|
| Grey | Channel not encrypted | Set a secret phrase (one field — done) |
| Green | Encrypted & unlocked | Pause encryption |
| Amber | Phrase needed (locked) | Enter the phrase |
| Red | Broken by a Discord update | Nothing sends encrypted — wait for a plugin update |

### 1. Encrypt a Channel

1. Open the channel or DM, click the **🦇** in the chat bar.
2. Enter a **secret phrase** (long and unique — it's the entire protection).
3. Done. The channel is armed: your next message already goes out encrypted, and you see it as green text with a 🦇 marker. Everyone else sees ciphertext.

**The phrase is never stored** and there is nothing else to manage: the key derives from the phrase + the channel itself, so the same phrase in the same channel always yields the same key — after reinstalls, on other machines, for your peers.

### 2. Let Others Read

Tell them the phrase — **outside Discord** (in person, or over any encrypted messenger). They click the 🦇 in the same channel (or click any `🔒 Encrypted message — click to recover` chip), type the same phrase, and everything decrypts. That's the whole exchange.

### 3. Lock & Unlock

- Keys stay unlocked while you're active; after 3 hours idle (configurable) everything re-locks.
- **Ctrl+Shift+L** (or right-click the 🦇 → "Lock everything now") locks instantly.
- When locked, messages show as chips; click the 🦇 (or a chip) and re-enter the phrase.

### 4. Right-Click the 🦇 for the Rare Stuff

Change phrase, forget this channel's key, lock everything. Power features — multiple keys per channel with custom labels, key export/import blobs, `/enc <label> <msg>` — live in **Settings → BetterPrivacy** and stay out of the way.

### 5. Slash Command Overrides

**`/pt <message>`** — Send this message as **plaintext only once**, even if encrypt mode is ON:

```
/pt This is a public message
```

**`/enc <key-label> <message>`** — Encrypt this message with a specific key (ignoring the active key picker):

```
/enc Friends This message goes to friends only
```

### 6. Lockdown vs Timeout Modes

#### Lockdown OFF (default)

Keys stay unlocked as you move between channels. After **3 hours of inactivity** (configurable 5 min–24 hr, or never), the plugin purges all unlocked keys from memory and re-locks everything. **Ctrl+Shift+L** locks everything instantly at any time.

**Use case:** everyday use on a device you trust.

#### Lockdown ON (opt-in)

When you switch to a different channel or DM, all decrypted messages **immediately re-lock** and show as ciphertext chips. You must re-unlock the key in the new channel.

**Use case:** maximum privacy; you never accidentally leave decrypted messages visible when you step away.

Toggle in **Settings** → **BetterPrivacy** → **Lockdown mode**.

### 7. Channel-Specific Settings

- **Chat bar:** the lock button and key dropdown are per-channel. Encrypt mode + active key are remembered.
- **Context menu:** right-click a channel to set a default encryption key for that channel (future messages default to that key).

---

## Features & Coverage Matrix

| Feature | Status | Notes |
|---------|--------|-------|
| **Plain text & markdown** | ✅ Full | Bold, italic, underline, strikethrough, inline code all encrypted & rendered post-decrypt |
| **Code blocks (fenced + syntax highlight)** | ✅ Full | Highlighted exactly as native Discord would render it |
| **Unicode emoji** | ✅ Full | Part of plaintext, encrypted |
| **Custom/animated emoji** | ✅ Full | Syntax `<:name:id>` encrypted; renders post-decrypt. No server emoji stats sent |
| **Spoiler tags** (`\|\|...\|\|`) | ✅ Full | Encrypted; render as native spoiler post-decrypt |
| **Headings, blockquotes, lists** | ✅ Full | Encrypted & render post-decrypt |
| **Mentions** (@user, @role, #channel) | ✅ Display only | Render fine; **no notifications sent** (server never saw the mention) |
| **Links** | ✅ Full | Encrypted; Discord's server-side link previews don't fire (privacy win) |
| **Images & GIFs** | ✅ Full | Uploaded as `.bpenc`; recipients see inline preview when unlocked |
| **Video & audio files** | ✅ Full | `.bpenc` + inline player when unlocked |
| **Any other file type** | ✅ Full | `.bpenc`; decrypt to download with true filename restored |
| **Message edits** | ✅ Full | Re-encrypt on edit; render layer re-parses on editTimestamp |
| **Replies & threads** | ✅ Compatible | Reply metadata is server-side; reply preview shows ciphertext chip. Referenced content stays encrypted |
| **Stickers** | ⚠️ Blocked | Server-side object; cannot encrypt. Encrypt mode ON: plugin blocks sticker send; use custom emoji text instead |
| **Reactions** | ❌ Not supported | Server-side counters; cannot carry ciphertext. Workaround: post encrypted "reaction" as a message |
| **Polls & forms** | ❌ Not supported | Fully server-side structures |
| **Voice/video calls** | ❌ Out of scope | Not a chat feature |
| **GIF picker (Tenor)** | ⚠️ Fallback | Download client-side & send as encrypted `.bpenc` instead of linking server-side |

---

## Threat Model & Security

### What It Protects

- **Discord servers see only ciphertext.** They cannot read your message content, file contents, or metadata like formatting.
- **Passive network observers see only ciphertext.** ISPs, WiFi networks, VPNs, etc., see encrypted blobs.
- **Unauthorized recipients see only ciphertext.** Without the passphrase, they cannot decrypt.

### What It Does NOT Protect

#### Encryption Design

- **Passphrase-based symmetric E2E.** No forward secrecy or message ratcheting — if your passphrase is compromised, all past and future messages encrypted with it are at risk.
- **No automatic key exchange.** You must share passphrases out-of-band, which is friction but more secure than auto-negotiation.
- **Deterministic key derivation.** The KDF salt is derived from the key's label (not random), which is what makes "label + passphrase recreates the key anywhere" possible. The trade-off: an attacker who guesses the label can precompute a cracking dictionary for it, so **the passphrase's strength is your entire defense**. A second consequence: **two completely unrelated users who happen to pick the same label + passphrase derive the *identical* key** — no cracking involved. Each can silently decrypt the other's messages, and because the key ID (a public fingerprint of the key) is embedded in every message, it also links those otherwise-unrelated communities as sharing a passphrase. Passphrases must therefore be long **and** unique — a common label (like "friends") combined with a common passphrase is effectively a public key. (The 600,000-round PBKDF2 cost still applies to every *guess*, but no guessing is needed when the pair collides outright.)
- **Messages advertise the plugin.** Every encrypted message is a 🦇-branded link — `🦇<https://betterprivacy.app/m#v1.…>` — that anyone can click: the decrypt page reads the payload from the URL fragment (never sent to any server) and unlocks it in the browser once the phrase is entered. This is by design and also means Discord can trivially detect that you send encrypted messages (the *fact* of encryption was never hidden — ciphertext is obvious regardless). The KDF salt rides in the link; it derives from public data, so this discloses nothing new.

#### Metadata

**Discord and any passive observer still see:**

- **Who** messages whom (sender/recipient, channel/DM structure).
- **When** messages are sent (server timestamp).
- **Where** messages are sent (channel/DM identifiers).
- **Message length** (ciphertext is slightly longer than plaintext due to IV + auth tag, ~33% overhead).
- **Key ID** (first 6 bytes of the key fingerprint, embedded in each message). The same key ID reveals that two messages use the same key.
- **Attachment filenames are hidden** (encrypted as `.bpenc`), but file size is visible.
- **Edits, deletions, reactions** — the fact of these actions is visible, even if the content is encrypted.

#### Client-Side Risks

- **No plaintext hygiene outside BetterPrivacy.** If Discord crashes with decrypted plaintext in memory, or if another browser extension or malware reads your memory, encrypted messages are exposed.
- **No memory scrubbing.** Derived keys and plaintext stay in memory while unlocked; they're not overwritten with zeros on re-lock (runtime unpredictability).
- **Blobs leak to the page.** Decrypted images and media are held as `blob:` URLs in the cache; if you screenshot or screen-record, plaintext is captured.

### The Big One: Discord ToS

> **Modifying the Discord client with BetterDiscord violates Discord's Terms of Service.** Discord does not permit client modification; using BetterDiscord or plugins risks your account being suspended or permanently banned. Use at your own risk.

See [Discord ToS § 2.c](https://discord.com/terms) ("You agree not to…use…cheats, automated tools, or any other unauthorized software") and [BetterDiscord's own disclaimer](https://betterdiscord.app/).

**This plugin is for educational and personal use only.** Do not use it on accounts you cannot afford to lose.

---

## Important Caveats

### Mentions Don't Notify

Encrypted mentions (`<@user>` or `<@&role>` or `<#channel>`) render correctly but **never trigger server-side notifications**. Discord's server saw only ciphertext, so it has no way to know a mention happened. Recipients must check the channel manually.

### Links Don't Preview

Server-side link preview embeds don't fire for encrypted messages (a privacy win). If you want client-side previews anyway, enable **Settings** → **BetterPrivacy** → **Client-side link previews** (experimental, may leak URLs to the target site).

### Files Auto-Download Cap

Encrypted files larger than **25 MB** (configurable) won't auto-download. Recipients see a "Save decrypted file" button instead, to prevent memory exhaustion.

### Memory Budget

Decrypted media (images, video) is cached as blob URLs. Once the total size exceeds **200 MB** (configurable), the oldest blobs are evicted.

### Plaintext Never Touches BdApi.Data

To prevent accidental plaintext persistence, the plugin is designed never to store decrypted messages, keys, or passphrases in `BdApi.Data` (Discord's storage) or localStorage. Keyring metadata (salt, label, key ID) *is* stored, but not the passphrase or derived key.

### Update Resilience

BetterPrivacy uses Discord's webpack module lookups to find internal components. Discord updates frequently; if a lookup fails, the plugin toasts a warning listing which patch is broken and degrades gracefully (e.g., if the render patch fails, you see ciphertext; if send fails, encryption is skipped with a warning). **Always update BetterPrivacy after a Discord update.**

---

## FAQ

**Q: How do I export/back up my keys?**

A: You don't need to — **the label + passphrase pair is the complete backup.** Re-creating a key with the same label and passphrase always reproduces the identical key. The Key Manager's **Export** blob still exists as an alternative sharing mechanism.

**Q: Can I use the same passphrase in multiple keys?**

A: Yes, but **don't.** Each key is derived independently; using the same passphrase in multiple keys defeats the purpose of key scoping. Use different passphrases per key.

**Q: What if I forget my passphrase?**

A: **It's gone.** The plugin stores only a key-check value, never the passphrase. Passphrases cannot be reset or recovered. Delete the key and create a new one, then share the new label + passphrase with your peers.

**Q: Can I use this in voice/video calls?**

A: No. The plugin only encrypts chat messages and file attachments. Audio/video streams are not covered.

**Q: Does this work in group DMs?**

A: Yes, the same way as channels. All group members must have the key to decrypt.

**Q: What if my Discord account is hacked?**

A: The attacker can read any currently unlocked keys and decrypt past messages they send as you. **Immediately lock all keys** (Ctrl+Shift+L) and change your Discord password. Rotate passphrases for frequently-used keys if you suspect compromise.

**Q: Does BetterPrivacy work on mobile Discord?**

A: No. BetterDiscord (and thus BetterPrivacy) is a desktop client modification only.

**Q: Can I encrypt reactions or polls?**

A: No. These are server-side Discord objects. The plugin blocks them while encrypt mode is ON and suggests using encrypted text messages instead.

**Q: How large can encrypted files be?**

A: Up to your Discord upload limit (typically 10 MB free, 50 MB+ with Nitro). Files are encrypted in 8 MB chunks to avoid blocking the renderer.

**Q: Is my keyring encrypted at rest?**

A: By default, no. Keyring metadata (salt, label, key ID, scope) is stored plaintext in `BdApi.Data`. Toggle **Master passphrase** in settings to encrypt the entire keyring JSON (optional).

---

## License

[MIT](./LICENSE) — the plugin, the website, and the decrypt page (`site/`) alike.

---

## Need Help?

- Read the [Build Spec](./BetterPrivacy-Build-Spec.md) for technical details.
- Check for Discord/BetterDiscord updates if you see "BetterPrivacy degraded" toasts.
- Report issues on the project repository.

---

**Remember:** This plugin is for educational and personal use. **Modifying the Discord client violates Discord's ToS. Use at your own risk.**

Happy encrypting.
