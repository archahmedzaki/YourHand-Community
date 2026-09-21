# Planned contributor-signing workflow

**Not active. Do not collect signatures against the unfinished CLA drafts.** External contributions are welcome for discussion in issues; merge of outside code is on hold pending the recorded legal approvals and signing infrastructure.

### Selected integration path (pending review)

GitHub's third-party [CLA Assistant app](https://github.com/apps/cla-assistant), operated by SAP, can authenticate GitHub contributors, present a versioned agreement on PRs, record consent and set a contribution status. The repository owner must review the app's requested permissions, privacy policy, data retention and service terms **before installing it**. The app's check reports agreement acceptance, but cannot independently confirm an employee's authority to license employer-owned work or the legal sufficiency of an electronic signature in every jurisdiction.

After qualified legal review of the *exact* individual and corporate agreements, publish the approved text under a versioned, immutable reference and calculate its SHA-256. Configure the CLA Assistant repository mapping and its GitHub PR status with appropriate signatory details. Treat employee-owned and employer-owned source separately: require an authorized entity signature wherever necessary, with private authorization evidence. Test an unsigned external PR (must fail), a valid signed individual PR (may proceed to provenance review), a corporate-owned contribution without corporate signatory (must fail), and a substantive CLA update (must require renewed signing where applicable).

Then require the verified CLA status as a third branch-protection check and retain the existing source/privacy and independent secret-scan checks. **Do not remove the interim external-PR legal hold or announce intake until all these gates have been verified and authorized.** Administrator bypass remains a separate, auditable owner responsibility.

No CLA forms, private legal identity documents or signing records belong in the public repository or customer database. No app must have access to the original private operations repository.
