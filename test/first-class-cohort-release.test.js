import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import test from "node:test"

import {
  CLI_RELEASE,
  PLATFORM_PACKAGE_NAMES,
  canonicalJson,
  validateCliCohortBytes,
  validatePackageManifests,
} from "../scripts/first-class-cohort-release.mjs"

const root = resolve(import.meta.dirname, "..")
const sha = (value) => createHash("sha256").update(value).digest("hex")

function artifact(name) {
  const platform =
    name === "bharatcode"
      ? "npm"
      : name.includes("darwin")
        ? "macos"
        : name.includes("windows")
          ? "windows"
          : "linux"
  const arch =
    name === "bharatcode"
      ? "universal"
      : name.includes("arm64")
        ? "arm64"
        : "x64"
  const filename = `${name}-${CLI_RELEASE.version}.tgz`
  const digest = sha(name)
  return {
    key: `cli-${name}`,
    platform,
    arch,
    filename,
    bytes: 100 + name.length,
    sha256: digest,
    artifact_attestation: {
      filename: `${filename}.intoto.jsonl`,
      bytes: 200 + name.length,
      sha256: sha(`bundle-${name}`),
      subject_sha256: digest,
      predicate_type: "https://slsa.dev/provenance/v1",
    },
    signing: "not-applicable",
    completed_at: "2026-09-04T08:00:00.000Z",
  }
}

function cohort() {
  return {
    schema: "bharatcode-next-beta-cohort-v3",
    repository: CLI_RELEASE.desktopRepository,
    source_sha: "a".repeat(40),
    candidate_tag: CLI_RELEASE.releaseTag,
    desktop_version: CLI_RELEASE.version,
    cli_version: CLI_RELEASE.version,
    wsl_runtime_version: CLI_RELEASE.version,
    channel: "beta",
    workflow: CLI_RELEASE.desktopWorkflow,
    run_id: "123456789",
    run_attempt: "1",
    upgrade_gate_result: "OWNER_WAIVED",
    upgrade_receipt_sha256: "b".repeat(64),
    wsl_gate_result: "OWNER_WAIVED",
    wsl_receipt_sha256: "c".repeat(64),
    artifacts: [
      artifact("bharatcode"),
      ...PLATFORM_PACKAGE_NAMES.map(artifact),
    ].sort((a, b) => a.key.localeCompare(b.key)),
    completed_at: "2026-09-04T08:01:00.000Z",
  }
}

function manifests() {
  const optionalDependencies = Object.fromEntries(
    PLATFORM_PACKAGE_NAMES.map((name) => [name, CLI_RELEASE.version]),
  )
  const repository = {
    type: "git",
    url: "git+https://github.com/BharatCode-ai/bharatcode-cli.git",
  }
  return {
    bharatcode: {
      name: "bharatcode",
      version: CLI_RELEASE.version,
      type: "module",
      bin: { bharatcode: "bin/bharatcode.mjs" },
      files: ["bin", "script/distribution.mjs"],
      optionalDependencies,
      os: ["darwin", "linux", "win32"],
      cpu: ["arm64", "x64"],
      repository,
    },
    ...Object.fromEntries(
      PLATFORM_PACKAGE_NAMES.map((name) => [
        name,
        {
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
          repository,
        },
      ]),
    ),
  }
}

test("accepts the exact signed Desktop cohort CLI subset", () => {
  const value = cohort()
  const parsed = validateCliCohortBytes(Buffer.from(canonicalJson(value)), {
    source_sha: value.source_sha,
    run_id: value.run_id,
    run_attempt: value.run_attempt,
  })
  assert.deepEqual(
    parsed.cli.map((item) => item.key),
    value.artifacts.map((item) => item.key),
  )
})

test("rejects noncanonical, stale, incomplete, duplicate, and foreign CLI cohorts", () => {
  const value = cohort()
  const bindings = {
    source_sha: value.source_sha,
    run_id: value.run_id,
    run_attempt: value.run_attempt,
  }
  assert.throws(() =>
    validateCliCohortBytes(Buffer.from(`${canonicalJson(value)}\n`), bindings),
  )
  assert.throws(() =>
    validateCliCohortBytes(
      Buffer.from(canonicalJson({ ...value, cli_version: "0.2.10" })),
      bindings,
    ),
  )
  assert.throws(() =>
    validateCliCohortBytes(
      Buffer.from(canonicalJson({ ...value, source_sha: "d".repeat(40) })),
      bindings,
    ),
  )
  assert.throws(() =>
    validateCliCohortBytes(
      Buffer.from(canonicalJson({ ...value, extra: true })),
      bindings,
    ),
  )
  assert.throws(() =>
    validateCliCohortBytes(
      Buffer.from(
        canonicalJson({ ...value, artifacts: value.artifacts.slice(1) }),
      ),
      bindings,
    ),
  )
  assert.throws(() =>
    validateCliCohortBytes(
      Buffer.from(
        canonicalJson({
          ...value,
          artifacts: [...value.artifacts, value.artifacts[0]],
        }),
      ),
      bindings,
    ),
  )
})

test("accepts only the closed first-class package manifests", () => {
  assert.equal(validatePackageManifests(manifests()).length, 13)

  const wrapper = manifests()
  wrapper.bharatcode.dependencies = { "opencode-ai": "^1.15.10" }
  assert.throws(
    () => validatePackageManifests(wrapper),
    /manifest keys|dependency/u,
  )

  const missing = manifests()
  delete missing[PLATFORM_PACKAGE_NAMES[0]]
  assert.throws(() => validatePackageManifests(missing))
})

test("workflow downloads signed cohort assets and never packs the wrapper", async () => {
  const workflow = await readFile(
    resolve(root, ".github/workflows/npm-release.yml"),
    "utf8",
  )
  assert.match(workflow, /desktop-beta-1\.15\.25/u)
  assert.match(workflow, /gh attestation verify "\$subject"/u)
  assert.match(
    workflow,
    /--signer-workflow "\$DESKTOP_REPOSITORY\/\$DESKTOP_WORKFLOW"/u,
  )
  assert.match(workflow, /--source-digest "\$DESKTOP_SOURCE_SHA"/u)
  assert.match(
    workflow,
    /npm publish "\$package" --tag next --access public --provenance/u,
  )
  assert.match(workflow, /PLATFORM_PACKAGE_NAMES/u)
  assert.match(workflow, /npm dist-tag add "bharatcode@\$CLI_VERSION" latest/u)
  assert.match(workflow, /for npm_major in 11 12/u)
  assert.match(workflow, /bun add --cwd "\$smoke_root\/bun"/u)
  assert.doesNotMatch(workflow, /npm pack|opencode-ai/u)
})
