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
  recoveryWorkflow: ".github/workflows/npm-release-recovery.yml",
  reviewers: Object.freeze({
    "npm-next": "Pankaj-IIT",
    "npm-latest": "satyamlohiya",
  }),
  ownerBypassActor: "shrey16",
  ownerBypassMode: "owner-admin-bypass-v1",
  recovery: Object.freeze({
    artifactDigest: "sha256:7cc210b4ba69cf3f7472f697b0af3456ea56b75f1a594ab85ced0b723d57a308",
    artifactId: "9915607947",
    artifactName: "bharatcode-cli-package-33812971614-1",
    packageSha256: "c7e5352994d9b0b9a03ce8a576addeff943182a156bf89b2d78249ce904e2953",
    runAttempt: "1",
    runId: "33812971614",
    sourceSha: "9cb1c18535dc9cfcd49cadeeec152bd580e588e4",
    tagObjectSha: "b8cd4936e2c28fb73913d9f0546e0990dd1f3677",
  }),
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

export function validateRecoverySourceEvidence(input) {
  exactKeys(input, ["artifacts", "jobs", "run"], "npm recovery source evidence")
  const { artifacts, jobs, run } = input
  const expected = NPM_RELEASE.recovery
  requireValue(run && typeof run === "object", "npm recovery source run is invalid")
  requireValue(String(run.id) === expected.runId, "npm recovery source run ID changed")
  requireValue(String(run.run_attempt) === expected.runAttempt, "npm recovery source run attempt changed")
  requireValue(run.event === "workflow_dispatch", "npm recovery source event changed")
  requireValue(run.head_branch === "main", "npm recovery source branch changed")
  requireValue(run.head_sha === expected.sourceSha, "npm recovery source SHA changed")
  requireValue(run.path === NPM_RELEASE.workflow, "npm recovery source workflow changed")
  requireValue(run.repository?.full_name === NPM_RELEASE.repository, "npm recovery source repository changed")
  requireValue(run.conclusion === "failure", "npm recovery source outcome changed")

  requireValue(Array.isArray(jobs), "npm recovery source jobs are invalid")
  for (const [name, conclusion] of [
    ["Admit exact reviewed source", "success"],
    ["Publish protected next candidate", "failure"],
    ["Promote verified next package to latest", "skipped"],
  ]) {
    const matches = jobs.filter((job) => job?.name === name)
    requireValue(matches.length === 1 && matches[0].conclusion === conclusion, `npm recovery source job changed: ${name}`)
  }

  requireValue(Array.isArray(artifacts), "npm recovery source artifacts are invalid")
  const matches = artifacts.filter((artifact) => String(artifact?.id) === expected.artifactId)
  requireValue(matches.length === 1, "npm recovery source artifact identity is not unique")
  const [artifact] = matches
  requireValue(artifact.name === expected.artifactName, "npm recovery source artifact name changed")
  requireValue(artifact.digest === expected.artifactDigest, "npm recovery source artifact digest changed")
  requireValue(artifact.expired === false, "npm recovery source artifact expired")
  requireValue(String(artifact.workflow_run?.id) === expected.runId, "npm recovery artifact run changed")
  requireValue(artifact.workflow_run?.head_sha === expected.sourceSha, "npm recovery artifact source changed")
  return {
    artifact_digest: expected.artifactDigest,
    artifact_id: expected.artifactId,
    artifact_name: expected.artifactName,
    package_sha256: expected.packageSha256,
    run_attempt: expected.runAttempt,
    run_id: expected.runId,
    source_sha: expected.sourceSha,
    tag_object_sha: expected.tagObjectSha,
  }
}

function requireLogin(value, label) {
  requireValue(typeof value === "string" && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u.test(value), `${label} is invalid`)
}

export function validateProtectedApproval(input, bindings) {
  const ownerBypass = Object.hasOwn(bindings, "approval_mode") || Object.hasOwn(bindings, "bypass_actor")
  exactKeys(
    bindings,
    ownerBypass
      ? ["approval_mode", "bypass_actor", "environment", "reviewer", "run_attempt", "run_id", "source_sha", "workflow"]
      : ["environment", "reviewer", "run_attempt", "run_id", "source_sha", "workflow"],
    "approval bindings",
  )
  requireValue(bindings.reviewer === NPM_RELEASE.reviewers[bindings.environment], "protected reviewer assignment is invalid")
  if (ownerBypass) {
    requireValue(bindings.approval_mode === NPM_RELEASE.ownerBypassMode, "protected approval mode is invalid")
    requireValue(bindings.bypass_actor === NPM_RELEASE.ownerBypassActor, "protected owner bypass actor is invalid")
  }
  requirePattern(bindings.run_id, POSITIVE_DECIMAL, "workflow run ID")
  requirePattern(bindings.source_sha, SHA, "workflow source SHA")
  requireValue(bindings.run_attempt === "1", "workflow replay is not allowed")
  requireLogin(bindings.reviewer, "protected reviewer")
  requireValue(bindings.workflow === NPM_RELEASE.workflow || bindings.workflow === NPM_RELEASE.recoveryWorkflow, "protected workflow assignment is invalid")

  requireValue(input && typeof input === "object" && !Array.isArray(input), "approval evidence is invalid")
  const { approvals, commit, permission, run } = input
  requireValue(Array.isArray(approvals), "workflow approval history is invalid")
  requireValue(run && typeof run === "object", "workflow run is invalid")
  requireValue(String(run.id) === bindings.run_id, "workflow run ID does not match")
  requireValue(String(run.run_attempt) === bindings.run_attempt, "workflow run attempt does not match")
  requireValue(run.event === "workflow_dispatch", "workflow event does not match")
  requireValue(run.head_sha === bindings.source_sha, "workflow source SHA does not match")
  requireValue(run.repository?.full_name === NPM_RELEASE.repository, "workflow repository does not match")
  requireValue(run.path === bindings.workflow || (typeof run.path === "string" && run.path.startsWith(`${bindings.workflow}@`)), "workflow path does not match")

  const targetRecords = approvals.filter((approval) => Array.isArray(approval?.environments) && approval.environments.some((environment) => environment?.name === bindings.environment))
  requireValue(targetRecords.length === 1, "protected environment requires one run-scoped approval record")
  const [approval] = targetRecords
  requireValue(approval.environments.length === 1 && approval.environments[0]?.name === bindings.environment, "approval record cannot be reused across environments")

  requireValue(commit && typeof commit === "object" && commit.sha === bindings.source_sha, "source commit does not match")
  const identities = [
    [run.actor?.login, "workflow actor"],
    [run.triggering_actor?.login, "workflow triggering actor"],
    [commit.author?.login, "source author"],
    [commit.committer?.login, "source committer"],
  ]
  for (const [login, label] of identities) {
    requireLogin(login, label)
  }

  if (ownerBypass) {
    requireValue(approval.state === "skipped", "protected environment was not explicitly bypassed")
    requireValue(approval.user?.login === bindings.bypass_actor, "protected owner bypass actor does not match")
    requireValue(run.actor?.login === bindings.bypass_actor, "protected owner bypass actor did not start the workflow")
    requireValue(run.triggering_actor?.login === bindings.bypass_actor, "protected owner bypass actor did not trigger the workflow")
    requireValue(permission?.user?.login === bindings.bypass_actor, "protected owner permission subject does not match")
    requireValue(permission?.permission === "admin", "protected owner bypass actor is not a repository administrator")
    return {
      approval_mode: bindings.approval_mode,
      approver: bindings.bypass_actor,
      environment: bindings.environment,
      reviewer: bindings.reviewer,
      run_attempt: bindings.run_attempt,
      run_id: bindings.run_id,
      source_sha: bindings.source_sha,
      workflow: bindings.workflow,
    }
  }

  requireValue(approval.state === "approved", "protected environment was not explicitly approved")
  requireValue(approval.user?.login === bindings.reviewer, "protected environment reviewer does not match")
  for (const [login, label] of identities) {
    requireValue(login !== bindings.reviewer, `protected reviewer cannot be the ${label}`)
  }

  return {
    environment: bindings.environment,
    reviewer: bindings.reviewer,
    run_attempt: bindings.run_attempt,
    run_id: bindings.run_id,
    source_sha: bindings.source_sha,
    workflow: bindings.workflow,
  }
}

export function validateAnnotatedTag(ref, tagObject, bindings) {
  exactKeys(bindings, ["admitted_tag_object_sha", "source_sha", "tag"], "annotated tag bindings")
  requirePattern(bindings.admitted_tag_object_sha, SHA, "admitted tag object SHA")
  requirePattern(bindings.source_sha, SHA, "tag source SHA")
  requireValue(bindings.tag === NPM_RELEASE.tag, "release tag binding is invalid")
  requireValue(ref && typeof ref === "object", "release tag is missing")
  requireValue(ref.ref === `refs/tags/${bindings.tag}`, "release tag ref is invalid")
  requireValue(ref.object?.type === "tag", "release tag must be annotated")
  requireValue(ref.object.sha === bindings.admitted_tag_object_sha, "release tag object changed after admission")
  requireValue(tagObject && typeof tagObject === "object", "annotated tag object is missing")
  requireValue(tagObject.sha === bindings.admitted_tag_object_sha, "annotated tag object SHA does not match")
  requireValue(tagObject.tag === bindings.tag, "annotated tag name does not match")
  requireValue(tagObject.object?.type === "commit", "annotated tag must peel directly to a commit")
  requireValue(tagObject.object.sha === bindings.source_sha, "annotated tag target does not match source")
  return {
    source_sha: bindings.source_sha,
    tag: bindings.tag,
    tag_object_sha: bindings.admitted_tag_object_sha,
  }
}

function validateRegistryFields(input) {
  requirePattern(input.package_sha256, SHA256, "npm package SHA-256")
  requirePattern(input.run_id, POSITIVE_DECIMAL, "npm release run ID")
  requirePattern(input.registry_integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/u, "npm registry integrity")
  requireValue(input.registry_tarball === `https://registry.npmjs.org/${NPM_RELEASE.package}/-/${NPM_RELEASE.package}-${NPM_RELEASE.version}.tgz`, "npm registry tarball URL is invalid")
  const completed = new Date(input.completed_at)
  requireValue(Number.isFinite(completed.valueOf()) && completed.toISOString() === input.completed_at, "npm release completion time is invalid")
}

export function createRegistrySmokeReceipt(input) {
  validateDispatch(input.dispatch)
  validateRegistryFields(input)
  requirePattern(input.tag_object_sha, SHA, "release tag object SHA")
  exactKeys(input.smoke, ["canonical_config", "cli_version", "credentials_unchanged", "network_calls", "retired_models_rejected"], "registry smoke result")
  requireValue(input.smoke.cli_version === NPM_RELEASE.version, "installed CLI version is invalid")
  requireValue(input.smoke.canonical_config === true, "installed CLI canonical config smoke failed")
  requireValue(input.smoke.retired_models_rejected === true, "installed CLI accepted a retired model")
  requireValue(input.smoke.network_calls === 0, "installed CLI behavior smoke made a network call")
  requireValue(input.smoke.credentials_unchanged === true, "installed CLI behavior smoke changed credentials")
  return {
    completed_at: input.completed_at,
    package: NPM_RELEASE.package,
    package_sha256: input.package_sha256,
    registry_integrity: input.registry_integrity,
    registry_tarball: input.registry_tarball,
    repository: NPM_RELEASE.repository,
    run_attempt: input.dispatch.run_attempt,
    run_id: input.run_id,
    schema: "bharatcode-cli-registry-smoke-v1",
    smoke: structuredClone(input.smoke),
    source_sha: input.dispatch.source_sha,
    tag: input.dispatch.tag,
    tag_object_sha: input.tag_object_sha,
    version: input.dispatch.version,
    workflow: NPM_RELEASE.workflow,
  }
}

export function validateRegistrySmokeReceipt(value, bindings) {
  exactKeys(bindings, ["package_sha256", "registry_integrity", "run_attempt", "run_id", "source_sha", "tag_object_sha"], "registry smoke bindings")
  exactKeys(
    value,
    [
      "completed_at",
      "package",
      "package_sha256",
      "registry_integrity",
      "registry_tarball",
      "repository",
      "run_attempt",
      "run_id",
      "schema",
      "smoke",
      "source_sha",
      "tag",
      "tag_object_sha",
      "version",
      "workflow",
    ],
    "registry smoke receipt",
  )
  const expected = createRegistrySmokeReceipt({
    completed_at: value.completed_at,
    dispatch: {
      event: "workflow_dispatch",
      run_attempt: bindings.run_attempt,
      source_sha: bindings.source_sha,
      tag: NPM_RELEASE.tag,
      version: NPM_RELEASE.version,
    },
    package_sha256: bindings.package_sha256,
    registry_integrity: bindings.registry_integrity,
    registry_tarball: value.registry_tarball,
    run_id: bindings.run_id,
    smoke: value.smoke,
    tag_object_sha: bindings.tag_object_sha,
  })
  requireValue(canonicalJson(value) === canonicalJson(expected), "registry smoke receipt does not match protected bindings")
  return structuredClone(value)
}

export function createNextReceipt(input) {
  validateDispatch(input.dispatch)
  validateRegistryFields(input)
  requirePattern(input.registry_smoke_sha256, SHA256, "registry smoke receipt SHA-256")
  return {
    completed_at: input.completed_at,
    package: NPM_RELEASE.package,
    package_sha256: input.package_sha256,
    registry_integrity: input.registry_integrity,
    registry_smoke_sha256: input.registry_smoke_sha256,
    registry_tarball: input.registry_tarball,
    repository: NPM_RELEASE.repository,
    rollback_version: NPM_RELEASE.rollbackVersion,
    run_attempt: input.dispatch.run_attempt,
    run_id: input.run_id,
    schema: "bharatcode-cli-npm-next-v2",
    source_sha: input.dispatch.source_sha,
    tag: input.dispatch.tag,
    version: input.dispatch.version,
    workflow: NPM_RELEASE.workflow,
  }
}

export function validateNextReceipt(value, bindings) {
  exactKeys(bindings, ["package_sha256", "registry_smoke_sha256", "run_attempt", "run_id", "source_sha"], "npm receipt bindings")
  exactKeys(
    value,
    [
      "completed_at",
      "package",
      "package_sha256",
      "registry_integrity",
      "registry_smoke_sha256",
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
    registry_smoke_sha256: bindings.registry_smoke_sha256,
    registry_tarball: value.registry_tarball,
    run_id: bindings.run_id,
  })
  requireValue(canonicalJson(value) === canonicalJson(expected), "npm next receipt does not match protected bindings")
  return structuredClone(value)
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}
