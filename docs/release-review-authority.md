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
stages. An administrator bypass is not accepted as review evidence. The
initiator, source author, and required reviewer must be recorded; the reviewer
must not be the initiator or approve their own deployment. Approval for
`npm-next` cannot be reused for `npm-latest`.

For each stage, retain the GitHub deployment approval record with the exact
repository, environment, reviewer login, source SHA, workflow path, run ID,
run attempt, deployment ID, approval time, and package or receipt SHA-256.
Missing, bypassed, mismatched, self-approved, or replayed review evidence keeps
that stage blocked.

Desktop prerelease review is separately assigned to `Pankaj-IIT` in the
Desktop repository's `desktop-beta-release` protected environment. None of
these assignments permits a workflow dispatch, npm publication, dist-tag
change, Desktop prerelease finalization, or website cutover without the
remaining release gates and an explicit authorized execution.
