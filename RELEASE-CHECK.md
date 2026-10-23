# Release checklist

Run these checks against the exact commit and build intended for release.
BetterPrivacy's primary client is the Discord plugin; the web tools support
recipients on mobile or without the plugin.

## Automated checks

```sh
npm ci
npm run verify:release
```

The release command runs type checking, tests, and the production build. It also
checks site assets, local links, script syntax, version metadata, and that the
website download matches the plugin build.

Tests cover encryption and authentication, Unicode-safe message splitting,
plugin/web interoperability, key recovery, locking and cancellation, attachment
handling, and copy/share flows. They use WebCrypto, jsdom, and controlled Discord
API adapters—not a live Discord client or mobile browser.

## Manual checks

These require a current Discord client and real devices. Passing automated checks
does not complete this checklist.

- [ ] Install the release build on two Discord accounts. Exchange short and
  multipart messages, replies, images, and other files. Check Unicode and emoji.
- [ ] Open received content with the correct phrase. Confirm that an incorrect
  phrase reveals no plaintext.
- [ ] Switch sending keys, pause/resume encryption, lock keys, change channels,
  and disable/re-enable the plugin. Check indicators and decrypted previews.
- [ ] Change language and lockdown scope in plugin settings. Confirm dropdowns
  stay open and selections persist.
- [ ] Open a Discord-generated link on a phone. Create a multipart message on
  the website and open its links in Discord and the web reader, in order.
  Paste all links into the reader and confirm the joined text matches the draft.
  A malformed link or a part using a different phrase must reveal no combined text.
- [ ] Test per-part copying, bulk copying, clipboard fallback, and native mobile
  sharing. The secret phrase must not appear in the shared payload.
- [ ] Check the deployed `/`, `/create/`, `/m`, `/m/`, `/terms/`, and
  `/BetterPrivacy.plugin.js` routes over HTTPS. Redirects must preserve the URL
  fragment; the plugin download must serve JavaScript, not an HTML fallback.

## Distribution

- Plugin artifact: `dist/BetterPrivacy.plugin.js`
- Website root: `site/`, including the generated plugin download
- Message format: `v1`
- Attachment format: `BPENC1` with a 46-byte fixed prefix

Make the website and plugin download available before announcing the release so
recipients without the plugin can open shared links.
