# Security policy

BetterPrivacy is pre-release software and has not undergone an independent
security audit. It uses shared secret phrases, without forward secrecy or
automatic key exchange. A compromised phrase can expose messages protected by
that phrase. Metadata, screenshots and compromised devices are outside its
protection. Discord client modifications also carry account-policy risks.

## Reporting a vulnerability

Please use the repository's **Security → Report a vulnerability** option when
available. Maintainers must enable GitHub private vulnerability reporting for
this option to appear. If unavailable, open an issue asking for a private
reporting channel without including exploit details or sensitive material.
Do not assume a private reporting channel is already configured.

Include the affected commit, environment, synthetic reproduction steps,
expected behavior and potential impact. Never include real secret phrases,
personal ciphertext, keyring exports or credentials. Keep exploitable details
private until a fix and disclosure plan have been agreed with maintainers.

Only the current development branch is maintained until a release support
policy is announced. There is no guaranteed response or remediation timeline.
