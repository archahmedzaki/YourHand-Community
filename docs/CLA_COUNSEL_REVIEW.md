# Contributor agreement — legal review and activation gate

**Status: PREPARED FOR COUNSEL; NOT A QUALIFIED LEGAL OPINION OR EXECUTED AGREEMENT.** External code contributions must remain unmerged until the appropriate copyright owners sign approved terms, and all separate third-party licenses are respected.

## Documented intended terms

The [individual CLA draft](../CONTRIBUTOR_LICENSE_AGREEMENT.md) grants a **non-exclusive** broad copyright license to Ahmed Zaki for original contributions, including reproduction, modification, public AGPL distribution and separately licensed proprietary/commercial distribution and sublicensing. Contributors retain their copyright and can independently use their original work. A patent-license grant is proposed separately and limited to necessarily infringed contributor-controlled claims, subject to review of enforceability and retaliation. An employee who lacks ownership cannot license employer-owned works; a [corporate rights-holder agreement draft](CLA_CORPORATE_DRAFT.md) is provided for authorized corporate signatories.

A CLA is not a copyright assignment and cannot transfer rights in independent third-party code or dependencies. It does not retrospectively remove the AGPL rights of people who already received AGPL-covered versions. Open-source publication, separate commercial licensing and third-party license compatibility must be checked **for each assembled distribution**.

## Lawyer decision points before collecting signatures

1. **Identified recipient and capacity:** establish the correct full legal name, address/service contact and whether Ahmed Zaki is the individual licensor or acts for a registered company; identify successors and any required corporate formalities.
2. **Jurisdiction and dispute mechanism:** choose applicable law, venue or arbitration appropriate for an Egypt-based owner working with international contributors; validate mandatory employee/inventor, moral-rights and copyright requirements in relevant jurisdictions. Do not assume any chosen venue overrides mandatory law.
3. **Individual and company authority:** distinguish individual-owned work, work made for hire, employer-owned work and work submitted by an authorized representative of a corporate rights holder. Verify authority; a GitHub handle or checkbox cannot by itself license an employer's code.
4. **Copyright grant:** verify explicit permissions for proprietary closed-source use, sale, sublicensing, distribution, network hosting, derivative works, and successors while contributors retain ownership. Confirm irrevocability to the extent permitted by applicable law, warranties and statutory rights.
5. **Patent grant:** confirm exact covered patents, rights to sublicense in proprietary products, defensive termination, treatment of downstream recipients and any patent exclusions.
6. **Third-party materials:** document original work vs imported code and compatibility of licenses, generated contributions, code with client confidentiality, export/privacy conditions, and notices.
7. **Evidence and privacy:** select the actual electronic-signature product and review its contracts, data processing terms, identification assurance, lawful evidence of assent, retention, security and rights-holder records. Signing records should not expose personal email, employer data or signatures publicly. Define the CLA version by immutable SHA-256 and timestamp; require re-consent for material changes.
8. **Final authorization:** qualified counsel reviews and approves the exact final individual and corporate texts **before** enabling their signature URL, and repository owner approves any third-party app access. Record signed agreement provenance and check applicable rights **before merging each outside contribution**.

## Technical intake state

The active GitHub Actions workflow can check source tests and secret patterns. A further fail-closed rights gate may block third-party PRs pending legal approval. That gate is **not** a signature, contract or substitute for a verifiable signer service. The current repository owner can bypass branch rules; no workflow can certify that no human ever bypasses it.

## Public references for counsel

- Apache Foundation individual and corporate CLA explanation: https://www.apache.org/licenses/contributor-agreements.html
- Apache Individual CLA (copyright, patent and authority example): https://apache.org/licenses/icla.pdf
- GNU GPL/AGPL interpretation: https://www.gnu.org/licenses/gpl-faq.html.en
- GitHub CLA Assistant app (third-party operated): https://github.com/apps/cla-assistant
- GitHub branch protection limitations: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
