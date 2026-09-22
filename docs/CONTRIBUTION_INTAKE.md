# Contribution intake — maintainer checklist

1. Confirm ownership and provenance. If work was written as part of employment, obtain the legal rights-holder's authorized consent; a personal GitHub sign-in alone is insufficient.
2. Before merging an external PR, verify acceptance of the exact owner-adopted individual CLA v1.0 through an authenticated signing service and any additional authorized rights-holder agreement required; record signer, legal name or entity, GitHub account, agreement version, timestamp and PR/commit references in a restricted access record. Do not post signatures or private personal information in a public repository.
3. Do not treat a GitHub DCO sign-off alone as a replacement for the specific proprietary sublicensing grant YourHand needs; a DCO is not this CLA.
4. Run secrets/privacy/license checks and synthetic tests on an isolated branch; review hidden files, binary metadata, diffs and Git history before any public commit.
5. Document whether each accepted file is (a) maintainer-owned, (b) covered by a finalized CLA, or (c) inbound third-party under its separate license. Reject unauthorised third-party AGPL-only patches from the proprietary branch.
6. Keep the public AGPL release and production edition separate and check the license rights of the *whole assembled edition*. A private fork of public AGPL without separate rights may still carry AGPL network-source obligations.
7. Accept no public contributions until signing enforcement and review are operational; explain this transparently in issue and pull-request templates.
