# First public release contract — 1.0.0

BetterPrivacy has no previous public release. Development messages, containers,
client workarounds, and draft versions are not migration targets. The shipped
code implements the contracts below directly, with no previous-version readers
or configuration migrations.

## Message format

```text
🦇<https://betterprivacy.app/m#v1.<keyId>.<salt>.<iv>.<ciphertext>>
```

- HTTPS URL with its encrypted payload in the fragment.
- keyId: 6 bytes of SHA-256(raw derived key), base64url (8 characters).
- Salt: 16 bytes, base64url (22 characters).
- IV: 12 random bytes, base64url (16 characters).
- Ciphertext: AES-256-GCM output including its authentication tag, base64url.
- The bat and angle-bracket wrapper are presentation. Bare links copied from
  the website use the same v1 envelope and are accepted. Unmatched brackets,
  other domains, non-HTTPS links, and unknown versions are rejected.
- Discord sends split plaintext losslessly into 1,360-byte UTF-8 chunks.
  Each chunk becomes an independent v1 message and remains below 2,000 characters.
- The browser composer creates one message/link within that same byte budget.

## Key derivation

PBKDF2-HMAC-SHA256 at 600,000 iterations derives 256-bit AES-GCM key material.
Phrase bytes are used exactly; case and spaces matter. Keys are imported as
non-extractable CryptoKeys and raw key buffers are cleared after use.

For channel keys, salt is SHA-256 of
`BetterPrivacy/v1/label-salt:` plus the trimmed, lowercased channel label,
truncated to 16 bytes. The browser composer generates a fresh random salt per
message. Both use the same envelope; recipients derive from the carried salt.

Keyring entries and current key export blobs retain salts as part of the
current contract. They are not migration code. The phrase is not persisted.
Knowing a phrase exposes all messages protected by its key; choose a long,
unique phrase and share it separately.

## Attachment format

Only `BPENC1` with the following layout is supported:

| Bytes | Field |
| --- | --- |
| 0–5 | ASCII magic `BPENC1` |
| 6–13 | Eight ASCII keyId characters |
| 14–29 | 16 raw KDF salt bytes |
| 30–41 | 12-byte header IV |
| 42–45 | uint32 big-endian encrypted-header length |
| 46 onward | Encrypted JSON header, then independently authenticated 8 MB chunks |

The header contains filename, MIME type, plaintext size, SHA-256 checksum,
and chunk count. Chunk IVs increment the last four header-IV bytes by
`1 + chunkIndex`. Parsers validate header types, lengths, chunk counts,
authentication tags, and the final checksum.

## Client integration

Target current BetterDiscord APIs:

- `BdApi.Webpack.getWithKey` returns an iterable module/export pair.
- `BdApi.Net.fetch` downloads encrypted attachments outside renderer CORS.
- The submit-time validator and current paste-prompt prop are the composer
  integration points. Removed message-length getter APIs are not probed.
- Message rendering uses current prop-name markers, not CSS-name source markers.
- Upload interception reads and replaces `CloudUpload.item.file`.

DOM rendering paths, lazy-module retries, safe cancellation, and input
validation remain: these handle current runtime state, not previous releases.
Missing optional composer patches retain Discord's native limit.

## Release verification

`npm test` covers v1 wire/container roundtrips, plugin/web crypto parity,
browser create/share/open flows, malformed input, and current composer gates.
`npm run typecheck` validates the shared module contracts.
`npm run build:site` rebuilds the distributable plugin and website download.

Live Discord integration and real mobile-browser rendering still require
manual verification. Automated checks do not substitute for those checks.

The integrated release run is recorded in [RELEASE-CHECK.md](RELEASE-CHECK.md).
Use `npm run verify:release` to run checks, rebuild both download copies, and
verify the static routes/assets and artifact identity in one command.
