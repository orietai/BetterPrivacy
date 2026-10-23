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
- **Long messages split themselves:** ciphertext is bigger than plaintext, so a long message no longer fits one Discord message. The plugin splits it into several encrypted parts and sends them in order — you just type and hit enter.
- **Encrypted files:** images, videos, audio, and any file attachment can be encrypted and uploaded as `.bpenc` blobs. Recipients see inline previews (images/video) or a download button.
- **Three languages:** the plugin's own buttons, menus, toasts and settings speak **English, Turkish and Russian**, following Discord's own language setting by default.
- **Two locking modes:**
  - **Timeout mode (default):** keys stay unlocked across channel switches until an inactivity timer expires (default 3 hours).
  - **Lockdown mode (opt-in):** switching channels or DMs re-locks everything; you must re-enter your passphrase for each space. For maximum paranoia.

---

## Installation

### Build

Clone the repository and use a current Node.js LTS release (Node.js 24 recommended):

```bash
git clone https://github.com/orietai/BetterPrivacy.git
cd BetterPrivacy
npm ci
npm run build
```

This creates a distributable bundle at **`dist/BetterPrivacy.plugin.js`**.

Before publishing the plugin and website together, run `npm run verify:release`.
See [RELEASE-CHECK.md](RELEASE-CHECK.md) for verified flows and the remaining live-device checks.

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

**Peers without the plugin** aren't locked out either. Every encrypted message is a clickable 🦇 link to **betterprivacy.app/m**, where the same phrase decrypts it in their browser. That page also takes **files**: they download the `.bpenc` attachment from Discord, drop it on the page, type the phrase, and get an inline preview (image/video/audio) plus a download link with the real filename. Nothing is uploaded — the message payload rides in the URL fragment (which browsers never send to a server) and the file is read locally.

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

This overrides **text only**. Attachments still follow the channel's encryption mode.
To send an unencrypted file, explicitly pause encryption first.

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

- **Chat bar:** the single 🦇 button controls the current channel. Encrypt mode and active key are remembered; right-click for more options.
- **Context menu:** right-click a channel to set a default encryption key for that channel (future messages default to that key).

### 8. Long Messages

Nothing to do — type as much as you like and press enter. If the plaintext doesn't fit one encrypted message, the plugin splits it (preferring a break after a space or newline, so parts don't cut mid-word), toasts *"🦇 Long message — sending encrypted in N parts"*, and sends the parts **in order**, each one waiting for the previous to land. Recipients simply see N consecutive decrypted messages.

The budget is **1360 UTF-8 bytes of plaintext per part** — plain English text runs ~1360 characters per part, Turkish/Russian/CJK fewer, since those characters cost 2–4 bytes each. There is **no part limit**: the plugin splits into as many parts as the text needs. Past **10 parts** it asks once ("this will be N separate messages — send them all?") so a huge accidental paste can't fire off a wall of messages; decline and nothing is sent.

Discord normally refuses to *send* past 2000 characters (4000 with Nitro), and turns a paste bigger than that into a `message.txt` file — either one would stop long text from ever reaching the splitter. So while a channel's encryption is **ON**, the plugin lets the chat box send the whole thing, and keeps a big paste as text in the composer instead of converting it to a file. Discord's own character counter may still show you over the limit; the send goes through anyway. Turn encryption off and Discord's limits are back, unchanged. If a Discord update moves the internals the plugin patches for this, it falls back to the native behaviour: sending, splitting and encryption keep working, you just can't send past 2000/4000 characters in one go (and a big paste becomes a file again — still encrypted, as `.bpenc`).

### 9. Language

**Settings → BetterPrivacy → Language** picks the language of the plugin's own UI: **Auto (follow Discord)**, English, Türkçe, or Русский. The default is **Auto**, which takes the language you selected in Discord itself, falls back to your browser/system language, and finally to English. Changing it applies immediately, including to chips and menus already on screen.

Only BetterPrivacy's own strings are translated — Discord's UI, your messages, and the plugin's console logs (which exist for bug reports) are untouched.

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
| **Long messages** | ✅ Full | Composer limit raised while encrypted; auto-split into as many encrypted parts as needed (1360 UTF-8 plaintext bytes each), sent in order; every part decrypts on its own |
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
| **Plugin UI language** | ✅ Full | English · Türkçe · Русский, following Discord's language by default (Settings → BetterPrivacy → Language) |
| **Reading without the plugin** | ✅ Full | `betterprivacy.app/m` decrypts both linked messages and downloaded `.bpenc` files, entirely in the browser |

---

## Threat Model & Security

### What It Protects

- **Discord servers see only ciphertext.** They cannot read your message content, file contents, or metadata like formatting.
- **Passive network observers see only ciphertext.** ISPs, WiFi networks, VPNs, etc., see encrypted blobs.
- **Unauthorized recipients see only ciphertext.** Without the passphrase, they cannot decrypt.

### What It Does NOT Protect

#### Encryption Design

- **Passphrase-based symmetric E2E.** No forward secrecy or message ratcheting — if your passphrase is compromised, all past and future messages encrypted with it are at risk.
- **No automatic key exchange.** Share the phrase through a separate private channel.
- **Deterministic key derivation.** The KDF salt is derived from the key's label (not random), which is what makes "label + passphrase recreates the key anywhere" possible. The trade-off: an attacker who guesses the label can precompute a cracking dictionary for it, so **the passphrase's strength is your entire defense**. A second consequence: **two completely unrelated users who happen to pick the same label + passphrase derive the *identical* key** — no cracking involved. Each can silently decrypt the other's messages, and because the key ID (a public fingerprint of the key) is embedded in every message, it also links those otherwise-unrelated communities as sharing a passphrase. Passphrases must therefore be long **and** unique — a common label (like "friends") combined with a common passphrase is effectively a public key. (The 600,000-round PBKDF2 cost still applies to every *guess*, but no guessing is needed when the pair collides outright.)
- **Messages advertise the plugin.** Every encrypted message is a 🦇-branded link — `🦇<https://betterprivacy.app/m#v1.<keyId>.<salt>.<iv>.<ciphertext>>` — that anyone can click: the decrypt page reads the payload from the URL fragment (never sent to any server) and unlocks it in the browser once the phrase is entered. This is by design and also means Discord can trivially detect that you send encrypted messages (the *fact* of encryption was never hidden — ciphertext is obvious regardless). The KDF salt rides in the link; it derives from public data, so this discloses nothing new.
- **Encrypted files carry a small plaintext header.** The `.bpenc` container is:

  ```
  bytes 0–5   : magic "BPENC1"
  bytes 6–13  : key ID (8 ASCII chars, base64url)
  bytes 14–29 : KDF salt (16 raw bytes)
  bytes 30–41 : header IV (12 random bytes)
  bytes 42–45 : uint32 BE — encrypted-header length
  bytes 46–…  : AES-GCM(header JSON: filename, mime, size, sha256, chunks)
  remainder   : the file itself in 8 MB AES-GCM chunks, each with its own tag
  ```

  Only the first 46 bytes are readable: magic, key ID and salt. **The real filename, mime type and size are inside the encrypted header**, and the plaintext's SHA-256 is verified after decryption. The salt is there for the same reason it rides in the message link — it is key-derivation metadata derived from public data, not a secret — and carrying it is what lets `betterprivacy.app/m` decrypt a downloaded `.bpenc` from the phrase alone, with no knowledge of the channel or key label.

#### Metadata

**Discord and any passive observer still see:**

- **Who** messages whom (sender/recipient, channel/DM structure).
- **When** messages are sent (server timestamp).
- **Where** messages are sent (channel/DM identifiers).
- **Message length** (ciphertext is slightly longer than plaintext due to IV + auth tag, ~33% overhead) — and, for a long message, **how many parts** it was split into.
- **Key ID** (first 6 bytes of the key fingerprint, embedded in each message and in every `.bpenc` header). The same key ID reveals that two messages, or a message and a file, use the same key.
- **The KDF salt**, which rides in the clear in both the message link and the `.bpenc` header. It derives from public data (see above), but it does identify which key's derivation a message or file belongs to.
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

### Long Messages Arrive as Several Messages

A long message becomes **N real Discord messages**, not one. Consequences worth knowing:

- Each part is an independent encrypted message: recipients can decrypt any part on its own, and deleting or editing one part doesn't affect the others.
- **A missing part is silently missing.** Parts carry no "3 of 5" marker, so if one is deleted (by you, a moderator, or AutoMod) the remaining text just reads as if the gap were never there. Re-send if it matters.
- Only the **first** part inherits the original send — a reply reference attaches to part 1; the follow-ups are plain messages in the channel.
- If a part fails to send (network, slowmode, AutoMod), the remaining parts are **cancelled** with a toast naming which part died. The parts already sent stay up; nothing falls back to plaintext.
- There is **no cap on parts**, but past **10** the plugin asks for confirmation before sending anything. Sends stay sequential — each part waits for the previous one — which is also what keeps a long send from tripping Discord's rate limits.
- The composer accepts far more than Discord's usual 2000/4000 characters **while the channel's encryption is ON** — that raise is what lets long text reach the splitter at all. With encryption off, Discord's native limit applies as normal; and if a Discord update hides the module the plugin patches for this, typing quietly falls back to the native cap (everything else keeps working).

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

A: The plugin runs only in desktop Discord. On mobile, open a shared message link in your browser and enter the phrase, or create a message at [betterprivacy.app/create/](https://betterprivacy.app/create/) and share its link back to Discord.

**Q: Can I encrypt reactions or polls?**

A: No. These are server-side Discord objects. The plugin blocks them while encrypt mode is ON and suggests using encrypted text messages instead.

**Q: Is there a maximum message length?**

A: No. While the channel is encrypted the plugin raises the composer's limit, then splits anything longer than one encrypted message (1360 UTF-8 bytes of plaintext) into as many parts as it takes, sent in order. Sends needing more than 10 parts ask for one confirmation first; decline and nothing is sent.

**Q: Can someone read my encrypted messages or files without installing the plugin?**

A: Yes, if they have the phrase. Every encrypted message is a link to `betterprivacy.app/m`, which decrypts it in their browser; downloaded `.bpenc` attachments can be dropped onto that same page. The page is static, has no backend, and does all the crypto locally — the payload never leaves their machine.

**Q: Can I change the plugin's language?**

A: **Settings → BetterPrivacy → Language** — Auto (follow Discord), English, Türkçe or Русский. Auto uses your Discord language, then your browser/system language, then English.

**Q: How large can encrypted files be?**

A: The plugin caps plaintext files at 64 MiB; Discord's account upload limit also applies, including encryption overhead. Files use independently authenticated 8 MiB chunks.

**Q: Is my keyring encrypted at rest?**

A: Keyring metadata (salt, label, key ID, scope) is stored unencrypted in `BdApi.Data`. Secret phrases and derived keys are not persisted. Master-passphrase protection is not available in this version.

---

## License

[MIT](./LICENSE) — the plugin, the website, and the decrypt page (`site/`) alike.

---

## Need Help?

- Read the [v1 protocol contract](./PRE-LAUNCH-REVIEW.md) for message and attachment format details.
- Check for Discord/BetterDiscord updates if you see "BetterPrivacy degraded" toasts.
- Report reproducible bugs in [GitHub Issues](https://github.com/orietai/BetterPrivacy/issues). Do not include secret phrases or private messages.

## Contributing and security

Source code, website and tests are published under the MIT license. See
[CONTRIBUTING.md](./CONTRIBUTING.md) for setup and pull requests, and
[SECURITY.md](./SECURITY.md) for responsible vulnerability reporting.
The project has not undergone an independent security audit.

---

**Remember:** This plugin is for educational and personal use. **Modifying the Discord client violates Discord's ToS. Use at your own risk.**

Happy encrypting.
