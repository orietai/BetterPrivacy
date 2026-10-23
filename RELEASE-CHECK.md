# Release checklist

Run these checks against the exact commit and build intended for release.
BetterPrivacy's primary client is the Discord plugin; the web tools support
recipients on mobile or without the plugin.

## Automated checks

```sh
npm ci
npm run verify:release
npm audit
```

The release command runs type checking, tests, and the production build. It also
checks site assets, local links, script syntax, version metadata, and that the
website download matches the plugin build.

The full dependency audit must also be clean, including development tooling.
GitHub Actions runs this verification on main pushes and pull requests using
Node.js 24, read-only repository permissions, and no deployment credentials.
The shipped plugin and static pages do not load the npm test/build dependencies
at runtime, but contributors and release builders still execute those tools.

Tests cover encryption and authentication, Unicode-safe message splitting,
plugin/web interoperability, key recovery, locking and cancellation, attachment
handling, and copy/share flows. They use WebCrypto, jsdom, and controlled Discord
API adapters—not a live Discord client or mobile browser.

## Manual checks

These require a current Discord client and real devices. Passing automated checks
does not complete this checklist.

For the first live pass, prioritize: unlock an existing text and image, send and
edit a new message without changing channels, then lock while an unlock or file
download is pending. Confirm the indicators, previews, and settings survive a
plugin disable/enable cycle before proceeding with the full checklist below.

- [ ] Install the release build on two Discord accounts. Exchange short and
  multipart messages, replies, images, and other files. Check Unicode and emoji.
- [ ] Open received content with the correct phrase. Confirm that an incorrect
  phrase reveals no plaintext.
- [ ] Switch sending keys, pause/resume encryption, lock keys, change channels,
  and disable/re-enable the plugin. Check indicators and decrypted previews.
  With multiple saved keys, one phrase should open matching history keys in
  that channel without changing the sending key. Locking during the scan must
  cancel remaining attempts.
- [ ] Edit an encrypted message, including after changing the sending key or
  pausing encryption. The editor must start with decrypted text, not the URL,
  and save encrypted with its original key. Cancel or lock while editing:
  no changes may be sent, and a lock must clear the visible decrypted draft.
  The saved message must render without switching channels; verify the same
  link opens with the original phrase in the web reader.
  Oversized edits and unavailable original-message state must be blocked.
- [ ] Queue a file for an encrypted channel and focus another channel before
  upload. Verify encryption follows the queued destination. After an upload
  failure, lock keys or change the sending key before retrying: no retry may
  bypass those changes. Unknown destination metadata must block the upload.
- [ ] Change language and lockdown scope in plugin settings. Confirm dropdowns
  stay open and selections persist.
- [ ] Open a Discord-generated link on a phone. Create a multipart message on
  the website and open its links in Discord and the web reader, in order.
  Paste all links into the reader and confirm the joined text matches the draft.
  A malformed link or a part using a different phrase must reveal no combined text.
- [ ] Test per-part copying, bulk copying, clipboard fallback, and native mobile
  sharing. The secret phrase must not appear in the shared payload.
- [ ] Scan a short-message QR with a phone and open it using the phrase. Check
  the downloaded QR too. Editing the draft or starting over must remove the
  old QR; multipart results must retain their normal copy/share controls.
- [ ] Check the deployed `/`, `/create/`, `/m`, `/m/`, `/terms/`, and
  `/BetterPrivacy.plugin.js` routes over HTTPS. Redirects must preserve the URL
  fragment; the plugin download must serve JavaScript, not an HTML fallback.
  Confirm the host applies `site/_headers` (frame protection, no-referrer, and
  nosniff); a plain local file server does not apply Cloudflare header rules.

## Distribution

- Plugin artifact: `dist/BetterPrivacy.plugin.js`
- Website root: `site/`, including the generated plugin download
- Message format: `v1`
- Attachment format: `BPENC1` with a 46-byte fixed prefix

Make the website and plugin download available before announcing the release so
recipients without the plugin can open shared links.
