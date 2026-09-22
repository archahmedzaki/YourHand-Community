# YourHand Community — contributor signing activation

**Agreement text prepared; external signing integration NOT YET ACTIVE.** The maintainer has elected to adopt a versioned, non-exclusive individual CLA without obtaining a separate attorney opinion at this stage. It is a contractual permission request, **not** a professionally certified legal opinion or a qualified Egyptian electronic signature. Independent legal review remains advisable where enforceability matters.

## The exact individual agreement

The project-owner-adopted [individual CLA v1.0](../CONTRIBUTOR_LICENSE_AGREEMENT.md) has been separately published in the [public, versioned GitHub Gist](https://gist.github.com/archahmedzaki/2f98acc13ac5d1e30c518fb1b310bf36). Its initial UTF-8 SHA-256 is:

`a87bb096df0ae4d13db4c4a96475f1ec4ae436e3b8abc4aba62eea823ac38f3c`

This version grants specified non-exclusive community and **proprietary/commercial sublicense** rights only for work the contributor actually has authority to license. It is **not** a copyright assignment. The gist's existence and project owner's adoption do not constitute a contributor's acceptance.

## Hosted signature service

The selected service is SAP's [CLA Assistant](https://cla-assistant.io/). According to its published documentation, the maintainer can associate a GitHub repository with a CLA Gist; it authenticates contributors with GitHub, solicits their affirmative acceptance on PRs, records signed versions and publishes a PR status check. This service is operated by a third party and has its own [privacy policy](https://gist.github.com/CLAassistant/3a73e4cd729c9d0a6e30).

**Owner action required to activate:** open CLA Assistant, select "Sign in with GitHub", personally review and approve its GitHub OAuth permissions, and if prompted install its GitHub App with access to **Only select repositories → archahmedzaki/YourHand-Community**. Do not authorize access to the original private YourHand repository or all repositories. In the service dashboard, select `archahmedzaki/YourHand-Community` and link the public CLA Gist above. The owner must accept the third-party terms and data sharing; never provide a GitHub password, OAuth token or personal ID in repository comments or to an assistant.

Once the Gist is linked, create an isolated test PR from a **different GitHub account** that has not signed: the CLA Assistant check must fail or be pending and solicit acceptance. Have that test contributor read and affirmatively sign, then verify its status becomes successful. On the same PR, verify existing `Node 24 source and privacy`, `Independent source secret scan` and code-owner review rules remain required. **Only after the status name and successful unsigned/signed test are observed**, add the real CLA Assistant status as a required branch-protection check. Do not guess the app's context name or set a hypothetical check that cannot run.

## Corporate and rights-holder review

An individual GitHub account cannot grant rights belonging to an employer, agency or co-author. Corporate-owned contributions require an executed, separately authorized [corporate CLA/permission](CLA_CORPORATE_DRAFT.md) with the right legal entity and an independently verified representative; this document remains a **draft**, not a complete corporate signing form. The maintainer must privately validate the employer's rights before merging, even when CLA Assistant reports a successful individual consent. The signature service's status is evidence of click-through acceptance, **not** independent verification of employment ownership, legal identity, or legal effectiveness in every jurisdiction.

## Current fail-closed policy

Until the owner completes the service authorization and verifies a signed/unsigned PR test, **do not merge external code contributions or advertise that automated CLA signing is active.** GitHub's existing `main` protection requires a code-owner review and passing CI checks; administrators can bypass, so the owner must also refrain from manually bypassing the rights gate. Public issue #2 must stay open until real end-to-end signature enforcement and corporate checks have been demonstrated.

Never edit an agreement silently after users have signed. Publish a new version and obtain new explicit acceptance when terms change. Do not publicly disclose signature archives, contributor legal identities, employer letters or confidential patent information.
