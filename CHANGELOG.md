# Changelog

Notable changes to the community repository will be recorded here. This log is for the **public source track**, not the hosted service or customer Agent deployments.

## Unreleased

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
