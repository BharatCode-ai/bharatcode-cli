import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  analyzeCliPackage,
  analyzeDesktopBoundary,
  analyzeRepositoryVisibility,
  buildOpenSourceReadinessReport,
} from "../scripts/audit-open-source-readiness.mjs"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const hasOperationalDocs =
  existsSync(resolve(repoRoot, "docs/public-beta-runbook.md")) ||
  existsSync(resolve(repoRoot, "docs/security-hardening.md"))

test("open-source readiness audit verifies the CLI package boundary", async () => {
  const result = await analyzeCliPackage(repoRoot)

  assert.equal(result.name, "bharatcode")
  assert.equal(result.license, "MIT")
  assert.equal(result.packageReady, true)
  assert.equal(result.bin?.bharatcode, "bin/bharatcode.js")
  assert.deepEqual(result.blockedPackageEntries, [])
  assert.ok(result.packageFiles.includes("index.js"))
  assert.ok(result.packageFiles.includes("bin/bharatcode.js"))
  assert.equal(result.packageFiles.includes("docs/public-beta-runbook.md"), false)
  assert.equal(result.packageFiles.includes("docs/security-hardening.md"), false)
})

test("open-source readiness audit keeps Desktop as a separate repo boundary", async () => {
  const result = await analyzeDesktopBoundary(repoRoot)

  assert.equal(result.relativePath, "apps/desktop")
  assert.equal(result.boundary, "separate-repository")
  assert.ok(
    result.notes.some((note) => note.includes("BharatCode-ai/bharatcode-desktop")),
    "Desktop notes should point reviewers to the separate Desktop repository",
  )
})

test("open-source readiness report is safe to run without printing secret values", async () => {
  const report = await buildOpenSourceReadinessReport(repoRoot)

  assert.equal(report.cli.packageReady, true)
  assert.equal(Array.isArray(report.critical), true)
  assert.equal(report.critical.some((item) => /gho_|ghp_|sk-|kq_/i.test(item)), false)
})

test("open-source readiness report reflects whether operational docs block root visibility", async () => {
  const result = await analyzeRepositoryVisibility(repoRoot)

  assert.equal(result.ready, !hasOperationalDocs)
  if (hasOperationalDocs) {
    assert.ok(result.currentOperationalDocs.includes("docs/public-beta-runbook.md"))
    assert.ok(result.currentOperationalDocs.includes("docs/security-hardening.md"))
    assert.ok(result.historyExposedOperationalDocs.includes("docs/public-beta-runbook.md"))
    assert.ok(result.historyExposedOperationalDocs.includes("docs/security-hardening.md"))
    assert.ok(
      result.blockers.some((item) =>
        item.includes("Create a clean exported CLI repository or rewrite history before flipping root visibility"),
      ),
    )
  } else {
    assert.deepEqual(result.currentOperationalDocs, [])
    assert.deepEqual(result.trackedOperationalDocs, [])
    assert.deepEqual(result.historyExposedOperationalDocs, [])
    assert.deepEqual(result.blockers, [])
  }
})

test("default audit keeps package critical separate from repository visibility blockers", async () => {
  const report = await buildOpenSourceReadinessReport(repoRoot)

  assert.equal(report.cli.packageReady, true)
  assert.deepEqual(report.critical, [])
  assert.equal(report.repositoryVisibility.ready, !hasOperationalDocs)
  if (hasOperationalDocs) {
    assert.ok(report.repositoryVisibility.blockers.length >= 1)
  } else {
    assert.deepEqual(report.repositoryVisibility.blockers, [])
  }
})

test("package exposes a repeatable OSS readiness audit command", async () => {
  const pkg = JSON.parse(await readFile(resolve(repoRoot, "package.json"), "utf8"))

  assert.equal(pkg.scripts["audit:oss"], "node scripts/audit-open-source-readiness.mjs")
  assert.equal(pkg.scripts["audit:oss:repo"], "node scripts/audit-open-source-readiness.mjs --repo-visibility")
})
