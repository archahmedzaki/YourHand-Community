# MCP integration and device access

The Core exposes MCP tools for authorized device workflows. Availability and exact permissions depend on the server build, installed Agent capabilities, user authorization and ChatGPT/client product support. This source release does **not** guarantee listing approval in any third-party marketplace.

## What tools may do

The source registers multiple groups of operations: device discovery and status; account-scoped device locks; desktop observation and native UI interaction; browser navigation and interaction; filesystem reading/writing; process management; and task/operation status. **Not all tools are read-only.** Direct shell/process actions and browser interactions may have external side effects even when framed as observation.

## Identity and ownership

Authenticate with an account explicitly entitled to a paired device. Only the device owner or an appropriately authorized operator should be able to trigger a mutating action; a viewer role must not inherit write/control rights. A device ID copied from someone else's account is not an authorization token.

The source implements an OAuth-capable Core. To test an independent deployment, configure your own Google OAuth client, public origin and secure token storage, and use disposable accounts. Follow [Development setup](DEVELOPMENT_SETUP.md); a public marketplace registration is a **separate review process**.

## Safe operation rules

1. Confirm the target device, user and action scope. Do not attempt to observe another person's machine without authorization.
2. For destructive or irreversible operations, seek suitable confirmation and maintain an auditable operation identifier.
3. Treat a timeout during a state-changing task as **outcome unknown**. Do not blindly replay clicks, payment actions, file deletions, deployments or shell commands.
4. Never retrieve credentials, bypass protected Windows desktops, or move private customer data into a public issue or prompt.
5. Different UI tasks on one interactive Windows desktop can interfere with one another. Shared-device concurrency is **not** the same as isolated desktop sessions.

For the current runnable subset, release limitations and integration test status, consult [Project status](PROJECT_STATUS.md) and [Threat model](THREAT_MODEL.md).
