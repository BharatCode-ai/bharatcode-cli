# npm release review authority

The protected npm publication environments use distinct human reviewers. This
assignment does not authorize publication by itself.

- `npm-next` requires approval from `Pankaj-IIT` after reviewing the exact
  source SHA, workflow run and attempt, package digest, provenance, tests, and
  registry rollback state.
- `npm-latest` requires a separate approval from `satyamlohiya` after reviewing
  the immutable `next` receipt and confirming that the exact tested version is
  the version being promoted.

GitHub environment protection has `prevent_self_review` enabled for both
stages. An administrator bypass is not accepted as review evidence. Immediately
before either npm mutation, the workflow queries GitHub's authoritative
workflow-run review history and requires exactly one `approved` record naming
only the current environment and its assigned reviewer. A missing record, a
bypass state, a different actor, a multi-environment record, or a duplicate
record blocks the stage even while the live environments allow administrators
to bypass their protection rules. The
initiator, source author, and required reviewer must be recorded; the reviewer
must not be the initiator or approve their own deployment. Approval for
`npm-next` cannot be reused for `npm-latest`.

For each stage, GitHub retains the authoritative review history and the workflow
retains a canonical gate receipt with the exact repository, environment,
reviewer login, source SHA, workflow path, run ID, run attempt, validation time,
tag-object SHA, and package or `next`-receipt SHA-256. Missing, bypassed,
mismatched, self-approved, or replayed review evidence keeps that stage blocked.

The release tag must be an annotated tag object named `cli-v0.2.10` that peels
directly to the exact reviewed source commit. Admission records the tag-object
SHA, and both irreversible stages re-fetch the tag ref and object immediately
before their npm command. Deletion, replacement, a lightweight tag, a nested
tag, or a different peeled target blocks the release. As verified on 2026-09-04,
no tag ruleset is currently configured for this repository; the runtime checks
are therefore mandatory and no repository setting was changed as part of this
hardening work.

After publication to `next`, the workflow installs exact version `0.2.10` by
name from `registry.npmjs.org` into a clean temporary prefix. The separately
downloaded registry tarball is checked against the pack-once SHA-256, while npm
checks the registry integrity during installation. The registry-installed
behavioral smoke checks `bharatcode --version`, the canonical default/provider
configuration, rejection of both retired Q6/Q8 model IDs, zero behavior-time
network calls, and unchanged isolated credentials. Its canonical receipt is
bound to the registry tarball SHA-256 and integrity plus the workflow run,
attempt, source SHA, release tag, and admitted tag-object SHA. `npm-latest` is
not eligible for review until this smoke and the bound `next` receipt complete.

Desktop prerelease review is separately assigned to `Pankaj-IIT` in the
Desktop repository's `desktop-beta-release` protected environment. None of
these assignments permits a workflow dispatch, npm publication, dist-tag
change, Desktop prerelease finalization, or website cutover without the
remaining release gates and an explicit authorized execution.
