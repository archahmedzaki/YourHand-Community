# YourHand Community — source candidate

YourHand is a self-hostable Windows device Agent, authenticated web/Core and MCP control plane.

**Status:** source-only review candidate, not a tested production installer. The hosted service at yourhand.wolvexai.com is separate from this checkout. Do not deploy on top of an existing customer installation or use this source candidate to upgrade an existing live Core; the r10 canary, live GUI and independent-session migration gates remain open.

## Source
Core: `server-multiuser.js`, `src/multiuser/`, `src/execution/`.
Windows Agent: `yourhand-agent.mjs`, `yh-action-journal.mjs`.
Native desktop helper: `native/YourHandNative.cs` with `native/build.ps1`.
Windows manager: `YourHandManager.cs`. The prebuilt customer installer and all enrolled private data are NOT included.
Web UI: `web/`. Some public UX features require a new Core and must not be copied into old production versions on their own.

## Development checks
On Windows, install current Node.js with node:sqlite support, run `npm install`, then `npm test`. To compile the Windows native helper on an authorized test device, run `powershell -ExecutionPolicy Bypass -File native/build.ps1`. Build and configuration of the complete Windows installer require further documented production-release work. Keep passwords, signing keys and agent enrollment details out of this source tree.

## Self-host caution
Run the Core and Agent only against your own test devices and with your own Google OAuth configuration and public HTTPS origin. Defaults are intended for a local lab, not direct public internet exposure. The native helper does not bypass protected UAC/Winlogon desktops; local consent is required for privilege elevation. Independent Core gateway / uninterrupted live migration remains unverified.

## Optional support

See [SUPPORT.md](SUPPORT.md). Donations will be available only through a verified, owner-controlled public PayPal link once configured; donors choose their own amount. The open-source software does not require a donation. There is no active donation URL in this release candidate.

## Contribution and commercial edition policy

The community source is licensed AGPL-3.0-only. The maintainer also plans to license eligible owned or separately authorized code in a distinct hosted/proprietary edition. External code contributions are **not yet accepted for merge** until an appropriate non-exclusive contributor agreement and verifiable signing workflow are finalized. Contributors keep their own copyright; third-party AGPL-only material cannot be silently relicensed. See [licensing policy](docs/LICENSING_POLICY.md), [contribution instructions](CONTRIBUTING.md), and the [unapproved CLA draft](CONTRIBUTOR_LICENSE_AGREEMENT.md).

## License and privacy
YourHand project source is released under **GNU AGPL-3.0-only** when this package is approved and published. See `LICENSE`. Third-party dependencies are under their own respective licenses; consult package manifests. Protect the YourHand name and brand separately from the software copyright license. No production databases, user accounts, paired-device keys, OAuth secrets, customer histories or repository history are part of this source package.
