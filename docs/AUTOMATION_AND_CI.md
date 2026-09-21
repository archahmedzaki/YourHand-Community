# Continuous checks and automation

**CI status: prepared locally but not yet published or enabled on GitHub.** The GitHub credential used for this release did not have permission to create or update workflow files. Until the maintainer authorizes an appropriately scoped workflow update, run the following source/unit/privacy checks manually on an isolated checkout. The prepared workflow requires no production credentials, deployments, or customer-machine access.

## Checks

- Node.js 24, `npm ci`, and the source's isolated `npm test` suite.
- `npm run test:source`: source syntax, self-contained relative imports, native-helper source-path fixture and Markdown local links.
- `npm run test:privacy`: known private filenames/device identifiers and common embedded-key patterns in the checkout.
- Independent secret scanning is configured in a prepared (unpublished) workflow, with only explicitly reviewed synthetic fixtures permitted; unfamiliar findings require human investigation, never blanket suppression.

**Passing these checks does not mean production approved:** it does not sign a Windows installer, perform customer enrollment, validate marketplace approval or exercise real desktop/UAC behavior on a disposable Windows machine. See [Project status](PROJECT_STATUS.md).

## Maintainer protection

Before merging into `main`, require passing checks and a reviewed PR. The workflow cannot enforce these checks until separately published by a credential with GitHub workflow-management permission; run them manually in the meantime. If branch protection/rulesets are unavailable for the account, the maintainer must enforce the same steps manually; writing a policy in this file does not itself activate GitHub branch protection.

A finalized, verifiably signed contributor agreement is an **additional human-reviewed gate** for external code contributions. A CI checkbox or PR body is not a binding signature. See [CLA FAQ](CLA_FAQ.md).

## Secret handling

No secrets are needed for normal CI. Never configure a production server token as a GitHub Actions secret merely to run tests. A leak must be revoked/rotated and assessed across all public history; a later deletion does not withdraw already-published credentials.
