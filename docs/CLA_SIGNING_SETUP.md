# Contributor signing status and activation

The maintainer adopted the [individual CLA v1.1](../CONTRIBUTOR_LICENSE_AGREEMENT.md), published at [its separate versioned Gist](https://gist.github.com/archahmedzaki/e2b383e438726b5b157bd5451c0171ba). It explicitly accepts personally authored, GitHub-authenticated, SHA-256-pinned PR-comment consent. The [scoped signing guide](CLA_SCOPED_SIGNING.md) provides the exact acceptance statement, evidence requirements and activation checklist.

**Hosted CLA Assistant is NOT connected or active:** the GitHub App was installed for YourHand-Community only, but its separate dashboard OAuth requested account-level write permission on repository webhooks/commit statuses, beyond that app's repository selection. That broader OAuth request was declined so the original private YourHand repository stays out of scope. Do not claim the hosted app has linked a Gist or validated any contributor's signature.

The proposed replacement is an in-repository GitHub Actions status check with a **per-repository ephemeral token only**. Its code lives in `.github/scripts/cla-gate.cjs` and its [inactive template](CLA_SCOPED_WORKFLOW_TEMPLATE.yml) can be installed on main. Once live, the checker verifies the exact original Gist content hash and records the GitHub-authenticated PR author's own versioned acceptance comment on the PR's current head commit. It does not authenticate legal identity or an employer's legal authority.

**Until the live unsigned/signed PR acceptance tests succeed and the exact status is added to required branch checks, do not merge outside contributions or announce fully active CLA signing.** A company-owned contribution still requires authorized corporate permission; the [corporate template](CLA_CORPORATE_DRAFT.md) is not executable as written. An individual comment is not a company's signature.

No independent qualified attorney has certified the legal enforceability of these terms in every relevant jurisdiction. A successful code-host status is not a substitute for intellectual-property provenance review.
