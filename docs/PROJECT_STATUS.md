# Project status and release boundaries

**Current track:** YourHand Community **source preview**, published independently from the official hosted service. The repository is not a production installer and does not certify that the current production service runs the same build.

## Included in this source snapshot

- Core HTTP/MCP server, account-scoped SQLite data model, OAuth support, registered tool handlers and HTTP/WebSocket interfaces.
- Windows Agent source, action journal, direct filesystem/process routes and guarded native/GUI integration.
- C# native helper source and a Windows development build script.
- Web UI source, account/device/usage modules and synthetic regression tests.
- Privacy guidance, contribution policy, release gates and security documentation.

## Demonstrated checks

**Verified on 2026-09-21:** A freshly cloned public checkout (`420e0ce`) was installed from a local npm cache in an isolated Windows VPS laboratory directory, without connecting to customer devices. `npm test`, `npm run test:source`, `npm run test:privacy`, the native C# build (`native/build.ps1`) and `npm run test:native` passed. The native test checks 13 guarded UI entry points and a read-only session-state response; this is **not** complete real desktop/UAC interaction or a customer installation test.

The repository's `npm test` suite exercises isolated usage separation, approval gates, capability routing and privacy-safe telemetry. `npm run test:privacy` checks known private-file and credential patterns in the **working directory**. An independently authorized CI workflow is [prepared as a public template](CI_WORKFLOW_TEMPLATE.yml) but **is not active**; maintainers must run these checks on clean checkouts manually before accepting updates. GitHub's native Secret Scanning, Push Protection and Dependabot security updates are enabled separately and do not replace the inactive CI jobs. Test results are not evidence of complete Windows hardware, browser, billing, production OAuth or real-customer acceptance testing.

## Not yet delivered or independently verified

- A supported, signed Windows installer or pre-enrolled Agent bundle. Built EXE/ZIP artifacts are **not** in the public repository.
- A reproducible, fully documented standalone self-hosted deployment with working OAuth, public HTTPS, pairing, and native GUI on a disposable Windows computer.
- End-to-end upgrade/migration with uninterrupted production client sessions.
- Full real-device compatibility and Windows UAC/Winlogon integration testing on the final build.
- Formal penetration testing, third-party dependency legal audit, public SLA or guaranteed error-free operation.
- Public OpenAI directory approval, unlimited ChatGPT usage, or paid subscriptions as part of this repository.
- A legally finalized, signed contributor agreement and active third-party PR intake.

## Release criteria

Do not publish an installer or claim a production-ready release until: a clean checkout builds from documented prerequisites; identity/pairing and cross-account isolation are tested; real native/UI tests pass; upgrade/rollback and network interruption behavior are validated; all source/binaries/dependency notices are reviewed; secrets and data are scanned; and the owner authorizes release. See [release process](RELEASING.md).

For experiments use a **disposable machine and synthetic accounts**, never a live customer database or an existing paired Agent.
