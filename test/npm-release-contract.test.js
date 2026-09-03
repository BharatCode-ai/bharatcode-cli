import test from "node:test"
import assert from "node:assert/strict"
import {
  NPM_RELEASE,
  canonicalJson,
  createNextReceipt,
  createRegistrySmokeReceipt,
  parseCanonicalJson,
  validateAnnotatedTag,
  validateDispatch,
  validateNextReceipt,
  validateProtectedApproval,
  validateRegistrySmokeReceipt,
} from "../scripts/npm-release-contract.mjs"

const source = "a".repeat(40)
const digest = "b".repeat(64)
const dispatch = {
  event: "workflow_dispatch",
  run_attempt: "1",
  source_sha: source,
  tag: NPM_RELEASE.tag,
  version: NPM_RELEASE.version,
}

const tagObjectSha = "c".repeat(40)
const runId = "33780000000"
const integrity = `sha512-${Buffer.alloc(64, 7).toString("base64")}`
const tarball = "https://registry.npmjs.org/bharatcode/-/bharatcode-0.2.10.tgz"

function protectedApproval(environment = "npm-next", reviewer = "Pankaj-IIT") {
  return {
    approvals: [
      {
        state: "approved",
        user: { login: reviewer },
        environments: [{ name: environment }],
      },
    ],
    commit: {
      sha: source,
      author: { login: "source-author" },
      committer: { login: "source-committer" },
    },
    run: {
      id: Number(runId),
      run_attempt: 1,
      event: "workflow_dispatch",
      head_sha: source,
      path: `${NPM_RELEASE.workflow}@refs/heads/main`,
      repository: { full_name: NPM_RELEASE.repository },
      actor: { login: "release-operator" },
      triggering_actor: { login: "release-operator" },
    },
    bindings: {
      environment,
      reviewer,
      run_attempt: "1",
      run_id: runId,
      source_sha: source,
    },
  }
}

function annotatedTag() {
  return {
    ref: {
      ref: `refs/tags/${NPM_RELEASE.tag}`,
      object: { type: "tag", sha: tagObjectSha },
    },
    tag: {
      sha: tagObjectSha,
      tag: NPM_RELEASE.tag,
      object: { type: "commit", sha: source },
    },
    bindings: {
      admitted_tag_object_sha: tagObjectSha,
      source_sha: source,
      tag: NPM_RELEASE.tag,
    },
  }
}

function receipt() {
  return createNextReceipt({
    completed_at: "2026-09-03T18:00:00.000Z",
    dispatch,
    package_sha256: digest,
    registry_integrity: integrity,
    registry_smoke_sha256: "d".repeat(64),
    registry_tarball: tarball,
    run_id: runId,
  })
}

function smokeReceipt() {
  return createRegistrySmokeReceipt({
    completed_at: "2026-09-03T17:59:00.000Z",
    dispatch,
    package_sha256: digest,
    registry_integrity: integrity,
    registry_tarball: tarball,
    run_id: runId,
    smoke: {
      canonical_config: true,
      cli_version: NPM_RELEASE.version,
      credentials_unchanged: true,
      network_calls: 0,
      retired_models_rejected: true,
    },
    tag_object_sha: tagObjectSha,
  })
}

test("accepts the exact first-attempt CLI release identity", () => {
  assert.deepEqual(validateDispatch(dispatch), dispatch)
})

for (const [name, patch] of [
  ["wrong SHA", { source_sha: "A".repeat(40) }],
  ["wrong tag", { tag: "v0.2.10" }],
  ["wrong version", { version: "0.2.11" }],
  ["replay", { run_attempt: "2" }],
  ["wrong event", { event: "release" }],
]) {
  test(`rejects ${name}`, () => assert.throws(() => validateDispatch({ ...dispatch, ...patch })))
}

test("rejects extra dispatch authority", () => {
  assert.throws(() => validateDispatch({ ...dispatch, token: "secret" }))
})

test("accepts one exact run-scoped protected-environment approval", () => {
  const fixture = protectedApproval()
  const result = validateProtectedApproval(fixture, fixture.bindings)
  assert.deepEqual(result, {
    environment: "npm-next",
    reviewer: "Pankaj-IIT",
    run_attempt: "1",
    run_id: runId,
    source_sha: source,
  })
})

test("accepts the independent npm-latest reviewer after npm-next history", () => {
  const fixture = protectedApproval("npm-latest", "satyamlohiya")
  fixture.approvals.unshift({ state: "approved", user: { login: "Pankaj-IIT" }, environments: [{ name: "npm-next" }] })
  assert.equal(validateProtectedApproval(fixture, fixture.bindings).reviewer, "satyamlohiya")
})

for (const [name, mutate] of [
  ["admin bypass without an approval", (value) => (value.approvals = [])],
  ["a bypass state", (value) => (value.approvals[0].state = "bypassed")],
  ["a wrong reviewer", (value) => (value.approvals[0].user.login = "repo-admin")],
  ["a wrong environment", (value) => (value.approvals[0].environments[0].name = "npm-latest")],
  ["one approval reused across environments", (value) => value.approvals[0].environments.push({ name: "npm-latest" })],
  ["multiple approvals for the same environment", (value) => value.approvals.push(structuredClone(value.approvals[0]))],
  ["reviewer as workflow actor", (value) => (value.run.actor.login = value.bindings.reviewer)],
  ["reviewer as triggering actor", (value) => (value.run.triggering_actor.login = value.bindings.reviewer)],
  ["reviewer as source author", (value) => (value.commit.author.login = value.bindings.reviewer)],
  ["reviewer as source committer", (value) => (value.commit.committer.login = value.bindings.reviewer)],
  ["a replayed run", (value) => (value.run.run_attempt = 2)],
  ["a different run", (value) => (value.run.id += 1)],
  ["a different source", (value) => (value.run.head_sha = "e".repeat(40))],
  ["a different workflow", (value) => (value.run.path = ".github/workflows/other.yml")],
]) {
  test(`rejects ${name} as release approval evidence`, () => {
    const fixture = protectedApproval()
    mutate(fixture)
    assert.throws(() => validateProtectedApproval(fixture, fixture.bindings))
  })
}

test("accepts the admitted annotated tag object peeled to the exact source", () => {
  const fixture = annotatedTag()
  assert.deepEqual(validateAnnotatedTag(fixture.ref, fixture.tag, fixture.bindings), {
    source_sha: source,
    tag: NPM_RELEASE.tag,
    tag_object_sha: tagObjectSha,
  })
})

for (const [name, mutate] of [
  ["deleted tag", (value) => (value.ref = null)],
  ["lightweight tag", (value) => (value.ref.object.type = "commit")],
  ["mutated tag object", (value) => (value.ref.object.sha = "e".repeat(40))],
  ["wrong tag name", (value) => (value.tag.tag = "cli-v0.2.11")],
  ["tag targeting another commit", (value) => (value.tag.object.sha = "e".repeat(40))],
  ["nested tag target", (value) => (value.tag.object.type = "tag")],
]) {
  test(`rejects ${name} immediately before release mutation`, () => {
    const fixture = annotatedTag()
    mutate(fixture)
    assert.throws(() => validateAnnotatedTag(fixture.ref, fixture.tag, fixture.bindings))
  })
}

test("round-trips a registry-installed behavioral smoke receipt", () => {
  const value = smokeReceipt()
  assert.deepEqual(
    validateRegistrySmokeReceipt(value, {
      package_sha256: digest,
      registry_integrity: integrity,
      run_attempt: "1",
      run_id: runId,
      source_sha: source,
      tag_object_sha: tagObjectSha,
    }),
    value,
  )
})

for (const [name, mutate] of [
  ["wrong installed version", (value) => (value.smoke.cli_version = "0.2.9")],
  ["noncanonical config", (value) => (value.smoke.canonical_config = false)],
  ["accepted retired model", (value) => (value.smoke.retired_models_rejected = false)],
  ["a behavior network call", (value) => (value.smoke.network_calls = 1)],
  ["credentials mutation", (value) => (value.smoke.credentials_unchanged = false)],
  ["wrong package digest", (value) => (value.package_sha256 = "e".repeat(64))],
  ["wrong registry integrity", (value) => (value.registry_integrity = `sha512-${Buffer.alloc(64, 8).toString("base64")}`)],
  ["wrong run", (value) => (value.run_id = "33780000001")],
  ["wrong source", (value) => (value.source_sha = "e".repeat(40))],
  ["mutated tag object", (value) => (value.tag_object_sha = "e".repeat(40))],
]) {
  test(`rejects registry smoke receipt with ${name}`, () => {
    const value = smokeReceipt()
    mutate(value)
    assert.throws(() =>
      validateRegistrySmokeReceipt(value, {
        package_sha256: digest,
        registry_integrity: integrity,
        run_attempt: "1",
        run_id: runId,
        source_sha: source,
        tag_object_sha: tagObjectSha,
      }),
    )
  })
}

test("round-trips a closed next-tag receipt", () => {
  const value = receipt()
  const bytes = Buffer.from(canonicalJson(value))
  assert.deepEqual(parseCanonicalJson(bytes), value)
  assert.deepEqual(
    validateNextReceipt(value, {
      package_sha256: digest,
      run_attempt: "1",
      run_id: runId,
      source_sha: source,
      registry_smoke_sha256: "d".repeat(64),
    }),
    value,
  )
})

test("rejects minimal, extra, mismatched and duplicate-key receipts", () => {
  const value = receipt()
  const bindings = { package_sha256: digest, registry_smoke_sha256: "d".repeat(64), run_attempt: "1", run_id: runId, source_sha: source }
  assert.throws(() => validateNextReceipt({ schema: value.schema }, bindings))
  assert.throws(() => validateNextReceipt({ ...value, extra: true }, bindings))
  assert.throws(() => validateNextReceipt({ ...value, source_sha: "c".repeat(40) }, bindings))
  assert.throws(() => validateNextReceipt({ ...value, registry_smoke_sha256: "e".repeat(64) }, bindings))
  assert.throws(() => validateNextReceipt(value, { ...bindings, run_id: "33780000001" }))
  assert.throws(() => parseCanonicalJson(Buffer.from('{"schema":"x","schema":"x"}')))
})
