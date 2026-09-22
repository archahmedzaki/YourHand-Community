# Independent Community loopback lab — 2026-09-21

## Purpose and boundary

A fresh clone of the **public** YourHand-Community source was tested in a separate lab directory on a Windows machine. The work did **not** use the live hosted service, the original private repository, customer databases, installed Agent identity or real devices/accounts. The script created an isolated SQLite database, synthetic test.invalid user sessions, separate Ed25519 device keys and unused ephemeral **loopback-only ports**; all spawned lab Node/Core/Agent process trees were terminated on completion.

## Evidence and results

**18 of 18 defined lab checks passed** for public source commit `494b7bf`. The lab cloned source, installed cached npm dependencies without lifecycle scripts, compiled the native C# helper, started isolated web/Agent/Core services, verified anonymous access rejection, created a disposable account pairing code, verified that the unsigned bundle is **not** available, enrolled an independently keyed synthetic device and confirmed one-time pairing semantics. A real public-source Windows Agent authenticated to the isolated Core through an Ed25519-signed WebSocket challenge and successfully returned a read-only command-channel ping. A second synthetic account could not list or probe the owner's device. The owner then revoked the device and it disappeared from the owner's device list.

The local machine generated one initial unsuccessful test run due to a test-harness input mix-up: the harness supplied a pairing **code** in the `token` field intended for a distinct installer token. The corrected lab harness supplied the code in the `code` field; all 18 checks then passed.

## Confirmed limits: this is **not** a full customer-install success

1. The customer installer endpoint returned **HTTP 503** as expected: this community source does not ship the Agent runtime ZIP and a separately compiled GUI manager binary required by its generated Windows installer.
2. The Google web-login callback was **not tested** using real Google credentials. The lab seeded two synthetic account sessions directly in its temporary SQLite database. A production OAuth client, approved redirect origin and actual identity-consent flow are separate prerequisites.
3. The real-source Agent and native helper were tested through a signed device session and **read-only ping** only. No real desktop GUI automation, arbitrary filesystem mutations, payments, customer accounts, network exposure, production installer execution, upgrade or rollback took place.
4. At the original lab commit, the generated setup targeted the official `%LOCALAPPDATA%/YourHand` path, so it was never executed. **Later Community source changes use `YourHandCommunity` as a separate root** and configure the dashboard origin from the Community Core. An actual clean installation, upgrade, rollback and uninstall on an isolated disposable Windows host are still required; do not execute the earlier test binary.
5. A disposable Windows sandbox/VM and independent test OAuth app, third-party notice/provenance review, signed release pipeline and clean install/uninstall validation remain required before a production-ready Community binary may be advertised.

**2026-09-22 addendum:** An independent unsigned Agent ZIP generated from the previously audited source contained **3,687 files** and passed the ZIP integrity/CRC check without enrolled keys or production DB files. A separate loopback Core then passed **6/6** scoped HTTP checks: synthetic pairing, unsigned bundle delivery, invalid SHA rejection, unauthenticated setup denial and authorized generation/download of a Windows Setup executable. That file was **not run or installed**. A subsequent Community code change isolates the setup/manager root and registry entries from the official app, and removes private Core env/database fallbacks; a C# manager/Setup compile and source isolation test passed. The initial 18/18 lab test was performed on the earlier source snapshot, not an installed binary. The current full standalone install/uninstall, Google OAuth and customer desktop operation remain **UNVERIFIED**.

**Conclusion:** The isolated identity/authorization/device protocol passed the defined lab tests. A standalone downloadable customer application has **not** passed end-to-end acceptance; see [Project status](PROJECT_STATUS.md) and [Release process](RELEASING.md).
