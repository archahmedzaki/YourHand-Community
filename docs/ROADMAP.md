# YourHand roadmap

This is a **directional public roadmap**, not a commitment to dates or guaranteed functionality. Roadmap items do not grant access to private customer or hosted-service infrastructure.

| Phase | Focus | Completion evidence |
|---|---|---|
| Source preview — current | Document architecture, protect private data, publish source and synthetic tests | Independent public Git history, reviewed manifest, repeatable static and unit checks |
| Reproducible development | Resolve source-only build gaps; document bootstrap, native build and disposable test account | Fresh Windows checkout builds and passes tests without production assets |
| Stable agent sessions | Reconnect behavior, stale-socket detection, idempotent action outcomes and safe client upgrades | Network fault injection and continuous session tests |
| Permissioned collaboration | Ownership/share boundaries, auditability and session concurrency | Cross-account negative tests and explicit mutating-action controls |
| Community release | Reviewed dependency notices, signed artifacts, maintainable issue/PR workflows | End-to-end lab acceptance, release checklist and provenance of published artifacts |
| Integrations | Improve supported MCP clients, browser/desktop routing and documentation | Tested capability matrix per client, OS and version |

**How to influence priorities:** open an issue with a reproducible user need and a privacy-safe test case. Maintainers determine scope, sequencing and release dates. No payment or donation buys roadmap placement.

For current limitations see [Project status](PROJECT_STATUS.md) and [Troubleshooting](TROUBLESHOOTING.md).
