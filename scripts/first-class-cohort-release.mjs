import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile, readdir, stat } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

const SHA = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/u

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
  version: "1.15.25",
  releaseTag: "desktop-beta-1.15.25",
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

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
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
    manifests[record.key.slice("cli-".length)] = JSON.parse(extracted.stdout)
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
  const root = process.argv[2]
  requireValue(
    root,
    "usage: first-class-cohort-release.mjs <release-directory>",
  )
  const result = await verifyCliReleaseDirectory(root, {
    source_sha: process.env.DESKTOP_SOURCE_SHA,
    run_id: process.env.DESKTOP_RUN_ID,
    run_attempt: process.env.DESKTOP_RUN_ATTEMPT,
  })
  process.stdout.write(canonicalJson(result))
}
