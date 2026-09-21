# Continuous checks and automation

**CI status: NOT ACTIVE.** The [public workflow template](CI_WORKFLOW_TEMPLATE.yml) has been prepared and its local secret-scanning gate tested, but GitHub rejected the workflow-file upload through the currently authorized credential. The same credential does not have GitHub's `workflow` permission. The template is documentation only: GitHub Actions does not execute a YAML file placed in `docs/`. Until the owner grants the necessary workflow permission or publishes the file through an authorized GitHub browser session, run checks manually on an isolated checkout. The workflow requires no production credentials, deployments or customer-device access.

## Checks

- Node.js 24, `npm ci`, and the source's isolated `npm test` suite.
- `npm run test:source`: source syntax, self-contained relative imports, native-helper source-path fixture and Markdown local links.
- `npm run test:privacy`: known private filenames/device identifiers and common embedded-key patterns in the checkout.
- GitHub Secret Scanning, Push Protection and Dependabot security updates are **enabled** for this public repository (verified through repository settings); those security features are separate from the inactive CI template.
- The independent `detect-secrets` 1.5.0 scan and `scripts/check_secret_scan.py` check are included in the [workflow template](CI_WORKFLOW_TEMPLATE.yml). Only exact reviewed synthetic test fixtures are allowlisted; unfamiliar findings fail the check. This CI layer will not run on GitHub until activated.

**Passing these checks does not mean production approved:** it does not sign a Windows installer, perform customer enrollment, validate marketplace approval or exercise real desktop/UAC behavior on a disposable Windows machine. See [Project status](PROJECT_STATUS.md).

## Activating the prepared GitHub Actions workflow

Use a GitHub session authorized as this repository's owner, or authorize a credential with the GitHub `workflow` scope **in addition to** the appropriate repository-write permission. Copy the content of [docs/CI_WORKFLOW_TEMPLATE.yml](CI_WORKFLOW_TEMPLATE.yml) into **`.github/workflows/ci.yml`** on `main`, commit it, then open the repository's Actions tab to verify that both the unit/privacy and independent secret-pattern jobs pass. Only after that, configure the desired main-branch rules to require successful checks. The source-preview repository must remain independently separate from the private production Git history. **Never paste access tokens in issues or chat.**

## Maintainer protection

Before merging into `main`, require passing checks and a reviewed PR. The workflow cannot enforce these checks until separately published by a credential with GitHub workflow-management permission; run them manually in the meantime. If branch protection/rulesets are unavailable for the account, the maintainer must enforce the same steps manually; writing a policy in this file does not itself activate GitHub branch protection.

A finalized, verifiably signed contributor agreement is an **additional human-reviewed gate** for external code contributions. A CI checkbox or PR body is not a binding signature. See [CLA FAQ](CLA_FAQ.md).

## Secret handling

No secrets are needed for normal CI. Never configure a production server token as a GitHub Actions secret merely to run tests. A leak must be revoked/rotated and assessed across all public history; a later deletion does not withdraw already-published credentials.
