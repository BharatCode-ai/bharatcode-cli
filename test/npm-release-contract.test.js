import test from "node:test"
import assert from "node:assert/strict"
import {
  NPM_RELEASE,
  canonicalJson,
  createNextReceipt,
  parseCanonicalJson,
  validateDispatch,
  validateNextReceipt,
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

function receipt() {
  return createNextReceipt({
    completed_at: "2026-09-03T18:00:00.000Z",
    dispatch,
    package_sha256: digest,
    registry_integrity: `sha512-${Buffer.alloc(64, 7).toString("base64")}`,
    registry_tarball: "https://registry.npmjs.org/bharatcode/-/bharatcode-0.2.10.tgz",
    run_id: "33780000000",
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

test("round-trips a closed next-tag receipt", () => {
  const value = receipt()
  const bytes = Buffer.from(canonicalJson(value))
  assert.deepEqual(parseCanonicalJson(bytes), value)
  assert.deepEqual(
    validateNextReceipt(value, {
      package_sha256: digest,
      run_attempt: "1",
      run_id: "33780000000",
      source_sha: source,
    }),
    value,
  )
})

test("rejects minimal, extra, mismatched and duplicate-key receipts", () => {
  const value = receipt()
  const bindings = { package_sha256: digest, run_attempt: "1", run_id: "33780000000", source_sha: source }
  assert.throws(() => validateNextReceipt({ schema: value.schema }, bindings))
  assert.throws(() => validateNextReceipt({ ...value, extra: true }, bindings))
  assert.throws(() => validateNextReceipt({ ...value, source_sha: "c".repeat(40) }, bindings))
  assert.throws(() => validateNextReceipt(value, { ...bindings, run_id: "33780000001" }))
  assert.throws(() => parseCanonicalJson(Buffer.from('{"schema":"x","schema":"x"}')))
})
