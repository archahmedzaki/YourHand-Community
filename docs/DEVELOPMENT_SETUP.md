# Local development setup

This guide covers **source inspection and isolated tests**, not production installation. The source candidate does not contain an enrolled Agent or a ready-to-run distributed installer.

## Prerequisites

- Git, npm, and Node.js **24 or later** (the server uses `node:sqlite`, whose behavior depends on Node version).
- Windows for native C# UI helper integration, Microsoft .NET Framework C# compiler and Windows UI Automation assemblies; development requires their normal installation.
- A clean lab machine and a new, empty directory. Keep a production VPS, customer desktops and existing deployed YourHand instances out of this tutorial.

## 1. Get the source

```powershell
git clone https://github.com/archahmedzaki/YourHand-Community.git
cd YourHand-Community
npm ci
npm test
npm run test:privacy
```

A successful `npm test` run verifies selected **synthetic checks**; it does not establish that a remote desktop is controllable or that the hosted service is configured.

## 2. Optional native Windows build

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\native\build.ps1
```

The script compiles `native/YourHandNative.cs` into the locally generated `native/YourHandNative.exe`. The executable is deliberately ignored by Git. A running source-checkout Agent resolves the native helper from this development build path; deployed installations can supply their own explicitly configured path. If the build prerequisites are missing, install the appropriate Windows SDK/.NET components before retrying. **Do not elevate to bypass protected Windows desktops.**

After a successful build, run `npm run test:native` on a **disposable Windows desktop**. This test needs the locally built EXE; it cannot pass on GitHub's ordinary Linux runners.

## 3. Isolated local Core

```powershell
Copy-Item .env.example .env
```

Edit the untracked `.env` and set `YOURHAND_DB_FILE` to a **fresh test-only** SQLite path. Review `docs/CONFIGURATION.md` for the remaining variables; do not copy live OAuth credentials, existing device keys, server configuration or customer data.

```powershell
npm start
```

Default development Core ports are 8790 (web), 8791 (agent) and 8792 (MCP), bound to loopback. A health response or served HTML is **not** confirmation of a working Google sign-in or remote device enrollment.

## 4. Identity, devices and remote testing

The web dashboard expects your own Google OAuth client configuration, and devices require an explicitly authorized pairing flow. A **public HTTPS origin, provider registrations and independently built Agent bundle** are additional integration tasks; this source repository does not silently provision them. See [MCP and devices](MCP_AND_DEVICES.md).

Do **not** point the source Agent at the official hosted service or use production device enrollment records. Use a disposable account and test computer only.

## 5. Stop and clean up

Stop the development server in its terminal. Delete test-only databases, generated binaries, local credentials and paired-device keys using your own development environment's cleanup procedure; never commit them. The [security guide](../SECURITY.md) explains private-data handling.

Trouble building? See [Troubleshooting](TROUBLESHOOTING.md).
