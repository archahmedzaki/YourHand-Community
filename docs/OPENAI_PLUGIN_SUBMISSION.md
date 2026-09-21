# OpenAI public Plugins Directory — YourHand submission packet

**Status (2026-09-21): preparation only; NOT submitted, approved, or published.** This file is an operator checklist, not a representation of OpenAI endorsement or marketplace availability. The Community checkout is a source preview and is **not** the hosted production service (see [PROJECT_STATUS.md](PROJECT_STATUS.md)). Do not publish the Community lab instance or deploy it over the live customer service.

## Official route (not GitHub publishing)

Submit a **With MCP** plugin from the OpenAI Platform plugin submission portal: https://platform.openai.com/plugins . It needs a single stable public HTTPS MCP endpoint. OpenAI separately reviews the submission; an approved developer must then select **Publish** for the plugin to appear in the shared ChatGPT/Codex directory. A GitHub release or a privately connected MCP app is not a public marketplace listing.

Official requirements: https://developers.openai.com/plugins/deploy/submission and https://developers.openai.com/plugins/deploy/app-review . Recheck the requirements at the actual submission date.

## Public listing copy — DRAFT, verify against the production build

- **Name:** YourHand
- **Short description:** Connect ChatGPT to Windows computers you have authorized, then inspect and interact with them through YourHand.
- **Long description:** YourHand connects a signed-in account to its authorized Windows devices through a hosted MCP service and locally installed Windows Agent. Find your connected devices, view permitted status or desktop information, and use available computer, browser, file or process tools within the permissions granted for that device. Computer actions can change files, software, and online accounts. Users must pair and authorize their own devices; access to another user's machine is not implied. Availability depends on the installed Agent, device connectivity, role, and ChatGPT surface. This listing must not promise unlimited usage, background execution, guaranteed availability, or capabilities not verified on the production build.
- **Publisher:** Ahmed Zaki **only after the matching individual identity is verified** on the OpenAI Platform; do not substitute an unverified company name.
- **Logo:** Review the actual project artwork at `web/YourHand_256.png` and prepare a platform-compliant export; do not substitute a generated mark.
- **Website / support / privacy policy / terms:** UNSET — must point to *live, public, product-specific* pages under a domain controlled by the verified publisher. Repository architecture notes are not a substitute for a hosted-service privacy policy or terms.
- **Category, supported countries and prices:** UNSET — choose only from supported portal options after confirming legal/commercial availability. Never state that the Community source preview includes paid service access.
- **Suggested starter prompts:** “Show my connected devices and their current status.” “Check whether my authorized Windows computer is online.” “Take a screenshot of my selected computer after I select it and authorize access.” “List the files in a folder on my computer that I own.” “Open an application on the selected computer after confirming the target and intended action.”

## Reviewer fixtures / reproducible tests

Use **only disposable Windows test machines and synthetic test accounts**. The reviewer must be given a working test login with no required MFA, email link, SMS, private network, or user-provided hardware. Keep any credentials **only in the private submission portal**, not in GitHub. Provision two accounts (owner A and stranger B); register one disposable device to A. Give the reviewer the matching isolated production-compatible Agent, install instructions, and a reachable test device. Record exact API/tool names and expected output schema from a live authenticated tool scan; avoid fictitious examples.

| ID | Prompt or situation | Expected outcome | Test data |
| --- | --- | --- | --- |
| P1 | “List devices connected to my YourHand account.” | `list_devices` returns **only A's** enrolled test device(s), including online status where supported. | Owner A; connected test device. |
| P2 | “Check whether my test PC is online.” | `ping_device` targets the selected, authorized device; successful status or an explicit offline error, never an invented result. | Owner A; named test device. |
| P3 | “Show system information for my test PC.” | `get_system_info` returns available OS/runtime facts only for the authorized selected device. | Owner A; connected test device. |
| P4 | “List the files in my disposable test folder on that PC.” | `list_directory` returns only the expected synthetic filenames without unrelated account/device content. | Owner A; test folder containing a few dummy files. |
| P5 | “Take a screenshot of the disposable test desktop.” | `screenshot` returns current device-screen content **only if the account and device role permit observation**; no other user's desktop and no protected desktop bypass. | Owner A; unlocked disposable test desktop displaying non-private test text. |
| N1 | B requests A's device by copied ID or name. | No device data, screenshot, or computer command is exposed or executed. | Stranger account B; A's device ID. |
| N2 | Viewer role requests a modifying computer/file/process command. | Access denied; role cannot escalate through a generic `call_device_tool`, `computer_execute`, or nested/batch path. | A test viewer invitation; dummy file. |
| N3 | Reviewer asks for a destructive step or tries to repeat a timed-out irreversible action without confirming the prior outcome. | Require appropriate review/confirmation and operation status; never blindly replay the ambiguous step or bypass permission checks. | Dummy action in an isolated test environment. |

The P/N entries are **test specifications, not claims of passing results**. Before submission, capture the actual trace, result schema, screenshots (if appropriate), negative-test denial, timestamp, and build identifier for each case in a **private** evidence location. No customer content or credentials in the public repository.

## Pre-submission gates — DO NOT ATTEST UNTIL VERIFIED

- [ ] Verify the live hosted **production** code version, not just the Community `main` source snapshot, and test the end-to-end journey from sign-in to authorized Windows Agent to MCP tool result.
- [ ] Public stable HTTPS `/mcp` endpoint reachable without IP allowlists/VPN and with working MCP initialization / `tools/list`; verify domain control and use the exact portal-provided token at `/.well-known/openai-apps-challenge`. Never publish the challenge token here.
- [ ] End-to-end secure OAuth per user and account: discovery, protected-resource metadata, expected resource/audience and token expiry/revocation; users must never inherit the publisher's devices. If workspace domain restrictions are supported, provide `openid`/`email` scopes and an appropriate UserInfo endpoint.
- [ ] Provide honest descriptions, input and output schemas and **all three** accurate MCP annotations (`readOnlyHint`, `openWorldHint`, `destructiveHint`) for **every** exposed tool. Dynamic generic computer, shell, browser and batch tools can have internet-facing and irreversible effects; avoid labeling them as harmless read-only actions. Audit nested calls, prompt injection and action approvals.
- [ ] Confirm that screenshots, files, tool responses, errors, telemetry and OAuth metadata never leak secrets, cross-account data or irrelevant identifiers; document storage, deletion, retention and processors in a product-specific public privacy notice.
- [ ] Publish working website, support, privacy, terms and a logo reviewed against the actual brand, with publisher identity/ownership verified by OpenAI.
- [ ] Provide isolated, accessible reviewer account and disposable Windows machine with real Agent installation, pairing, consent and full P1–P5/N1–N3 execution evidence; do not supply an internal-only endpoint.
- [ ] Confirm the plugin submission portal is accessible to the publisher with **Apps Management: Write** and appropriate individual/business verification.
- [ ] Fill Info, MCP, Scan Tools, Prompts, Testing, Global and Submit in the portal; only check policy attestations supported by evidence. Record the portal's submission ID/status privately.
- [ ] After approval, use **Publish** in the portal and verify the public YourHand listing and a new-user install/connection. An approved draft alone is not a published plugin.

## Observed blockers at packet creation

The public Community release explicitly identifies the Windows installer, production OAuth/HTTPS E2E, and marketplace approval as unverified. The source tool declarations audited on 2026-09-21 contain `readOnlyHint` values, but **many do not set `openWorldHint` or `destructiveHint`**; these need a truthful production-tool-by-tool review. The OpenAI Platform portal in the VPS's isolated Chromium session showed a **login page**, not an authenticated publisher console. This packet does **not** claim that production is broken or that no separately deployed YourHand service exists. No customer service was modified or interrupted to prepare it.

**Action owner:** publisher/account owner must complete interactive OpenAI sign-in and identity verification; engineering must separately verify and remediate hosted-service readiness. Submission and public publication are separate actions.
