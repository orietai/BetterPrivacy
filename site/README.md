# betterprivacy.app

Static website and browser message tools. Serve `site/` as the web root;
there is no frontend framework or backend.

## Preview and prepare

```sh
npm run build:site
python3 -m http.server 4173 --directory site --bind 127.0.0.1
```

Open http://localhost:4173. Use localhost or HTTPS: WebCrypto is unavailable
on an ordinary HTTP LAN address. Open through a local server rather than
`file://`, because shared assets use root-relative paths.

`build:site` builds the plugin and copies it to
`site/BetterPrivacy.plugin.js` for the download button. That generated file
is ignored by Git.

## Cloudflare Workers Builds

Connect the repository with the repository root as the root directory and
`main` as the production branch. The root `wrangler.jsonc` serves `site/` as
static assets; no Worker application entry point is required.

- Build command: `npm run build:site`
- Deploy command: `npx wrangler deploy`
- Preview command: `npx wrangler preview`

Use Node.js 24 for builds. The Worker name must match `betterprivacy` in
`wrangler.jsonc`. Configure the custom domain in Cloudflare after deployment.

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Introduction, interactive illustration, web/plugin paths, installation and FAQ |
| `/create/` | Write text, choose a phrase, encrypt and copy/share a message link |
| `/m#v1.…` | Existing public message links: enter a phrase and open |
| `/m/` | Paste a received link, or choose a local `.bpenc` file |
| `/terms/` | Existing translated terms |

Preserve `/m` with or without a trailing slash, including its fragment.
Directory-index redirects must retain fragments. Do not rewrite tool routes
to the landing page. Any static host with directory indexes can serve this
folder; a redirect from `/m` to `/m/` is fine if it keeps the fragment.

## UX pass

The landing page leads with the desktop Discord plugin. Browser creation and
opening support mobile users and recipients without the plugin. A two-column hero keeps the
product illustration beside the explanation. The original animated Discord
demo, cursor decryption lens, scroll reveals and headline redaction are retained.
Reduced-motion preferences show a static readable state. The statement reveal
also has a keyboard-accessible button instead of depending on hover alone.

Create and Open share navigation, language controls, typography, form controls,
and dark reading surfaces in the landing page's black/green palette. On phones the introduction
moves above the form. Buttons have visible keyboard focus; errors appear next
to the action with live status announcements. Clipboard denial selects the
link for manual copying. Native sharing is offered when supported.

The reader keeps existing message and file flows. Its empty state now accepts
a pasted link. A recipient can create a reply without returning to the landing
page. The reader clears the phrase after successful decryption and offers a
Hide message action.

## Message compatibility

No wire-format, KDF, or container changes. New web messages use the published:

```text
https://betterprivacy.app/m#v1.<keyId>.<salt>.<iv>.<ciphertext>
```

PBKDF2-HMAC-SHA256 at 600,000 iterations derives an AES-256-GCM key.
The key fingerprint remains the first six bytes of SHA-256(key material).
The web composer generates a random 16-byte salt and 12-byte IV for each message;
the salt is carried by the existing v1 envelope, so recipients need only the
link and phrase. Keys are non-extractable and raw key buffers are cleared.

One web message is limited to 1,360 UTF-8 bytes, matching the plugin's chunk
budget, so the complete link fits Discord's 2,000-character message ceiling.
This first web composer creates text messages, not encrypted files.
The reader still opens plugin-created `.bpenc` files. The plugin can recover
web-created or shared keys from the v1 salt and phrase after authenticating the
message/container. Recipients never need to reconstruct the sender's key label.

No message, phrase, or generated link is saved to localStorage. Only the
EN/TR/RU language preference (`bp-lang`) persists. The encrypted payload is in
the URL fragment, not a query string. There are no external fonts, analytics,
or third-party scripts. Links are not revocable and do not expire.

## Verification

```sh
npm test
npm run typecheck
npm run build:site
```

- `tests/createPageFlow.test.ts` executes the shipped composer and reader:
  web → plugin crypto and web → web roundtrips, randomness, UTF-8 limits,
  edit-during-encryption races, native sharing, manual clipboard fallback,
  pasted link validation, EN/TR/RU, and no secret persistence.
- `tests/webPageFlow.test.ts` covers existing message and `.bpenc` UI flows.
- `tests/webPageParity.test.ts` runs the reader's actual crypto functions
  against plugin-produced messages and containers.
- `tests/pluginFlows.test.ts` drives the real send/upload patches with controlled
  Discord adapters: long-message ordering, failed parts, lock cancellation,
  authenticated recovery, file retries and blocked uploads when hooks are missing.

These tests use jsdom and WebCrypto. They validate interactions and format
compatibility, not browser rendering or iOS/Android native share sheets.
