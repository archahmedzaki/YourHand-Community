# Release process

Maintainers use this checklist for every public update. **Publishing source documentation is not the same as approving or deploying a production installer.**

## Before merging

- Compare against the intended public source branch; never merge private operational Git history, production configuration, or customer logs.
- Review new files, hidden files, binary assets, generated artifacts, licenses, tool descriptions and tests; confirm that contributors have completed the finalized, legally reviewed CLA before any external code is merged.
- Run `npm ci`, `npm test`, `npm run test:privacy` and independent secret scanning on the staged tree **and** the Git objects/refs about to be pushed.
- Verify account/device isolation, privacy handling, and any new mutating tool's authorization/confirmation/replay semantics.
- Check that the affected docs, changelog and roadmap accurately reflect what is implemented, tested and merely planned.

## Source preview release

Create a reviewed PR, obtain maintainer approval, merge with clean history, verify actual public GitHub tree and readme from an unauthenticated session, then publish a descriptive release note with limitations. Do not attach binaries that have not passed artifact and provenance checks.

## Windows installer or stable release — additional gates

Independent disposable-Windows build; unsigned vs signed artifact policy; source-to-binary provenance; end-to-end pairing and account isolation; approved native GUI/UAC behavior; remote reconnect/session preservation; rollback; vulnerability review; exact public build manifest; setup/uninstall tests; source and dependencies' license notices. **No release is production-ready before all these pass and the maintainer approves it.**

## Incident response

If an actual secret or customer data reaches GitHub, stop the publishing pipeline, revoke/rotate affected credentials and assess unauthorized access. Deleting the string from a later commit is insufficient because Git history, caches and forks may persist. Coordinate redaction, incident communications and restoration with affected rights holders. See [SECURITY.md](../SECURITY.md).
