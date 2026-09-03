# CLI 0.2.10 release hardening evidence

Date: 2026-09-04

This is local candidate evidence only. It does not authorize or record a push,
tag creation, workflow dispatch, environment approval, npm publication, or
dist-tag change.

## Source boundary

- Baseline and remote `main`: `002f1f7cfdf33eec3e18d274cb9efeb22527b9dd`.
- Baseline tree: `c1f87305ae4a3bbba56d391490cce53efc4b9e16`.
- Release package: `bharatcode@0.2.10`; rollback version: `0.2.9`.
- `cli-v0.2.10` did not exist and npm version `0.2.10` returned 404 at
  verification time. npm `latest` remained `0.2.9`.
- GitHub returned zero repository rulesets. No external setting was changed.

## Live environment controls observed read-only

- `npm-next`: required reviewer `Pankaj-IIT`, self-review prevention enabled,
  administrator bypass capability enabled.
- `npm-latest`: required reviewer `satyamlohiya`, self-review prevention
  enabled, administrator bypass capability enabled.

The candidate does not treat the ability to start an environment job as review
evidence. In the same shell step as each irreversible npm command, it retrieves
the exact workflow run, run-scoped approval history, source commit, tag ref, and
annotated tag object from GitHub. The command remains blocked unless the review
history has exactly one explicit `approved` record for only the current
environment and exact assigned reviewer, with no initiator/source self-review.

## Test-first evidence

The initial scoped run failed because the new approval, tag, smoke-receipt, and
workflow gates did not exist. After implementation:

- Release contract and workflow tests: 50/50 pass, including an ambiguous
  publish-failure regression that requires always-run gate-receipt retention
  without suppressing the failed npm command.
- Full package tests: 64/64 pass under Node 22.18.0.
- Exact package harness: pass under pinned npm 10.9.2 materialized in a
  disposable directory with Bun, because the host `/usr/bin/npm` installation
  was missing its own `semver` dependency.
- Local package smoke: npm packed exactly 10 files, installed the generated
  `bharatcode-0.2.10.tgz` into a clean prefix, reported CLI version `0.2.10`,
  emitted canonical default/provider config, rejected the retired Q6 and Q8
  models through both plugin and CLI argument paths, made zero behavior-time
  network calls, and left sentinel credentials byte-identical.
- Workflow lint with checksum-verified actionlint 1.7.12, YAML parse, and
  `git diff --check`: pass.

The local harness proves the post-publish smoke program against the candidate
tarball. The workflow's real-registry installation cannot execute before
`0.2.10` is published to `next`; it is deliberately in `publish-next` and must
complete before `npm-latest` becomes eligible for review.

## Preserved release properties

- The admitted tarball is packed once, hashed, attested, and reused for the npm
  publication.
- The published registry tarball must match that SHA-256 and its registry
  integrity is retained.
- The registry smoke receipt is bound to tarball SHA-256, registry integrity,
  run ID, first run attempt, source SHA, release tag, and admitted tag-object
  SHA; the `next` receipt is bound to the smoke-receipt SHA-256.
- Existing-version publication remains fail closed. `latest` must still be
  `0.2.9` before promotion and the `0.2.9` package remains verified afterward.
