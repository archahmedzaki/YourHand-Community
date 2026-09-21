# Troubleshooting: source preview

**Do not paste real config files, pairing tokens, access keys, screenshots, private logs or customer data into public issues.** Redact filenames, IDs and domains as appropriate.

| Symptom | Likely cause / next safe check |
|---|---|
| `npm ci` fails | Check Node/npm versions, network and lockfile; use Node 24+ and retry on an isolated machine |
| `node:sqlite` warning | Node's SQLite API/behavior is version-dependent. Use a supported Node release and verify local tests |
| Google sign-in unavailable | This source checkout has no production Google client ID or registered HTTPS origin; configure an independent test OAuth project |
| Web/API responds but no Windows device | The Agent is not enrolled/connected merely because Core started; a separate pairing/bundle workflow is needed |
| Agent reports missing native helper | Build `native/YourHandNative.exe` locally with `native/build.ps1`; verify compiler and UIAutomation assemblies |
| Native test reports missing EXE | `npm run test:native` requires the locally built helper and an authorized disposable Windows interactive session |
| Port already occupied | Stop only **your own test** instance or choose free local port variables; do not kill production YourHand services |
| An action times out | Treat outcome as unknown; inspect operation status and device state **before** retrying a state-changing action |
| A GUI action fails on locked/UAC desktop | Protected Windows desktops are not automated; let the authorized local user resolve the prompt |
| GitHub CI fails on Windows-only integration | Keep Linux CI to isolated source/unit tests; run native GUI integration separately on Windows |

To reproduce an issue, include your platform, Node version, sanitized minimal steps, expected/observed behavior, which synthetic test failed, and whether the device is a lab machine. If it involves security, report privately via [SECURITY.md](../SECURITY.md).
