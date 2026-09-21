# Threat model

This document captures **design threats and intended controls** in a source preview. It does not certify that a deployed build is secure or independently penetration tested.

## Protected assets

User account identity, OAuth/session tokens, device enrollment keys, pairing records, desktop contents, files, action history, system commands, customer information and availability of each customer's connection.

## Trust boundaries

- **MCP client → Core:** client input is untrusted until authentication and explicit authorization establish a valid user/device scope.
- **Account → device:** the user's ability to reference a device ID or a share invitation must not grant access to unowned data.
- **Core → Agent:** requests and replies need authenticated device identity, request correlation and replay protection.
- **Agent → operating system:** GUI, browser, processes and filesystem may affect real user assets; the OS security boundary and local user consent remain authoritative.
- **Private development → public source:** source publication must never include live databases, secrets, device keys or private repository history.

## Example attacks and expected handling

| Threat | Required mitigation and evidence |
|---|---|
| Cross-account device ID guessing | Authorize on every request, not only when listing devices; add negative tests |
| Replaying a timed-out mutating command | Durable operation ID, result reconciliation, no automatic blind retry |
| Prompt-injection content on screen or website | Treat observed screen/page content as data, not instructions granting new permissions |
| Leaked enrollment tokens or OAuth credentials | No secrets in source, logs, issue templates or screenshots; use expiry/revocation |
| Broad shell and filesystem capabilities | Account/device checks, user authorization and least privilege; do not label mutating tools read-only |
| UAC/Winlogon takeover | Never capture credentials or bypass protected desktops; require local consent |
| Multiple agents or desktop sessions competing | Device/session isolation and bounded locks; prevent cross-session write conflicts |
| Public GitHub contribution including secrets | Mandatory pre-push pattern checks and human review; GitHub Actions CI and repository secret scanning still require separately verified activation |

## Remaining work

Independent penetration testing, deployment hardening, full per-tool metadata review, public vulnerability handling, signed artifact provenance and tested recovery paths are release gates. See [Security policy](../SECURITY.md) and [Release process](RELEASING.md).
