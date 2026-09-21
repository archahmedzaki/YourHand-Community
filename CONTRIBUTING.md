# Contributing to YourHand

Thanks for your interest in improving YourHand. The public community edition uses **AGPL-3.0-only**. The maintainer also plans to incorporate eligible contributions into a separately licensed hosted/commercial edition. Copyright ownership stays with contributors.

**Contribution intake is not yet open.** Until the non-exclusive Contributor License Agreement (CLA) is finalized and a verified signing/check workflow is active, please discuss ideas in issues but do not submit code expecting it to be merged. Pull requests will remain unmerged until the appropriate rights holder has signed the finalized CLA. A plain DCO sign-off is not sufficient for the required dual-licensing rights. The current draft is [CONTRIBUTOR_LICENSE_AGREEMENT.md](CONTRIBUTOR_LICENSE_AGREEMENT.md) and explicitly is not active or ready for signature.

When contributions open, the owner or legally authorized rights holder must approve the CLA before merge. If the contributor's employer owns the code, obtain authorized company approval; an employee's personal signature alone will not suffice. Do not copy other projects' code, examples or assets unless you can identify their owners and compatible licenses.

Contributions may target the Windows Agent, Core, MCP tools, website, documentation and isolated tests. Run `npm ci` and `npm test` in a clean checkout. Never include installed production agents, generated installers, machine-specific configurations, private accounts or customer information, paired-device credentials, databases, private logs, screenshots, signing keys or full private Git history. New device actions must enforce authenticated ownership, explicit authorization and no blind retry of uncertain actions.

For policy details, see [docs/LICENSING_POLICY.md](docs/LICENSING_POLICY.md). The YourHand name and artwork are not granted as an unrestricted trademark license by the AGPL.
