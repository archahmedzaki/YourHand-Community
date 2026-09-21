## Summary and motivation

Describe the change and link to a sanitized public issue. Do not include private environments, real devices, customer data, auth tokens or production logs.

## Implementation and scope

Explain which files/components change, whether any operation can mutate device state, and how ownership, authentication, consent and unknown-outcome handling remain correct.

## Verification

- [ ] I used synthetic data and a disposable device/environment only.
- [ ] `npm ci` and `npm test` pass in a clean checkout.
- [ ] `npm run test:privacy` passes; no secrets or customer/device identifiers appear in the PR, history or binaries.
- [ ] I added or updated relevant unit tests and documentation.
- [ ] I reviewed third-party licenses and retained upstream notices where applicable.
- [ ] I did not introduce a pre-enrolled installer or production device/credential configuration.

## Contributor rights — required before merge

**Important:** The maintainer intends to use eligible contributions in both AGPL community and separately licensed commercial versions. The current [non-exclusive CLA is a draft](../CONTRIBUTOR_LICENSE_AGREEMENT.md), not an active agreement. **An unchecked or checked box here does not constitute legal signing.** Do not merge an external code PR until a finalized, legally reviewed CLA is separately signed by the correct copyright holder and verified by the maintainer. An employee may need an authorized company signer. Third-party rights still apply.

- [ ] The maintainer has separately verified the finalized agreement and contribution provenance (maintainer-controlled; do not post signature or personal information publicly).
