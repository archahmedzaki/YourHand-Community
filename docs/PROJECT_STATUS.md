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

The repository's `npm test` suite exercises isolated usage separation, approval gates, capability routing and privacy-safe telemetry. `npm run test:privacy` checks known private-file and credential patterns in the **working directory**. The [GitHub Actions workflow](../.github/workflows/ci.yml) is **active** and completed successfully on the public source at commit `708c97d` on 2026-09-21. Its two jobs run Node/source/privacy tests and an independent secret-pattern scan on tracked source files. GitHub's native Secret Scanning, Push Protection and Dependabot security updates are enabled separately and complement, rather than replace, the CI jobs. Test results are not evidence of complete Windows hardware, browser, billing, production OAuth or real-customer acceptance testing.

## Independently executed isolated Core/Agent lab

A separately cloned public source snapshot at commit `494b7bf` completed **18/18 defined isolated loopback lab checks** on 2026-09-21, including a fresh native helper build, synthetic account sessions, device pairing, actual Agent Ed25519 WebSocket authentication, read-only command-channel ping, cross-account access denial and revocation. One check explicitly confirmed that the installer endpoint returns **HTTP 503** while its required package is absent; this is an expected negative check, not an installed app. Real Google OAuth and a complete Windows installer run were **not** tested. See [evidence and blockers](COMMUNITY_LAB_E2E_REPORT.md).

## Community installation isolation (source change under validation)

The public Community source now uses a separate **`%LOCALAPPDATA%/YourHandCommunity`** root and distinct startup/uninstall registry entries in its installer and Windows manager, rather than the official client's original paths. Its default Core database and optional environment file are also source-local, with no default read from the official Core's private paths. The GUI manager takes the Community dashboard origin from the generated setup configuration rather than the official hosted site. Source-level isolation tests and an unsigned Windows compilation test passed. **A clean installation, real Google OAuth, agent GUI control, safe rollback and uninstall have NOT been independently performed on a disposable Windows VM**, and there is no signed public installer release.

## Not yet delivered or independently verified

- A supported, signed Windows installer or pre-enrolled Agent bundle. Built EXE/ZIP artifacts are **not** in the public repository.
- A reproducible, fully documented standalone self-hosted deployment with working OAuth, public HTTPS, pairing, and native GUI on a disposable Windows computer.
- End-to-end upgrade/migration with uninterrupted production client sessions.
- Full real-device compatibility and Windows UAC/Winlogon integration testing on the final build.
- Formal penetration testing, third-party dependency legal audit, public SLA or guaranteed error-free operation.
- Public OpenAI directory approval, unlimited ChatGPT usage, or paid subscriptions as part of this repository.
- An active and tested third-party CLA signing/check workflow. The owner has adopted an [individual non-exclusive CLA v1.0](../CONTRIBUTOR_LICENSE_AGREEMENT.md) and published a versioned signing Gist, but **GitHub authorization, signed/unsigned PR acceptance tests and external contributor verification remain pending**. No independent attorney certified the CLA; the [corporate form](CLA_CORPORATE_DRAFT.md) remains a draft. See [signing setup](CLA_SIGNING_SETUP.md).

## Release criteria

Do not publish an installer or claim a production-ready release until: a clean checkout builds from documented prerequisites; identity/pairing and cross-account isolation are tested; real native/UI tests pass; upgrade/rollback and network interruption behavior are validated; all source/binaries/dependency notices are reviewed; secrets and data are scanned; and the owner authorizes release. See [release process](RELEASING.md).

For experiments use a **disposable machine and synthetic accounts**, never a live customer database or an existing paired Agent.
