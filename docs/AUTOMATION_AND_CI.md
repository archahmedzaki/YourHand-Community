# Continuous checks and automation

**Status: GitHub Actions CI is active.** The authoritative workflow is [`.github/workflows/ci.yml`](../.github/workflows/ci.yml). It runs on pushes and pull requests to `main`, with read-only repository permissions and no production deployment credentials. The two CI jobs **both passed** on 2026-09-21 at public commit `708c97d`: [verified workflow run](https://github.com/archahmedzaki/YourHand-Community/actions/runs/35642603880).

## Checks on each change

- **Node 24 / source and privacy:** clean checkout, `npm ci --ignore-scripts`, `npm test`, `npm run test:source` and `npm run test:privacy`. Includes isolated authorization, privacy and documentation-link checks. No customer devices are accessed.
- **Independent source secret scan:** `detect-secrets==1.5.0` scans **Git-tracked project files** (`detect-secrets scan --no-verify`), then `scripts/check_secret_scan.py` rejects any findings other than exact, previously reviewed synthetic/static fixtures. Do not run the scanner against `.git`: internal commit hashes are not secrets but may trigger high-entropy heuristics.
- **Native GitHub security settings:** Secret Scanning, Push Protection and Dependabot security updates are enabled independently of CI. These features complement the project-specific tests.

A fresh public checkout was also independently tested on 2026-09-21 in an isolated Windows lab: cached `npm ci`, unit/source/privacy tests, native helper compilation and `npm run test:native` passed. The Windows native-helper test is **not included in the Ubuntu CI jobs** and is **not** full real-desktop, UAC, onboarding or production installation acceptance.

## Maintainer controls

Review all changes and enforce successful CI checks before merging contributions. The public repository's `main` branch is now protected: both the **Node 24 source and privacy** and **Independent source secret scan** checks are required, with strict up-to-date checks. Force pushes and branch deletion are disabled. Repository administrators retain GitHub's configured bypass (`enforce_admins=false`) to avoid preventing the owner from maintaining the source; this does not replace the maintainer's obligation to inspect changes. Verify current settings in GitHub before changing branch rules. External code contributions are **not accepted for merge** until the owner-adopted [individual CLA v1.1](../CONTRIBUTOR_LICENSE_AGREEMENT.md) has a GitHub-authenticated PR-comment acceptance recorded and verified through the [scoped workflow](CLA_SCOPED_SIGNING.md) and the actual rights holder is verified. A company-owned contribution requires separate authorized corporate permission. **The scoped CLA check is active and required, and an unsigned PR was rejected; live signed-contributor verification remains pending**, and the project makes no claim of professional legal certification. A PR checkbox or DCO sign-off cannot substitute for the separate commercial sublicensing permission. See [signing status](CLA_SIGNING_SETUP.md).

## Security limitations

CI does not authorize access to the official hosted Core, customer devices or live databases, does not sign Windows installers, and does not establish production readiness. Do not add hosted deployment keys to the public workflow merely to make tests pass. The first CI run failed because scanning all files included an internal Git metadata file; the tracked-files-only scan was corrected and the following run passed. An npm vulnerability audit could not be independently completed in the Windows lab because the package-audit request timed out, so dependency vulnerabilities are **not certified absent**. See [Project status](PROJECT_STATUS.md), [Threat model](THREAT_MODEL.md) and [Release process](RELEASING.md).
