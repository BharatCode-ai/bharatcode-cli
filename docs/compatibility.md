# BharatCode CLI Compatibility

BharatCode uses the OpenCode engine for local coding sessions. OpenCode is an upstream runtime dependency, not the public product name users should have to choose during setup.

## What BharatCode Owns

- npm package name: `bharatcode`
- CLI binary: `bharatcode`
- provider id loaded into the local engine: `bharatcode`
- provider display name: `BharatCode`
- user setup: `bharatcode .` and browser OAuth
- model endpoint: `https://bharatcode.ai/api/model/v1`

## Why OpenCode Still Appears In Technical Paths

The current CLI launches the upstream engine binary from the `opencode-ai`
package and writes the provider entry into the upstream config file:

```text
~/.config/opencode/opencode.jsonc
```

Those names are compatibility details. User-facing setup should refer to
BharatCode first and only mention OpenCode when explaining the runtime
dependency or troubleshooting a config path.

## Release Rule

Do not publish a BharatCode CLI release that makes users pick an API-key
provider path. Public beta users authenticate through BharatCode OAuth, and the
CLI refreshes the session before model requests.
