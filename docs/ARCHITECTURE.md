# Architecture

YourHand Community is a **source-level, account-scoped remote device-control system**, not a turnkey production installer. The diagram describes the intended control flow; exact availability depends on the lab build and its configuration.

```text
             MCP client / compatible AI assistant
                              |
                    HTTPS + account OAuth
                              v
                  YourHand Core / MCP gateway
                  - account-scoped permissions
                  - RPC and operation journal
                  - SQLite device/account store
                  - usage/telemetry (scoped)
                    |                   ^
       authorized RPC over WS           | browser/API
                    v                   |
            Paired Windows Agent <---- Web dashboard
              |             |
        Native C# helper   Local capability routes
        GUI / UIA         files / processes / browser
              |
        Authorized Windows session
```

## Components

**Core:** `server-multiuser.js` hosts web/agent/MCP ports and registers scoped tool handlers. `src/multiuser/` holds OAuth, ownership/sharing storage, task/operation records, telemetry and web API routes. A database record does not itself prove a device is online.

**Agent:** `yourhand-agent.mjs` runs in an authorized Windows user context. Device enrollment establishes a unique identity; private keys and pairing configuration belong only on the enrolled device. The source Agent can route requests to a native helper and supported browser/filesystem/process interfaces.

**Native helper:** `native/YourHandNative.cs` implements guarded desktop observation and interaction for an ordinary interactive Windows session. Windows protected UAC/Winlogon desktops are outside the supported automation path; elevation requires the authorized local user's action. See [Threat model](THREAT_MODEL.md).

**Web/dashboard:** `web/` and `src/multiuser/web.js` provide account sign-in, owned/shared device views and permitted usage information. Web UI source can depend on newer Core capabilities; do not copy it into an unrelated production installation.

## Identity, trust and task state

The signed-in user's account is the authorization boundary. Device ownership, invitation roles, session validity and action permissions must all be checked by the Core; the Agent must independently validate its enrollment and request context. A shared-device invitation does not authorize access to other users' personal history.

A read-only observation can be retried differently from a mutating action. When a remote operation times out, the Core must not assume success or failure; it should reconcile the operation record and observe actual device state before making a new request. Network drops do not guarantee that a remote action did not already run.

## Development vs production

The source checkout has isolated local defaults, but production requires a reverse proxy/HTTPS, configured Google OAuth, managed secrets, hardened endpoints, observability, backups, revocation, vulnerability handling and tested upgrades. It is **not safe** to infer any of these from a passing `npm test`. Do not reuse credentials or databases from the official hosted service. See [Project status](PROJECT_STATUS.md), [Configuration](CONFIGURATION.md) and [Release process](RELEASING.md).
