# Community architecture (source candidate)

- Web: Google account sign-in, device ownership/share and account-scoped usage UI.
- Core: authenticated MCP server, permissions, per-device WebSocket registry, SQLite store and durable action journal.
- Agent: paired Windows user process using a local native desktop helper; direct filesystem and process APIs where available.
- Native helper: guarded frame/UIA actions on the ordinary interactive desktop. Elevated worker and production Windows service are NOT part of this source-only release.
- Privacy: device activity and usage are account-scoped, not accessible to other invited users. Uncertain side-effecting operations must not be automatically replayed.

The published OSS source must not be presented as a live production installer. Upgrade/migration and external deployment documentation are incomplete.
