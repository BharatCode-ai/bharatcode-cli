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

Publishing is intentionally explicit and fail-closed:

1. Review the exact source SHA, then create the immutable `cli-v0.2.10` tag at
   that same commit while it is still the exact `main` head.
2. Dispatch `Publish npm package` with that exact SHA and tag. Re-runs are
   rejected rather than replaying a partially completed publication.
3. The token-free build job tests, audits, inspects, packs, hashes, and attests
   the exact tarball once.
4. The protected `npm-next` job publishes that tarball to `next`, downloads it
   from the real registry, and verifies its SHA-256 and registry identity.
5. Only the separately protected `npm-latest` job can move the same version to
   `latest`, after revalidating the closed next-stage receipt. Version `0.2.9`
   remains available as the rollback version.

`NPM_TOKEN` is exposed only to the two mutation steps. The workflow does not run
on pushes or GitHub Release events and cannot overwrite an existing version.
