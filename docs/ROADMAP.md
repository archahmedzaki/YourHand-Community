# YourHand roadmap

This is a **directional public roadmap**, not a commitment to dates or guaranteed functionality. Roadmap items do not grant access to private customer or hosted-service infrastructure.

| Phase | Focus | Completion evidence |
|---|---|---|
| Source preview — current | Document architecture, protect private data, publish source and synthetic tests | Independent public Git history, reviewed manifest, repeatable static and unit checks |
| Reproducible development | Isolated source build and actual Core/Agent pairing lab passed; complete signed installer remains pending | [18/18 scoped lab checks](COMMUNITY_LAB_E2E_REPORT.md), then separately verify a disposable Windows clean installation, real OAuth and release artifacts |
| Stable agent sessions | Reconnect behavior, stale-socket detection, idempotent action outcomes and safe client upgrades | Network fault injection and continuous session tests |
| Permissioned collaboration | Ownership/share boundaries, auditability and session concurrency | Cross-account negative tests and explicit mutating-action controls |
| Contributor licensing | Finalize individual/corporate CLA with qualified counsel and activate authenticated rights-holder signatures | [Counsel review and signer verification](CLA_COUNSEL_REVIEW.md) before any external code merge |
| Community release | Reviewed dependency notices, signed artifacts, maintainable issue/PR workflows | Full installer and real identity end-to-end acceptance, release checklist and provenance of published artifacts |
| Integrations | Improve supported MCP clients, browser/desktop routing and documentation | Tested capability matrix per client, OS and version |

**How to influence priorities:** open an issue with a reproducible user need and a privacy-safe test case. Maintainers determine scope, sequencing and release dates. No payment or donation buys roadmap placement.

For current limitations see [Project status](PROJECT_STATUS.md) and [Troubleshooting](TROUBLESHOOTING.md).
