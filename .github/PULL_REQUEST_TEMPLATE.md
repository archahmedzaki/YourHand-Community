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

**Important:** The maintainer adopted an [individual non-exclusive CLA v1.0](../CONTRIBUTOR_LICENSE_AGREEMENT.md) covering AGPL and separately licensed commercial/proprietary YourHand editions. **External signing is not active yet:** the GitHub CLA Assistant account authorization, repository linkage and signed/unsigned PR tests remain pending. A PR checkbox is not signing. External contributions must not be merged until the authenticated signer check is operational, the correct legal rights holder has accepted the agreement, and employment/third-party ownership has been reviewed. An employee may need separate corporate permission. The agreement has not been independently certified by a lawyer; consult [current signing status](../docs/CLA_SIGNING_SETUP.md).

- [ ] The maintainer has separately verified the applicable signed individual v1.0 acceptance, any required corporate rights-holder authorization, and source provenance in private records (maintainer-controlled; do not post signature or personal information publicly).
