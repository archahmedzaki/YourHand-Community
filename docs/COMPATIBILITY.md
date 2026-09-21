# Compatibility and support matrix

This is a **source-preview matrix**, not a promise that every tool works on every supported product.

| Component | Status | Notes |
|---|---|---|
| JavaScript Core, source-level unit checks | Included | Node.js 24+ recommended for the current source and `node:sqlite` |
| Web dashboard source | Included, lab configuration required | Google OAuth and HTTPS origin must be configured independently |
| MCP HTTP gateway source | Included, unverified public deployment | Client tool availability and final per-tool approval are client-dependent |
| Windows Agent source | Included, standalone enrollment not packaged | Requires authorized device pairing and a separately built distribution |
| Windows native UI helper | Source and build script included | Windows .NET Framework/UIAutomation prerequisites, independent GUI lab test |
| GitHub Actions CI | Active; both source/privacy and independent secret-scan jobs passed | [Workflow](../.github/workflows/ci.yml) runs on pushes and pull requests to `main`; real Windows GUI and installer acceptance are separate |
| macOS/Linux device Agent | Not published as a supported Agent here | Core CI on Linux does not imply Linux desktop support |
| Signed Windows installer | Not included | Requires reproducible build, provenance and actual device acceptance |
| Hosted YourHand service | Separate from this repository | Public source is not proof of hosted version or entitlement |
| Official app/plugin directory listing | Not asserted | Submission, verification and approval are separate |

For practical instructions see [Development setup](DEVELOPMENT_SETUP.md) and [Project status](PROJECT_STATUS.md).
