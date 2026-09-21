# Changelog

Notable changes to the community repository will be recorded here. This log is for the **public source track**, not the hosted service or customer Agent deployments.

## Unreleased

- Expanded developer documentation, security and contribution policies, roadmap, issue/PR guidance and local automated checks. A public workflow template is available under `docs/CI_WORKFLOW_TEMPLATE.yml`; it is not active pending separate GitHub workflow permission.
- Enabled GitHub Secret Scanning, Push Protection and Dependabot security updates on the public repository.
- Added a source-checkout native-helper path module and synthetic path resolution test.
- Clarified source-preview limitations, separate hosted service and pending CLA signing workflow.

## 2026-09-21 — initial community source preview

- Created a new public repository with an independent one-commit history and a reviewed source snapshot.
- Included Core, Agent, native helper, web UI and isolated test source.
- Omitted production databases, device identity, private keys, real customer information and pre-enrolled installers.
- Licensed the community source under AGPL-3.0-only; published a non-binding contributor agreement **draft** for legal review.

**No production-ready binary, public app-directory approval or guaranteed deployment is asserted by these entries.**
