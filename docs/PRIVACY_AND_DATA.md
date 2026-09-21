# Privacy and local data

This source release includes the mechanics for account/device data and privacy-scoped usage records; it does **not** ship customer records or automatically certify that an independent deployment complies with privacy law.

## Data categories in the source architecture

The SQLite data model can hold account identifiers, user-visible names, device enrollment/ownership and share records, hashed session/pairing/OAuth tokens, task and operation records, and scoped usage/telemetry. The Agent can access desktop content, browser tabs and files **only for authorized workflows**, but access is a powerful capability that must be bounded by consent and the user/device authorization model.

Source code does not include an enrolled device, production database, private device key, live session token or real customer activity. Do not publish any of these in a fork, issue, PR or diagnostic attachment.

## Privacy requirements for operators

- Use independently configured OAuth, ephemeral development accounts and least-privilege access.
- Inform users of screen/files/process access, consent requirements and sharing permissions; never represent a third-party invitation as ownership.
- Define and publish an accurate deployment-specific privacy notice, retention/deletion workflow, breach contact and third-party processor disclosures **before** operating a public service.
- Restrict access to logs and avoid raw file contents, OAuth credentials, screens or shell command arguments in shared telemetry.
- Isolate account-owned device lists and action history; avoid exposing another user's personal usage to invited operators.
- Treat backups and diagnostic bundles as sensitive personal data even when they are not checked into Git.

The source includes test coverage for scoped telemetry and a default retention setting; it is not a substitute for a legally reviewed privacy policy governing the independently hosted service.

See [Threat model](THREAT_MODEL.md), [Configuration](CONFIGURATION.md) and [Security](../SECURITY.md).
