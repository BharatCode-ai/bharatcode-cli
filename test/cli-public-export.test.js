import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import {
  buildCliPublicExportManifest,
  exportCliPublicRepo,
} from "../scripts/export-cli-public-repo.mjs"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")

test("CLI public export manifest includes support gates and excludes operational docs", async () => {
  const manifest = await buildCliPublicExportManifest(repoRoot)

  for (const expected of [
    "package.json",
    "package-lock.json",
    "README.md",
    "LICENSE",
    "bin/bharatcode.js",
    "index.js",
    "lib/bharatcode-auth.js",
    "lib/cli-args.js",
    "lib/opencode-config.js",
    "docs/setup.md",
    "docs/compatibility.md",
    "scripts/audit-open-source-readiness.mjs",
    "scripts/export-cli-public-repo.mjs",
    "test/open-source-readiness.test.js",
    "test/cli-public-export.test.js",
    "test/release-and-branding.test.js",
    ".github/ISSUE_TEMPLATE/cli_bug_report.yml",
    ".github/workflows/npm-release.yml",
  ]) {
    assert.ok(manifest.files.includes(expected), `${expected} should be exported`)
  }

  for (const blocked of [
    "docs/public-beta-runbook.md",
    "docs/security-hardening.md",
    "apps/api",
    "apps/web",
    "infra",
    "marketing",
    ".env",
  ]) {
    assert.equal(manifest.files.some((entry) => entry === blocked || entry.startsWith(`${blocked}/`)), false)
  }
})

test("CLI public export writes a clean file tree without operational docs", async () => {
  const outDir = await mkdtemp(resolve(tmpdir(), "bharatcode-cli-public-"))

  try {
    const result = await exportCliPublicRepo(repoRoot, outDir, { force: true })

    assert.equal(result.outputDir, outDir)
    assert.ok(existsSync(resolve(outDir, "package.json")))
    assert.ok(existsSync(resolve(outDir, "scripts/audit-open-source-readiness.mjs")))
    assert.ok(existsSync(resolve(outDir, ".github/ISSUE_TEMPLATE/cli_bug_report.yml")))
    assert.equal(existsSync(resolve(outDir, "docs/public-beta-runbook.md")), false)
    assert.equal(existsSync(resolve(outDir, "docs/security-hardening.md")), false)
    assert.equal(existsSync(resolve(outDir, ".git")), false)

    const issueTemplate = await readFile(resolve(outDir, ".github/ISSUE_TEMPLATE/cli_bug_report.yml"), "utf8")
    assert.match(issueTemplate, /Do not paste OAuth tokens/)
    assert.match(issueTemplate, /Visible error/)
    assert.doesNotMatch(issueTemplate, /phone number/i)

    const exportedPackage = JSON.parse(await readFile(resolve(outDir, "package.json"), "utf8"))
    assert.equal(exportedPackage.scripts["test:api"], undefined)
    assert.equal(exportedPackage.scripts["test:web"], undefined)
    assert.equal(exportedPackage.scripts["build:api"], undefined)
    assert.equal(exportedPackage.scripts["build:web"], undefined)
    assert.equal(exportedPackage.scripts["check:platform"], undefined)
    assert.equal(exportedPackage.scripts.test, "node --test test/*.test.js")
    assert.equal(exportedPackage.scripts["audit:oss"], "node scripts/audit-open-source-readiness.mjs")
    assert.equal(exportedPackage.scripts["audit:oss:repo"], "node scripts/audit-open-source-readiness.mjs --repo-visibility")
    assert.equal(exportedPackage.repository.url, "git+https://github.com/BharatCode-ai/bharatcode-cli.git")
    assert.equal(exportedPackage.bugs.url, "https://github.com/BharatCode-ai/bharatcode-cli/issues")
    assert.equal(exportedPackage.homepage, "https://github.com/BharatCode-ai/bharatcode-cli#readme")
    assert.doesNotMatch(JSON.stringify(exportedPackage), /BharatCode-ai\/bharatcode\.git/)

    const auditModule = await import(pathToFileURL(resolve(outDir, "scripts/audit-open-source-readiness.mjs")).href)
    const report = await auditModule.buildOpenSourceReadinessReport(outDir, { requireRepositoryVisibility: true })
    assert.equal(report.repositoryVisibility.ready, true)
    assert.deepEqual(report.critical, [])
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
})

test("CLI public export can target a chosen public repository name", async () => {
  const outDir = await mkdtemp(resolve(tmpdir(), "bharatcode-cli-public-custom-"))

  try {
    await exportCliPublicRepo(repoRoot, outDir, {
      force: true,
      githubRepo: "BharatCode-ai/bharatcode-cli-preview",
    })

    const exportedPackage = JSON.parse(await readFile(resolve(outDir, "package.json"), "utf8"))
    assert.equal(exportedPackage.repository.url, "git+https://github.com/BharatCode-ai/bharatcode-cli-preview.git")
    assert.equal(exportedPackage.bugs.url, "https://github.com/BharatCode-ai/bharatcode-cli-preview/issues")
    assert.equal(exportedPackage.homepage, "https://github.com/BharatCode-ai/bharatcode-cli-preview#readme")
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
})
