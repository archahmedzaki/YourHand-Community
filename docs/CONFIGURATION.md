# Configuration reference

The checked-in `.env.example` contains **development examples only**. Copy to an untracked `.env`; never commit real values. The actual environment-variable names below are taken from the current community Core source. Port defaults are for a local lab, not an exposed internet service.

| Variable | Purpose | Preview default |
|---|---|---|
| `YOURHAND_WEB_PORT` | Local web/API listening port | `8790` |
| `YOURHAND_AGENT_PORT` | Local Agent WebSocket listening port | `8791` |
| `YOURHAND_MCP_PORT` | Local MCP HTTP listening port | `8792` |
| `YOURHAND_DB_FILE` | SQLite path | Source fallback is a Windows system path: **override with a fresh test-only path** |
| `YOURHAND_BASE_URL` | OAuth issuer and web origin used by Core | `http://127.0.0.1:<web-port>` |
| `YOURHAND_MCP_PUBLIC_URL` | Public resource identifier for MCP | Derived from `YOURHAND_BASE_URL` plus `/mcp` |
| `GOOGLE_CLIENT_ID` | Your own Google OAuth web client ID | Not configured |
| `YOURHAND_ENV_FILE` | Optional additional local environment file | Source code uses a Windows-system fallback; do not copy production configuration |
| `YOURHAND_AGENT_BUNDLE` | Location of a separately built Agent ZIP for installer integration | Not provided in this source release |
| `YOURHAND_TELEMETRY_RETENTION_DAYS` | Local telemetry retention | `30` |

**Important:** the sample `.env.example` lists an optional client-secret placeholder, but this by itself does not configure or validate a production OAuth client. Configure the actual provider integration from the source code and test the complete OAuth flow before exposing it publicly.

### Secrets and identity

Credentials, pairing tokens, enrolled device keys, OAuth tokens, production DB files, logs and customer screenshots must stay outside the public repository and outside GitHub issues. Do not set production secrets in command lines or commit real `.env` files. Avoid reusing any existing YourHand installation's database or device identity.

### Deployment boundary

Loopback bindings do not provide HTTPS, reverse-proxy authentication, firewall configuration, key rotation, secure backups, incident response or session-preserving upgrades. Production deployment remains a separate security and release review.
