# Contributing

BetterPrivacy's main product is the desktop Discord plugin. Browser tools provide
compatible creation and decryption for mobile users and people without the plugin.
The plugin, website and tests are MIT-licensed; contributions use the same license.

## Local setup

Use Node.js 24 LTS and npm:

```sh
npm ci
npm run verify:release
python3 -m http.server 4173 --directory site --bind 127.0.0.1
```

Open http://localhost:4173/. `verify:release` typechecks, runs tests, builds the
plugin and prepares the website download. Generated bundles and dependencies
are not committed. Test Discord integrations manually with a test account;
automated mocks do not guarantee compatibility with current Discord internals.

## Repository map

- `src/`: plugin, cryptography, session state and Discord integrations.
- `site/`: static website and local browser message tools.
- `tests/`: cryptographic, interoperability and interaction tests.
- `scripts/`: website packaging and release verification.
- `PRE-LAUNCH-REVIEW.md`: public v1 message/container contract.
- `RELEASE-CHECK.md`: release verification and pending manual checks.

## Pull requests

Describe the problem, scoped changes, tests and any manual checks. Include
screenshots or a short recording for visual changes, including mobile layouts
and reduced-motion behavior. Do not remove established motion as part of an
unrelated cleanup.

Changes to message envelopes, key derivation or `.bpenc` containers require an
explicit versioning and compatibility discussion first. Preserve plugin/web
interoperability and add regression tests. Never fall back to plaintext after
an encryption failure, persist secrets, log private contents, or send phrases
to a server. Never include live credentials, personal messages or keyring exports
in issues, tests or commits. Use synthetic test data.

For security-sensitive reports, follow [SECURITY.md](./SECURITY.md).
