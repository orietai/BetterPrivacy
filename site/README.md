# betterprivacy.app — landing page

Static, single-file site (`index.html`). No build step, no JS dependencies.
The only external request is Google Fonts (Geist / Geist Mono) — self-host the
two font files later if we want the page fully origin-contained.

## Preview

```bash
open site/index.html
```

## Deploy

Any static host (Cloudflare Pages, GitHub Pages, Netlify, plain nginx):

1. Serve this `site/` directory as the web root.
2. Copy the built plugin next to it so the download link resolves:

   ```bash
   npm run build
   cp dist/BetterPrivacy.plugin.js site/BetterPrivacy.plugin.js
   ```

   The install section and both CTAs link to `/BetterPrivacy.plugin.js`
   (same-origin download).
3. Point `betterprivacy.app` at the host.

## What's in the page

- **Two-column hero**: copy + at-a-glance facts on the left; on the right a
  **self-playing illustration** of the plugin — a scripted cursor clicks the
  🦇, types a phrase, the channel arms, the friend's message decrypts, a reply
  is typed, sent as ciphertext, and decrypts locally. Loops while on-screen;
  jumps straight to the decrypted end-state under `prefers-reduced-motion`.
- **Decryption lens** (hero background): a canvas field of dim ciphertext
  glyphs; inside the cursor's radius the noise resolves into a readable hidden
  sentence in green. Idles on a slow drift when there's no pointer. Static
  texture under `prefers-reduced-motion`; renders only while the hero is
  on-screen.
- **Redaction wipe** on the headline's key phrase; decoding mono status line;
  ciphertext marquee band.
- All motion is gated behind `prefers-reduced-motion`; transitions name exact
  properties and use strong custom easing curves.

## The decrypt page (`m/index.html`)

Served at `betterprivacy.app/m`. Every encrypted message is a link here with
the payload in the URL **fragment** (`#v1.<keyId>.<salt>.<iv>.<ct>`), which
browsers never send to servers. The page mirrors the plugin's crypto exactly
(PBKDF2-HMAC-SHA256 ×600,000 → AES-256-GCM via WebCrypto) and decrypts
entirely client-side after the visitor types the secret phrase. Text
messages only; `.bpenc` attachments still require the plugin.

Keep the wire-format strings (demo, marquee, this page's fragment regex) in
sync with `src/crypto/wire.ts` if the format ever changes.
