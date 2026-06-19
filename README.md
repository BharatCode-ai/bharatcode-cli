# BharatCode CLI

BharatCode CLI lets public beta users start an OAuth-authenticated coding
session from npm. Users sign in with BharatCode once; the CLI refreshes that
session and sends model requests through the BharatCode backend.

## Install

```bash
npm install -g bharatcode
bharatcode .
```

`bharatcode .` opens browser login when needed, stores OAuth credentials in
`~/.bharatcode/credentials.json`, prepares the local BharatCode engine config,
and launches the coding session from the current project.

No user API key is required for the public beta path.

## Common Commands

```bash
bharatcode auth login
bharatcode auth status
bharatcode doctor
```

The repair command `bharatcode opencode configure` is retained for compatibility
with the current upstream engine config file.

## What Is In This Repo

- `bin/bharatcode.js`: BharatCode CLI entrypoint.
- `index.js`: BharatCode provider module loaded by the local engine.
- `lib/`: OAuth credential, CLI argument, and engine config helpers.
- `docs/setup.md`: user setup and troubleshooting.
- `docs/compatibility.md`: runtime compatibility notes.
- `scripts/audit-open-source-readiness.mjs`: package and repo boundary audit.
- `.github/workflows/npm-release.yml`: explicit npm release workflow.

Full setup instructions are in [docs/setup.md](./docs/setup.md).

## Runtime Compatibility

BharatCode currently uses the OpenCode engine as an upstream runtime dependency.
That name can still appear in dependency names and config paths, but public setup
and support should be BharatCode-first.

See [docs/compatibility.md](./docs/compatibility.md).

## Release Path

The npm package is released from this public repository through the
`Publish npm package` GitHub Actions workflow.

Release checklist:

```bash
npm test
npm run audit:oss:repo
npm run pack:check
node -e "import('./index.js').then(m => console.log(typeof m.default, typeof m.BharatCodePlugin))"
```

Publishing is intentionally explicit:

1. Bump `package.json` if the version already exists on npm.
2. Create and publish a GitHub Release such as `v0.2.10`.
3. The workflow runs tests, the public repo audit, package inspection, a dry-run
   publish, then `npm publish --access public --provenance`.
4. Manual `workflow_dispatch` defaults to dry-run mode.

The workflow requires the `NPM_TOKEN` repository secret. It does not run on
ordinary pushes.
