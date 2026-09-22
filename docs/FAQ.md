# Frequently asked questions

### Is YourHand free or open source?

This repository distributes the community source under AGPL-3.0-only. You may use the source under that license's conditions. The independently hosted official service may have different access/billing terms; this public repository does not include a hosted-service entitlement.

### Does the GitHub repository provide a ready-to-install Windows application?

No. This is a **source preview**. A signed, prebuilt customer installer and enrolled Agent are not included. Source-level development and native build steps are in [Development setup](DEVELOPMENT_SETUP.md).

### Can I connect this source directly to ChatGPT?

Not automatically. You need your own secure, correctly configured MCP deployment, account authentication, device enrollment and compatible client access. Approval or listing in any third-party app directory is separate and not guaranteed.

### Can I use someone else's device if I know its name or device ID?

No. An owner must pair the device or explicitly grant access; the Core must authorize every action for the signed-in account. Never attempt unauthorized access.

### Why do GUI actions sometimes need local help?

Windows protects certain desktop contexts, including UAC and Winlogon. The authorized local user must handle those prompts; YourHand does not support credential collection or bypass.

### Can I run many tasks at once?

Some independent background work may run concurrently, but multiple UI actions on one interactive Windows desktop can conflict. Device/session locking, permission checks and outcome tracking are mandatory.

### Can the maintainer use my contribution in the commercial edition?

Only to the extent the correct rights holder grants suitable non-exclusive proprietary sublicensing permission. An [individual CLA v1.1](../CONTRIBUTOR_LICENSE_AGREEMENT.md) has been adopted by the project owner, but **the external signing flow is not connected or tested and no outside code is accepted for merge yet**. Company-owned work also needs employer authorization. See [CLA FAQ](CLA_FAQ.md).

### Can I donate any amount?

Yes, optional donor-selected support is planned. There is no verified live PayPal link in this repository yet. Do not send money to unverified links from comments or forks.

### Where can I report problems?

Use sanitized [GitHub Issues](https://github.com/archahmedzaki/YourHand-Community/issues) for non-sensitive reports. See [Security](../SECURITY.md) for private vulnerability reporting.
