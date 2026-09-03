import { createHash } from "node:crypto"

const SHA = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/u

export const NPM_RELEASE = Object.freeze({
  package: "bharatcode",
  version: "0.2.10",
  tag: "cli-v0.2.10",
  rollbackVersion: "0.2.9",
  repository: "BharatCode-ai/bharatcode-cli",
  workflow: ".github/workflows/npm-release.yml",
})

function requireValue(value, message) {
  if (!value) throw new Error(message)
}

function exactKeys(value, expected, label) {
  requireValue(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`)
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  requireValue(JSON.stringify(actual) === JSON.stringify(wanted), `${label} keys are invalid`)
}

function requirePattern(value, pattern, label) {
  requireValue(typeof value === "string" && pattern.test(value), `${label} is invalid`)
}

export function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number") {
    requireValue(Number.isSafeInteger(value), "canonical JSON numbers must be safe integers")
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  requireValue(value && typeof value === "object", "canonical JSON contains an unsupported value")
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`
}

export function parseCanonicalJson(bytes, label = "npm release receipt") {
  requireValue(bytes instanceof Uint8Array, `${label} bytes are invalid`)
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  requireValue(!text.startsWith("\uFEFF") && !text.endsWith("\n") && !text.endsWith("\r"), `${label} has framing bytes`)
  const value = JSON.parse(text)
  requireValue(text === canonicalJson(value), `${label} must be canonical JSON without duplicate raw keys`)
  return value
}

export function validateDispatch(value) {
  exactKeys(value, ["event", "run_attempt", "source_sha", "tag", "version"], "npm release dispatch")
  requireValue(value.event === "workflow_dispatch", "npm release event is invalid")
  requirePattern(value.source_sha, SHA, "npm release source SHA")
  requireValue(value.tag === NPM_RELEASE.tag, "npm release tag is invalid")
  requireValue(value.version === NPM_RELEASE.version, "npm release version is invalid")
  requireValue(value.run_attempt === "1", "npm release replay is not allowed")
  return structuredClone(value)
}

export function createNextReceipt(input) {
  validateDispatch(input.dispatch)
  requirePattern(input.package_sha256, SHA256, "npm package SHA-256")
  requirePattern(input.run_id, POSITIVE_DECIMAL, "npm release run ID")
  requirePattern(input.registry_integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/u, "npm registry integrity")
  requireValue(input.registry_tarball === `https://registry.npmjs.org/${NPM_RELEASE.package}/-/${NPM_RELEASE.package}-${NPM_RELEASE.version}.tgz`, "npm registry tarball URL is invalid")
  const completed = new Date(input.completed_at)
  requireValue(Number.isFinite(completed.valueOf()) && completed.toISOString() === input.completed_at, "npm release completion time is invalid")
  return {
    completed_at: input.completed_at,
    package: NPM_RELEASE.package,
    package_sha256: input.package_sha256,
    registry_integrity: input.registry_integrity,
    registry_tarball: input.registry_tarball,
    repository: NPM_RELEASE.repository,
    rollback_version: NPM_RELEASE.rollbackVersion,
    run_attempt: input.dispatch.run_attempt,
    run_id: input.run_id,
    schema: "bharatcode-cli-npm-next-v1",
    source_sha: input.dispatch.source_sha,
    tag: input.dispatch.tag,
    version: input.dispatch.version,
    workflow: NPM_RELEASE.workflow,
  }
}

export function validateNextReceipt(value, bindings) {
  exactKeys(bindings, ["package_sha256", "run_attempt", "run_id", "source_sha"], "npm receipt bindings")
  exactKeys(
    value,
    [
      "completed_at",
      "package",
      "package_sha256",
      "registry_integrity",
      "registry_tarball",
      "repository",
      "rollback_version",
      "run_attempt",
      "run_id",
      "schema",
      "source_sha",
      "tag",
      "version",
      "workflow",
    ],
    "npm next receipt",
  )
  const expected = createNextReceipt({
    completed_at: value.completed_at,
    dispatch: {
      event: "workflow_dispatch",
      run_attempt: bindings.run_attempt,
      source_sha: bindings.source_sha,
      tag: NPM_RELEASE.tag,
      version: NPM_RELEASE.version,
    },
    package_sha256: bindings.package_sha256,
    registry_integrity: value.registry_integrity,
    registry_tarball: value.registry_tarball,
    run_id: bindings.run_id,
  })
  requireValue(canonicalJson(value) === canonicalJson(expected), "npm next receipt does not match protected bindings")
  return structuredClone(value)
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}
