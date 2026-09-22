# Contributor consent on YourHand Community

**Status: Community-only, narrow-permission GitHub Actions consent gate prepared as a template; the required live workflow and signed/unsigned PR acceptance tests are not yet complete.** Do not treat GitHub App installation alone as a signed agreement or an activated merge gate. The public source is AGPL-3.0-only; the contributor agreement grants extra permissions solely for contributions a signer has authority to license.

The public [individual CLA v1.1](https://gist.github.com/archahmedzaki/e2b383e438726b5b157bd5451c0171ba) was adopted by the repository owner. The initial agreement's exact UTF-8 SHA-256 is `4c8e9c894e3456a539fff3a25b9d012a144ecd649d2ebfde28c05525dbd81acf`. The original v1.0 Gist was not used for contributor signatures; the revised v1.1 explicitly permits the following GitHub-authenticated written assent on a pull request.

## Signing an individual-owned pull request

Read the entire [CLA v1.1](https://gist.github.com/archahmedzaki/e2b383e438726b5b157bd5451c0171ba) and check that the SHA-256 shown above matches the agreement you are accepting. If you agree, **you personally**, while signed in to your own GitHub account, post **this exact single-line comment** on your own PR:

```text
I have read and agree to the YourHand Community Individual Contributor License Agreement v1.1 at https://gist.github.com/archahmedzaki/e2b383e438726b5b157bd5451c0171ba (SHA-256: 4c8e9c894e3456a539fff3a25b9d012a144ecd649d2ebfde28c05525dbd81acf), and I confirm I personally own or have authorization to license every contribution I submitted in this pull request.
```

This comment and your username/timestamp are public on GitHub. The maintainer did not sign it for you. If you do not want a public acceptance record, do not post it; contact the maintainer for a separately agreed private written agreement. A PR checkbox, generic DCO sign-off, comment from a different user, an acceptance from before this CLA version or a modified comment is **not** accepted as the individual CLA v1.1 signature.

The scoped in-repository GitHub Actions checker `.github/scripts/cla-gate.cjs` reads only the base repository's trusted code, checks the current public Gist's exact hash, retrieves the live PR and its GitHub-authenticated comments, then sets the **`YourHand CLA v1.1 / contributor consent`** commit status on the current PR head. It fails closed for missing consent, changed Gist, wrong author, wrong repo, old version, deleted or edited consent, and inaccessible evidence. It uses GitHub's repository-scoped `GITHUB_TOKEN` with **read-only repository content, read-only PR/issues, and status write permissions on YourHand-Community only**; no personal access token, original private repository, payment accounts or third-party broad OAuth token.

## Separate company and third-party ownership checks

An individual GitHub comment does not prove real-world identity, copyright chain-of-title, employer authorization, or any qualified electronic-signature requirement. **External code merge still requires the maintainer's private source provenance and rights-holder review**. Company-owned or coauthored works need their actual rights holder's separate authorized corporate permission; the public [corporate CLA](CLA_CORPORATE_DRAFT.md) is only a draft. An individual cannot make a corporate signature simply by repeating the statement above. AGPL-only upstream/copyleft material cannot automatically be relicensed as proprietary.

## Why not connect the hosted CLA Assistant account?

The owner installed the CLA Assistant GitHub App restricted to **only this public Community repo**. However, its separate web-dashboard OAuth login requested account-wide read/write access to repository webhooks and commit statuses that is not restricted by the GitHub App repository picker. **That additional OAuth grant was deliberately declined** to protect the original private YourHand repository. The installed app alone does not link this Gist, ask contributors to sign or add an active signing check. The alternative scoped workflow is documented in [its reviewable template](CLA_SCOPED_WORKFLOW_TEMPLATE.yml). Do not turn on hosted CLA Assistant's broad OAuth without separately deciding to accept the cross-repository exposure.

## Activation acceptance tests and release gate

Publish and activate the workflow on the actual public `main` branch. Create a disposable PR from a separate contributor GitHub identity; verify its unsigned consent status is **failure** and cannot be merged. Then have that real contributor personally post the exact statement, confirm the head SHA's consent status becomes **success**, and verify editing/deleting the comment or changing the PR head fails closed. Once confirmed, add the **observed exact status context** as a required `main` branch-protection check without removing the existing two CI checks or code-owner review. Repository administrators can bypass GitHub branch protection; the maintainer must never manually bypass the contributor-rights gate. Do not fabricate a signature, sign on someone else's behalf, or merge external code while these checks are incomplete.

No qualified lawyer has certified the individual CLA or cross-border enforceability of this online acceptance procedure. The public assent and a successful technical status are evidence of consent, **not** universal legal assurance.
