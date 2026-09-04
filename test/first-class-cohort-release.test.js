import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import test from "node:test"

import {
  CLI_RELEASE,
  PLATFORM_PACKAGE_NAMES,
  canonicalJson,
  expectedCliTarballEntries,
  validateCliCohortBytes,
  validateNpmProvenanceAudit,
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

function provenanceAudit(name = "bharatcode") {
  const statement = {
    _type: "https://in-toto.io/Statement/v1",
    subject: [
      {
        name: `pkg:npm/${name}@${CLI_RELEASE.version}`,
        digest: { sha512: "d".repeat(128) },
      },
    ],
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: {
      buildDefinition: {
        buildType:
          "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
        externalParameters: {
          workflow: {
            ref: "refs/heads/main",
            repository: "https://github.com/BharatCode-ai/bharatcode-cli",
            path: CLI_RELEASE.controllerWorkflow,
          },
        },
        internalParameters: { github: { event_name: "workflow_dispatch" } },
        resolvedDependencies: [
          {
            uri: "git+https://github.com/BharatCode-ai/bharatcode-cli@refs/heads/main",
            digest: { gitCommit: "e".repeat(40) },
          },
        ],
      },
      runDetails: {
        builder: { id: "https://github.com/actions/runner/github-hosted" },
        metadata: {
          invocationId:
            "https://github.com/BharatCode-ai/bharatcode-cli/actions/runs/123456789/attempts/1",
        },
      },
    },
  }
  return {
    invalid: [],
    missing: [],
    verified: [
      {
        name,
        version: CLI_RELEASE.version,
        registry: "https://registry.npmjs.org/",
        attestations: {
          url: `https://registry.npmjs.org/-/npm/v1/attestations/${name}@${CLI_RELEASE.version}`,
          provenance: { predicateType: "https://slsa.dev/provenance/v1" },
        },
        attestationBundles: [
          {
            predicateType: "https://slsa.dev/provenance/v1",
            bundle: {
              dsseEnvelope: {
                payload: Buffer.from(JSON.stringify(statement)).toString(
                  "base64",
                ),
              },
            },
          },
        ],
      },
    ],
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

test("allows only the closed native and meta tarball file sets", () => {
  assert.deepEqual(expectedCliTarballEntries("bharatcode"), [
    "package/bin/bharatcode.mjs",
    "package/package.json",
    "package/script/distribution.mjs",
  ])
  assert.deepEqual(expectedCliTarballEntries("bharatcode-linux-x64"), [
    "package/bin/bharatcode",
    "package/package.json",
  ])
  assert.deepEqual(expectedCliTarballEntries("bharatcode-windows-x64"), [
    "package/bin/bharatcode.exe",
    "package/package.json",
  ])
  assert.throws(() => expectedCliTarballEntries("opencode-ai"))
})

test("accepts only registry-verified npm provenance from the exact controller source", () => {
  const bindings = {
    name: "bharatcode",
    version: CLI_RELEASE.version,
    controller_sha: "e".repeat(40),
    run_id: "123456789",
    run_attempt: "1",
  }
  assert.throws(() =>
    validateNpmProvenanceAudit(provenanceAudit(), {
      ...bindings,
      run_id: "1",
    }),
  )
  assert.deepEqual(validateNpmProvenanceAudit(provenanceAudit(), bindings), {
    name: "bharatcode",
    version: CLI_RELEASE.version,
    purl: `pkg:npm/bharatcode@${CLI_RELEASE.version}`,
    sha512: "d".repeat(128),
    source_sha: "e".repeat(40),
    run_id: "123456789",
    run_attempt: "1",
  })

  for (const mutate of [
    (value) => value.missing.push({ name: "bharatcode" }),
    (value) => (value.verified[0].attestationBundles = []),
    (value) =>
      (value.verified[0].attestationBundles[0].bundle.dsseEnvelope.payload =
        "not-base64"),
    (value) => {
      const statement = JSON.parse(
        Buffer.from(
          value.verified[0].attestationBundles[0].bundle.dsseEnvelope.payload,
          "base64",
        ).toString(),
      )
      statement.predicate.buildDefinition.externalParameters.workflow.repository =
        "https://github.com/foreign/repo"
      value.verified[0].attestationBundles[0].bundle.dsseEnvelope.payload =
        Buffer.from(JSON.stringify(statement)).toString("base64")
    },
    (value) => {
      const statement = JSON.parse(
        Buffer.from(
          value.verified[0].attestationBundles[0].bundle.dsseEnvelope.payload,
          "base64",
        ).toString(),
      )
      statement.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit =
        "f".repeat(40)
      value.verified[0].attestationBundles[0].bundle.dsseEnvelope.payload =
        Buffer.from(JSON.stringify(statement)).toString("base64")
    },
  ]) {
    const value = structuredClone(provenanceAudit())
    mutate(value)
    assert.throws(() => validateNpmProvenanceAudit(value, bindings))
  }
})

test(
  "saved-exact npm 12 fixture exposes dependency-free package provenance to audit signatures",
  { skip: process.env.BHARATCODE_NPM_PROVENANCE_LIVE !== "1" },
  async () => {
    const directory = await mkdtemp(
      resolve(tmpdir(), "bharatcode-npm-provenance-"),
    )
    try {
      await writeFile(resolve(directory, "package.json"), '{"private":true}\n')
      const run = (args) =>
        spawnSync("npx", ["--yes", "npm@12.0.2", ...args], {
          cwd: directory,
          encoding: "utf8",
        })
      const install = run([
        "install",
        "--omit=optional",
        "--save-exact",
        "semver@7.8.5",
      ])
      assert.equal(install.status, 0, install.stderr)
      const manifest = JSON.parse(
        await readFile(resolve(directory, "package.json"), "utf8"),
      )
      assert.equal(manifest.dependencies.semver, "7.8.5")
      const audit = run([
        "audit",
        "signatures",
        "--json",
        "--include-attestations",
      ])
      assert.equal(audit.status, 0, audit.stderr)
      const value = JSON.parse(audit.stdout)
      const matches = value.verified.filter(
        (item) => item.name === "semver" && item.version === "7.8.5",
      )
      assert.equal(matches.length, 1)
      assert.ok(
        matches[0].attestationBundles.some(
          (item) => item.predicateType === "https://slsa.dev/provenance/v1",
        ),
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)

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
    /PACKAGE_PROVENANCE_SHA: 0667f00d6bae748881c84e30621d4b33ddaf98a6/u,
  )
  assert.match(workflow, /PACKAGE_PROVENANCE_RUN_ID: "33873228367"/u)
  assert.match(
    workflow,
    /CONTROLLER_SHA="\$PACKAGE_PROVENANCE_SHA" node scripts\/first-class-cohort-release\.mjs verify-npm-provenance/u,
  )
  assert.match(
    workflow,
    /npm publish "\$package" --tag next --access public --provenance/u,
  )
  assert.match(
    workflow,
    /local package="\.\/release-input\/\$name-\$CLI_VERSION\.tgz"/u,
  )
  assert.match(workflow, /PLATFORM_PACKAGE_NAMES/u)
  assert.match(workflow, /promote_or_verify bharatcode/u)
  assert.match(workflow, /for npm_major in 11 12/u)
  assert.match(workflow, /bun add --cwd "\$smoke_root\/bun"/u)
  assert.match(
    workflow,
    /npm@12\.0\.2 audit signatures --json --include-attestations/u,
  )
  assert.match(
    workflow,
    /npm@12\.0\.2 install --force --ignore-scripts --omit=optional --save-exact/u,
  )
  assert.doesNotMatch(workflow, /--os="\$os"|--cpu="\$cpu"/u)
  assert.match(
    workflow,
    /Verify exact registry provenance without publication credentials[\s\S]*unset NODE_AUTH_TOKEN[\s\S]*\[\[ -z "\$\{NODE_AUTH_TOKEN:-\}" \]\]/u,
  )
  assert.match(workflow, /bharatcode-first-class-cli-latest\.json/u)
  assert.match(
    workflow,
    /Re-admit exact controller and Desktop release before latest mutation/u,
  )
  assert.match(workflow, /INPUT_RELEASE_TAG: \$\{\{ inputs\.release_tag \}\}/u)
  assert.doesNotMatch(workflow, /\[\[ "\$\{\{ inputs\.release_tag \}\}"/u)
  assert.match(workflow, /next\.release_assets\.length !== 29/u)
  assert.doesNotMatch(workflow, /npm pack|opencode-ai/u)
})
