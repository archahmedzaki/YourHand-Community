# Security policy

Security issues in a computer-control project can affect real machines and private data. **Do not post vulnerability details, production credentials, device IDs, customer files, screenshots, raw logs or exploit steps in public issues or pull requests.**

## Private vulnerability reports

Use the repository's [Security Advisories](https://github.com/archahmedzaki/YourHand-OpenSource/security/advisories) page and choose **Report a vulnerability**. Private vulnerability reporting is enabled for the official public repository. If you cannot access the reporting form, open a **non-sensitive** issue asking the maintainer for a private channel, without including exploit details or private data. The maintainer must establish a secure private exchange before receiving sensitive evidence. Do not send secrets to an unverified account or URL.

A useful private report includes: affected source version/commit, impacted component, reproducible test conditions on a disposable device, severity rationale, expected vs observed permission boundary, and a minimal sanitized proof of concept. Avoid using other people's devices or live customer accounts to verify an issue.

## Scope and support

The current community repository is a **source preview**. It is not a supported production installer and has no published vulnerability response-time SLA. Security fixes should be coordinated privately until a patch and appropriate disclosure can be prepared. Published community source and the separately hosted official service may not be running identical versions.

## Security principles

- Access only devices you own or are expressly authorized to control.
- Never automate protected UAC or Winlogon desktops, obtain another person's credentials or bypass local authorization.
- Treat potentially state-changing remote timeouts as **outcome unknown**; do not replay blindly.
- Keep production OAuth tokens, pairing state, enrollment keys, account identifiers, databases, customer files, logs and screenshots out of GitHub.
- If a real credential is accidentally published, revoke/rotate it immediately and assess the full public Git history and forks; deleting it from a newer commit alone is insufficient.

Read the [threat model](docs/THREAT_MODEL.md), [project status](docs/PROJECT_STATUS.md) and [release policy](docs/RELEASING.md) for remaining security work.
