# Changelog

Notable changes to the community repository will be recorded here. This log is for the **public source track**, not the hosted service or customer Agent deployments.

## Unreleased

- Activated the repository-scoped [CLA v1.1 consent workflow](.github/workflows/cla.yml) on the public repository with only issues/PR read and commit-status write permissions; verified unsigned public PR #10 failed and made its exact consent status a required `main` check alongside both CI jobs and code-owner review. A real signed-contributor acceptance test remains outstanding; do not merge external work until verified.

- Owner adopted individual non-exclusive Contributor License Agreement v1.0 with express separate commercial/proprietary sublicensing permission; published its versioned SHA-256-identified text as a public GitHub Gist. No independent lawyer certified its enforceability. External GitHub CLA Assistant OAuth authorization, repository linkage and signed/unsigned PR enforcement are pending; corporate form remains a draft.

- Separated the Community installer/manager directory, registry entries and dashboard origin from the original YourHand desktop client. Community Core now defaults to its own database and local environment rather than reading private operational paths. Added a source isolation regression check.
- Independent lab generated a 3,687-file **unsigned** Agent ZIP with integrity verification and passed 6/6 HTTP package and Setup download checks; this is **not** a completed installed-client end-to-end test.

- Prepared expanded individual and corporate non-exclusive CLA drafts and a qualified-counsel review/signing plan; **signature acceptance is not active** and commercial re-licensing rights in outside work are not assumed.
- Recorded independent disposable loopback lab results: 18/18 source/identity/device protocol checks passed (including expected HTTP 503 on the absent installer), while real Google OAuth and full separate Windows installation remain untested.

- Verified a fresh clone of the public source on an isolated Windows lab: cached npm installation, unit/source/privacy tests, native C# compilation and read-only native approval-gate coverage passed. Full real-device pairing and production upgrades remain untested.

- Expanded developer documentation, security and contribution policies, roadmap, issue/PR guidance and local automated checks. Activated the [GitHub Actions workflow](.github/workflows/ci.yml); both Node/source/privacy and independent tracked-source secret scan jobs passed on commit `708c97d`. Removed the obsolete inactive workflow template.
- Enabled GitHub Secret Scanning, Push Protection and Dependabot security updates on the public repository.
- Protected the public `main` branch with strict required source/privacy and secret-scan checks; disabled force pushes and branch deletion while preserving the owner's GitHub administrator bypass.
- Added a source-checkout native-helper path module and synthetic path resolution test.
- Clarified source-preview limitations, separate hosted service and pending CLA signing workflow.

## 2026-09-21 — initial community source preview

- Created a new public repository with an independent one-commit history and a reviewed source snapshot.
- Included Core, Agent, native helper, web UI and isolated test source.
- Omitted production databases, device identity, private keys, real customer information and pre-enrolled installers.
- Licensed the community source under AGPL-3.0-only; published a non-binding contributor agreement **draft** for legal review.

**No production-ready binary, public app-directory approval or guaranteed deployment is asserted by these entries.**
