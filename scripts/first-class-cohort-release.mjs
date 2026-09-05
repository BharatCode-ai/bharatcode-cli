import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile, readdir, stat } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

const SHA = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/u
const SHA512 = /^[0-9a-f]{128}$/u
const SLSA_PROVENANCE = "https://slsa.dev/provenance/v1"
const META_SOURCE_SHA256 = Object.freeze({
  "package/bin/bharatcode.mjs":
    "00d6893693f39c96fb57e98ad73b38802dc75eacfaac516d602335f18dab0afb",
  "package/script/distribution.mjs":
    "09232e787e029b509e396af16ed4082c94bf69e45005567ed6e8c8b4f55b5e9e",
})

export const PLATFORM_PACKAGE_NAMES = Object.freeze([
  "bharatcode-darwin-arm64",
  "bharatcode-darwin-x64",
  "bharatcode-darwin-x64-baseline",
  "bharatcode-linux-arm64",
  "bharatcode-linux-arm64-musl",
  "bharatcode-linux-x64",
  "bharatcode-linux-x64-baseline",
  "bharatcode-linux-x64-baseline-musl",
  "bharatcode-linux-x64-musl",
  "bharatcode-windows-arm64",
  "bharatcode-windows-x64",
  "bharatcode-windows-x64-baseline",
])

export const CLI_RELEASE = Object.freeze({
  version: "1.15.28",
  releaseTag: "desktop-beta-1.15.28",
  desktopRepository: "BharatCode-ai/bharatcode-desktop",
  desktopWorkflow: ".github/workflows/bharatcode-next-beta-candidate.yml",
  controllerRepository: "BharatCode-ai/bharatcode-cli",
  controllerWorkflow: ".github/workflows/npm-release.yml",
})

const REPOSITORY = Object.freeze({
  type: "git",
  url: "git+https://github.com/BharatCode-ai/bharatcode-cli.git",
})

function requireValue(value, message) {
  if (!value) throw new Error(message)
}

function exactKeys(value, expected, label) {
  requireValue(
    value && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`,
  )
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  requireValue(
    JSON.stringify(actual) === JSON.stringify(wanted),
    `${label} keys are invalid`,
  )
}

function pattern(value, regex, label) {
  requireValue(
    typeof value === "string" && regex.test(value),
    `${label} is invalid`,
  )
}

function iso(value, label) {
  requireValue(typeof value === "string", `${label} is invalid`)
  const date = new Date(value)
  requireValue(
    Number.isFinite(date.valueOf()) && date.toISOString() === value,
    `${label} is invalid`,
  )
  return date.valueOf()
}

export function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value)
  if (typeof value === "number") {
    requireValue(
      Number.isSafeInteger(value),
      "canonical JSON numbers must be safe integers",
    )
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  requireValue(
    value && typeof value === "object",
    "canonical JSON contains an unsupported value",
  )
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`
}

function parseCanonicalJson(bytes, label) {
  requireValue(bytes instanceof Uint8Array, `${label} bytes are invalid`)
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  requireValue(
    !text.startsWith("\uFEFF") && !text.endsWith("\n") && !text.endsWith("\r"),
    `${label} framing is invalid`,
  )
  const value = JSON.parse(text)
  requireValue(
    text === canonicalJson(value),
    `${label} must be canonical JSON without duplicate raw keys`,
  )
  return value
}

function packagePlatform(name) {
  if (name === "bharatcode") return { platform: "npm", arch: "universal" }
  return {
    platform: name.includes("darwin")
      ? "macos"
      : name.includes("windows")
        ? "windows"
        : "linux",
    arch: name.includes("arm64") ? "arm64" : "x64",
  }
}

function validateArtifact(value, name, completedAt) {
  exactKeys(
    value,
    [
      "arch",
      "artifact_attestation",
      "bytes",
      "completed_at",
      "filename",
      "key",
      "platform",
      "sha256",
      "signing",
    ],
    `CLI artifact ${name}`,
  )
  const expected = packagePlatform(name)
  const filename = `${name}-${CLI_RELEASE.version}.tgz`
  requireValue(value.key === `cli-${name}`, `CLI artifact key changed: ${name}`)
  requireValue(
    value.platform === expected.platform && value.arch === expected.arch,
    `CLI artifact platform changed: ${name}`,
  )
  requireValue(
    value.filename === filename,
    `CLI artifact filename changed: ${name}`,
  )
  requireValue(
    Number.isSafeInteger(value.bytes) && value.bytes > 0,
    `CLI artifact size is invalid: ${name}`,
  )
  pattern(value.sha256, SHA256, `CLI artifact digest ${name}`)
  requireValue(
    value.signing === "not-applicable",
    `CLI artifact signing changed: ${name}`,
  )
  requireValue(
    iso(value.completed_at, `CLI artifact completion ${name}`) <= completedAt,
    `CLI artifact completed after cohort: ${name}`,
  )
  exactKeys(
    value.artifact_attestation,
    ["bytes", "filename", "predicate_type", "sha256", "subject_sha256"],
    `CLI artifact attestation ${name}`,
  )
  requireValue(
    value.artifact_attestation.filename === `${filename}.intoto.jsonl`,
    `CLI attestation filename changed: ${name}`,
  )
  requireValue(
    Number.isSafeInteger(value.artifact_attestation.bytes) &&
      value.artifact_attestation.bytes > 0,
    `CLI attestation size is invalid: ${name}`,
  )
  pattern(
    value.artifact_attestation.sha256,
    SHA256,
    `CLI attestation digest ${name}`,
  )
  requireValue(
    value.artifact_attestation.subject_sha256 === value.sha256,
    `CLI attestation subject changed: ${name}`,
  )
  requireValue(
    value.artifact_attestation.predicate_type ===
      "https://slsa.dev/provenance/v1",
    `CLI attestation predicate changed: ${name}`,
  )
  return structuredClone(value)
}

export function validateCliCohortBytes(bytes, bindings) {
  exactKeys(
    bindings,
    ["run_attempt", "run_id", "source_sha"],
    "CLI cohort bindings",
  )
  pattern(bindings.source_sha, SHA, "Desktop source SHA")
  pattern(bindings.run_id, POSITIVE_DECIMAL, "Desktop run ID")
  pattern(bindings.run_attempt, POSITIVE_DECIMAL, "Desktop run attempt")

  const value = parseCanonicalJson(bytes, "Desktop cohort")
  exactKeys(
    value,
    [
      "artifacts",
      "candidate_tag",
      "channel",
      "cli_version",
      "completed_at",
      "desktop_version",
      "repository",
      "run_attempt",
      "run_id",
      "schema",
      "source_sha",
      "upgrade_gate_result",
      "upgrade_receipt_sha256",
      "workflow",
      "wsl_gate_result",
      "wsl_receipt_sha256",
      "wsl_runtime_version",
    ],
    "Desktop cohort",
  )
  requireValue(
    value.schema === "bharatcode-next-beta-cohort-v3",
    "Desktop cohort schema changed",
  )
  requireValue(
    value.repository === CLI_RELEASE.desktopRepository,
    "Desktop cohort repository changed",
  )
  requireValue(
    value.workflow === CLI_RELEASE.desktopWorkflow,
    "Desktop cohort workflow changed",
  )
  requireValue(
    value.source_sha === bindings.source_sha,
    "Desktop cohort source changed",
  )
  requireValue(
    value.run_id === bindings.run_id &&
      value.run_attempt === bindings.run_attempt,
    "Desktop cohort run changed",
  )
  requireValue(
    value.candidate_tag === CLI_RELEASE.releaseTag,
    "Desktop cohort tag changed",
  )
  requireValue(
    value.desktop_version === CLI_RELEASE.version,
    "Desktop version changed",
  )
  requireValue(value.cli_version === CLI_RELEASE.version, "CLI version changed")
  requireValue(
    value.wsl_runtime_version === CLI_RELEASE.version,
    "WSL runtime version changed",
  )
  requireValue(value.channel === "beta", "Desktop cohort channel changed")
  requireValue(
    ["PASS", "OWNER_WAIVED"].includes(value.upgrade_gate_result),
    "Upgrade gate result is invalid",
  )
  requireValue(
    ["PASS", "OWNER_WAIVED"].includes(value.wsl_gate_result),
    "WSL gate result is invalid",
  )
  pattern(value.upgrade_receipt_sha256, SHA256, "Upgrade receipt digest")
  pattern(value.wsl_receipt_sha256, SHA256, "WSL receipt digest")
  const completedAt = iso(value.completed_at, "Desktop cohort completion")
  requireValue(
    Array.isArray(value.artifacts),
    "Desktop cohort artifacts are invalid",
  )
  const keys = value.artifacts.map((item) => item?.key)
  const filenames = value.artifacts.map((item) => item?.filename)
  requireValue(
    new Set(keys).size === keys.length &&
      new Set(filenames).size === filenames.length,
    "Desktop cohort artifact identities are not unique",
  )

  const names = ["bharatcode", ...PLATFORM_PACKAGE_NAMES]
  const cli = names.map((name) => {
    const matches = value.artifacts.filter(
      (item) => item?.key === `cli-${name}`,
    )
    requireValue(
      matches.length === 1,
      `Desktop cohort CLI artifact is missing or duplicated: ${name}`,
    )
    return validateArtifact(matches[0], name, completedAt)
  })
  requireValue(
    value.artifacts.filter(
      (item) => typeof item?.key === "string" && item.key.startsWith("cli-"),
    ).length === names.length,
    "Desktop cohort contains a foreign CLI artifact",
  )
  return { cohort: structuredClone(value), cli }
}

function platformManifest(name) {
  return {
    name,
    version: CLI_RELEASE.version,
    os: [
      name.includes("darwin")
        ? "darwin"
        : name.includes("windows")
          ? "win32"
          : "linux",
    ],
    cpu: [name.includes("arm64") ? "arm64" : "x64"],
    files: ["bin"],
    preferUnplugged: true,
    repository: REPOSITORY,
  }
}

export function validatePackageManifests(manifests) {
  exactKeys(
    manifests,
    ["bharatcode", ...PLATFORM_PACKAGE_NAMES],
    "CLI package manifest set",
  )
  const optionalDependencies = Object.fromEntries(
    PLATFORM_PACKAGE_NAMES.map((name) => [name, CLI_RELEASE.version]),
  )
  const meta = manifests.bharatcode
  exactKeys(
    meta,
    [
      "bin",
      "cpu",
      "files",
      "name",
      "optionalDependencies",
      "os",
      "repository",
      "type",
      "version",
    ],
    "CLI meta manifest",
  )
  requireValue(
    canonicalJson(meta) ===
      canonicalJson({
        name: "bharatcode",
        version: CLI_RELEASE.version,
        type: "module",
        bin: { bharatcode: "bin/bharatcode.mjs" },
        files: ["bin", "script/distribution.mjs"],
        optionalDependencies,
        os: ["darwin", "linux", "win32"],
        cpu: ["arm64", "x64"],
        repository: REPOSITORY,
      }),
    "CLI meta manifest content changed or contains a wrapper dependency",
  )
  for (const name of PLATFORM_PACKAGE_NAMES) {
    const value = manifests[name]
    exactKeys(
      value,
      [
        "cpu",
        "files",
        "name",
        "os",
        "preferUnplugged",
        "repository",
        "version",
      ],
      `CLI platform manifest ${name}`,
    )
    requireValue(
      canonicalJson(value) === canonicalJson(platformManifest(name)),
      `CLI platform manifest changed: ${name}`,
    )
  }
  return ["bharatcode", ...PLATFORM_PACKAGE_NAMES]
}

function decodeProvenancePayload(value) {
  requireValue(
    typeof value === "string" && value.length > 0,
    "npm provenance payload is missing",
  )
  const bytes = Buffer.from(value, "base64")
  requireValue(
    bytes.length > 0 &&
      bytes.toString("base64").replace(/=+$/u, "") ===
        value.replace(/=+$/u, ""),
    "npm provenance payload is invalid",
  )
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
}

export function validateNpmProvenanceAudit(value, bindings) {
  exactKeys(
    bindings,
    ["controller_sha", "name", "run_attempt", "run_id", "version"],
    "npm provenance bindings",
  )
  pattern(bindings.controller_sha, SHA, "npm provenance controller SHA")
  pattern(bindings.run_id, POSITIVE_DECIMAL, "npm provenance run ID")
  pattern(bindings.run_attempt, POSITIVE_DECIMAL, "npm provenance run attempt")
  requireValue(
    ["bharatcode", ...PLATFORM_PACKAGE_NAMES].includes(bindings.name),
    "npm provenance package is invalid",
  )
  requireValue(
    bindings.version === CLI_RELEASE.version,
    "npm provenance version is invalid",
  )
  requireValue(
    Array.isArray(value?.invalid) && value.invalid.length === 0,
    "npm provenance audit contains invalid attestations",
  )
  requireValue(
    Array.isArray(value?.missing) && value.missing.length === 0,
    "npm provenance audit contains missing attestations",
  )
  requireValue(
    Array.isArray(value?.verified),
    "npm provenance audit verification is missing",
  )
  const matches = value.verified.filter(
    (item) =>
      item?.name === bindings.name && item?.version === bindings.version,
  )
  requireValue(
    matches.length === 1,
    "npm provenance package verification is missing or duplicated",
  )
  const item = matches[0]
  requireValue(
    item.registry === "https://registry.npmjs.org/",
    "npm provenance registry changed",
  )
  requireValue(
    item.attestations?.provenance?.predicateType === SLSA_PROVENANCE,
    "npm provenance predicate changed",
  )
  requireValue(
    item.attestations?.url ===
      `https://registry.npmjs.org/-/npm/v1/attestations/${bindings.name}@${bindings.version}`,
    "npm provenance attestation URL changed",
  )
  requireValue(
    Array.isArray(item.attestationBundles),
    "npm provenance bundles are missing",
  )
  const bundles = item.attestationBundles.filter(
    (entry) => entry?.predicateType === SLSA_PROVENANCE,
  )
  requireValue(
    bundles.length === 1,
    "npm provenance bundle is missing or duplicated",
  )
  const statement = decodeProvenancePayload(
    bundles[0]?.bundle?.dsseEnvelope?.payload,
  )
  exactKeys(
    statement,
    ["_type", "predicate", "predicateType", "subject"],
    "npm provenance statement",
  )
  requireValue(
    statement._type === "https://in-toto.io/Statement/v1" &&
      statement.predicateType === SLSA_PROVENANCE,
    "npm provenance statement type changed",
  )
  requireValue(
    Array.isArray(statement.subject) && statement.subject.length === 1,
    "npm provenance subject changed",
  )
  const subject = statement.subject[0]
  exactKeys(subject, ["digest", "name"], "npm provenance subject")
  const purl = `pkg:npm/${bindings.name}@${bindings.version}`
  requireValue(subject.name === purl, "npm provenance subject package changed")
  exactKeys(subject.digest, ["sha512"], "npm provenance subject digest")
  pattern(subject.digest.sha512, SHA512, "npm provenance subject digest")
  const definition = statement.predicate?.buildDefinition
  const details = statement.predicate?.runDetails
  requireValue(
    definition?.buildType ===
      "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
    "npm provenance build type changed",
  )
  const workflow = definition.externalParameters?.workflow
  requireValue(
    workflow?.repository ===
      `https://github.com/${CLI_RELEASE.controllerRepository}`,
    "npm provenance repository changed",
  )
  requireValue(
    workflow?.path === CLI_RELEASE.controllerWorkflow &&
      workflow?.ref === "refs/heads/main",
    "npm provenance workflow changed",
  )
  requireValue(
    Array.isArray(definition.resolvedDependencies) &&
      definition.resolvedDependencies.length === 1,
    "npm provenance source dependency changed",
  )
  const dependency = definition.resolvedDependencies[0]
  requireValue(
    dependency?.uri ===
      `git+https://github.com/${CLI_RELEASE.controllerRepository}@refs/heads/main`,
    "npm provenance source URI changed",
  )
  requireValue(
    dependency?.digest?.gitCommit === bindings.controller_sha,
    "npm provenance source SHA changed",
  )
  requireValue(
    definition.internalParameters?.github?.event_name === "workflow_dispatch",
    "npm provenance event changed",
  )
  requireValue(
    details?.builder?.id === "https://github.com/actions/runner/github-hosted",
    "npm provenance builder changed",
  )
  const invocation = details?.metadata?.invocationId
  const match =
    typeof invocation === "string"
      ? invocation.match(
          /^https:\/\/github\.com\/BharatCode-ai\/bharatcode-cli\/actions\/runs\/([1-9][0-9]*)\/attempts\/([1-9][0-9]*)$/u,
        )
      : null
  requireValue(match, "npm provenance invocation changed")
  requireValue(
    match[1] === bindings.run_id && match[2] === bindings.run_attempt,
    "npm provenance run changed",
  )
  return {
    name: bindings.name,
    version: bindings.version,
    purl,
    sha512: subject.digest.sha512,
    source_sha: bindings.controller_sha,
    run_id: match[1],
    run_attempt: match[2],
  }
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

export function expectedCliTarballEntries(name) {
  requireValue(
    ["bharatcode", ...PLATFORM_PACKAGE_NAMES].includes(name),
    "CLI tarball package is invalid",
  )
  if (name === "bharatcode") {
    return [
      "package/bin/bharatcode.mjs",
      "package/package.json",
      "package/script/distribution.mjs",
    ]
  }
  return [
    `package/bin/bharatcode${name.includes("windows") ? ".exe" : ""}`,
    "package/package.json",
  ]
}

export async function verifyCliReleaseDirectory(root, bindings) {
  const directory = resolve(root)
  const cohortName = "bharatcode-next-beta-cohort.json"
  const cohortBytes = await readFile(resolve(directory, cohortName))
  const parsed = validateCliCohortBytes(cohortBytes, bindings)
  const checksum = await readFile(
    resolve(directory, `${cohortName}.sha256`),
    "utf8",
  )
  requireValue(
    checksum === `${digest(cohortBytes)}  ${cohortName}\n`,
    "Desktop cohort checksum file changed",
  )

  const wanted = new Set([
    cohortName,
    `${cohortName}.sha256`,
    `${cohortName}.intoto.jsonl`,
  ])
  const manifests = {}
  for (const record of parsed.cli) {
    const name = record.key.slice("cli-".length)
    wanted.add(record.filename)
    wanted.add(record.artifact_attestation.filename)
    const subjectPath = resolve(directory, record.filename)
    const bundlePath = resolve(directory, record.artifact_attestation.filename)
    const subject = await readFile(subjectPath)
    const bundle = await readFile(bundlePath)
    requireValue(
      (await stat(subjectPath)).size === record.bytes &&
        digest(subject) === record.sha256,
      `CLI subject bytes changed: ${record.key}`,
    )
    requireValue(
      (await stat(bundlePath)).size === record.artifact_attestation.bytes &&
        digest(bundle) === record.artifact_attestation.sha256,
      `CLI attestation bytes changed: ${record.key}`,
    )
    const listed = spawnSync("tar", ["-tzf", subjectPath], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    })
    requireValue(
      listed.status === 0 && !listed.error,
      `CLI package file list cannot be read: ${record.key}`,
    )
    const entries = listed.stdout.trim().split("\n").filter(Boolean).sort()
    requireValue(
      JSON.stringify(entries) ===
        JSON.stringify(expectedCliTarballEntries(name).sort()),
      `CLI package file closure changed: ${record.key}`,
    )
    if (name === "bharatcode") {
      for (const [entry, expected] of Object.entries(META_SOURCE_SHA256)) {
        const extracted = spawnSync("tar", ["-xOf", subjectPath, entry], {
          encoding: null,
          maxBuffer: 1024 * 1024,
        })
        requireValue(
          extracted.status === 0 &&
            !extracted.error &&
            digest(extracted.stdout) === expected,
          `CLI meta source bytes changed: ${entry}`,
        )
      }
    }
    const extracted = spawnSync(
      "tar",
      ["-xOf", subjectPath, "package/package.json"],
      {
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      },
    )
    requireValue(
      extracted.status === 0 && !extracted.error,
      `CLI package manifest cannot be extracted: ${record.key}`,
    )
    manifests[name] = JSON.parse(extracted.stdout)
  }
  validatePackageManifests(manifests)
  const actual = (await readdir(directory)).sort()
  const expected = [...wanted].sort()
  requireValue(
    JSON.stringify(actual) === JSON.stringify(expected),
    "CLI release input file set changed",
  )
  return {
    cohort_sha256: digest(cohortBytes),
    packages: parsed.cli.map((record) => ({
      name: record.key.slice("cli-".length),
      filename: record.filename,
      sha256: record.sha256,
    })),
  }
}

const invoked =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invoked) {
  const mode = process.argv[2]
  let result
  if (mode === "verify-npm-provenance") {
    const audit = JSON.parse(await readFile(process.argv[3], "utf8"))
    result = validateNpmProvenanceAudit(audit, {
      name: process.argv[4],
      version: process.env.CLI_VERSION,
      controller_sha: process.env.CONTROLLER_SHA,
      run_id: process.env.PACKAGE_PROVENANCE_RUN_ID,
      run_attempt: process.env.PACKAGE_PROVENANCE_RUN_ATTEMPT,
    })
  } else {
    requireValue(
      mode,
      "usage: first-class-cohort-release.mjs <release-directory>",
    )
    result = await verifyCliReleaseDirectory(mode, {
      source_sha: process.env.DESKTOP_SOURCE_SHA,
      run_id: process.env.DESKTOP_RUN_ID,
      run_attempt: process.env.DESKTOP_RUN_ATTEMPT,
    })
  }
  process.stdout.write(canonicalJson(result))
}
