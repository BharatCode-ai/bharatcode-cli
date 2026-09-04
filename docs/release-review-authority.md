# npm release review authority

The protected npm publication environments use distinct human reviewers. This
assignment does not authorize publication by itself.

- `npm-next` requires approval from `Pankaj-IIT` after reviewing the exact
  source SHA, workflow run and attempt, package digest, provenance, tests, and
  registry rollback state.
- `npm-latest` requires a separate approval from `satyamlohiya` after reviewing
  the immutable `next` receipt and confirming that the exact tested version is
  the version being promoted.

GitHub environment protection has `prevent_self_review` enabled for both stages.
For this explicitly authorized 0.2.10 publication, the checked-in gate selects
`owner-admin-bypass-v1` and the exact `shrey16` bypass actor. Immediately before
either npm mutation, the workflow queries GitHub's authoritative workflow-run
review history and requires exactly one `skipped` record naming only the current
environment and that actor. The workflow actor and triggering actor must both be
`shrey16`. A missing or foreign bypass record, a normal approval posing as a
bypass, a different actor, a multi-environment record, or a duplicate record
blocks the stage. There is no generic administrator fallback and absence of a
review record never counts as authorization.

The validator retains the assigned-reviewer contract as a separate mode: when
owner bypass is not explicitly selected, it requires one `approved` record from
the environment's assigned reviewer and enforces initiator/source separation.
Approval or bypass evidence for `npm-next` cannot be reused for `npm-latest`.

The recovery workflow is convergence-safe after a partial success. If the exact
attested package bytes and `next` or `latest` tag already exist, a fresh protected
run must verify those immutable bytes and the current tag before skipping the
corresponding npm mutation. It must never republish an existing version or move a
tag whose state is not one of the explicitly admitted rollback or target values.
Registry checks use bounded retry because npm metadata can lag a successful tag
mutation briefly.

The one-shot recovery workflow publishes only the immutable attempt-one package
artifact from failed run `33812971614`: source `9cb1c185...`, artifact ID
`9915607947`, its pinned Actions artifact digest, package SHA-256, original
annotated tag object, and original attestation are all checked before the
artifact enters the protected publication job. Later reruns are irrelevant to
that selection. The recovery controller is independently bound to the current
default-branch SHA in its own gate receipt; it does not move the original tag,
repack the package, or substitute a new tarball.

For each stage, GitHub retains the authoritative review history and the workflow
retains a canonical gate receipt with the exact repository, environment,
approval mode, actual approver, assigned reviewer, source SHA, workflow path,
run ID, run attempt, validation time, tag-object SHA, and package or
`next`-receipt SHA-256. Missing, mismatched, foreign, or replayed evidence keeps
that stage blocked.
Both receipt-upload steps use an always-run failure path: an ambiguous npm
failure stays failed but cannot skip retention of a receipt already written.

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
