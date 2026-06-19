import { existsSync } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import { basename, join, relative } from "node:path"
import { pathToFileURL } from "node:url"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

const BLOCKED_PACKAGE_PREFIXES = [
  "apps/",
  "assets/",
  "imagegen/",
  "infra/",
  "marketing/",
  "scripts/",
  "stt/",
  "supabase/",
  "tts/",
]

const SECRET_LIKE_PATTERNS = [
  /\bgh[op]_[A-Za-z0-9_]{20,}\b/,
  /\bsk-[A-Za-z0-9][A-Za-z0-9_-]{20,}\b/,
  /\bkq_[A-Za-z0-9_-]{8,}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
]

const OPERATIONAL_DOCS = new Set([
  "docs/public-beta-runbook.md",
  "docs/security-hardening.md",
])

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

async function fileExists(path) {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function directoryExists(path) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function gitOutput(repoRoot, args) {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: repoRoot,
      maxBuffer: 1024 * 1024,
    })
    return stdout
  } catch {
    return ""
  }
}

async function scanPackageFiles(repoRoot, packageFiles) {
  const findings = []

  for (const entry of packageFiles) {
    const path = join(repoRoot, entry)
    if (!(await fileExists(path))) continue
    const text = await readFile(path, "utf8")
    for (const pattern of SECRET_LIKE_PATTERNS) {
      if (pattern.test(text)) {
        findings.push(`${entry}: contains a secret-like literal; inspect and redact before public release`)
        break
      }
    }
  }

  return findings
}

export async function analyzeCliPackage(repoRoot) {
  const pkg = await readJson(join(repoRoot, "package.json"))
  const packageFiles = Array.isArray(pkg.files) ? pkg.files : []
  const blockedPackageEntries = packageFiles.filter((entry) =>
    BLOCKED_PACKAGE_PREFIXES.some((prefix) => entry === prefix.slice(0, -1) || entry.startsWith(prefix)),
  )
  const missingPackageFiles = []

  for (const entry of packageFiles) {
    if (!(await fileExists(join(repoRoot, entry)))) missingPackageFiles.push(entry)
  }

  const operationalDocsInPackage = packageFiles.filter((entry) => OPERATIONAL_DOCS.has(entry))

  const secretFindings = await scanPackageFiles(repoRoot, packageFiles)
  const critical = [
    ...blockedPackageEntries.map((entry) => `${entry}: blocked private/platform path in npm package files list`),
    ...operationalDocsInPackage.map((entry) => `${entry}: operational runbook must not ship in the public CLI package`),
    ...missingPackageFiles.map((entry) => `${entry}: package file is missing`),
    ...secretFindings,
  ]

  return {
    name: pkg.name,
    version: pkg.version,
    private: pkg.private === true,
    license: pkg.license,
    bin: pkg.bin ?? {},
    packageFiles,
    blockedPackageEntries,
    missingPackageFiles,
    packageReady:
      pkg.name === "bharatcode" &&
      pkg.license === "MIT" &&
      pkg.private !== true &&
      pkg.bin?.bharatcode === "bin/bharatcode.js" &&
      blockedPackageEntries.length === 0 &&
      missingPackageFiles.length === 0 &&
      secretFindings.length === 0,
    warnings: [],
    critical,
  }
}

export async function analyzeDesktopBoundary(repoRoot) {
  const desktopPath = join(repoRoot, "apps", "desktop")
  const present = await directoryExists(desktopPath)
  const hasNestedGit = await directoryExists(join(desktopPath, ".git"))
  const packagePath = join(desktopPath, "package.json")
  const packagePresent = await fileExists(packagePath)
  const notes = [
    "Desktop is owned through the separate BharatCode-ai/bharatcode-desktop repository, not the root npm package.",
    "Do not flip public visibility until Product Head - Desktop approves repo scope, release channels, updater behavior, and public issue triage.",
  ]
  const warnings = []

  if (!present) {
    warnings.push("apps/desktop is not mounted in this checkout; audit the separate Desktop repository before launch.")
  } else if (!hasNestedGit) {
    warnings.push("apps/desktop is present but not a nested Git repository; verify source provenance before launch.")
  }

  if (packagePresent) {
    const pkg = await readJson(packagePath)
    if (pkg.private === true) {
      warnings.push("Desktop root package is private; decide whether public repo remains private-package monorepo or publishes scoped packages.")
    }
  }

  return {
    relativePath: "apps/desktop",
    present,
    hasNestedGit,
    boundary: "separate-repository",
    notes,
    warnings,
  }
}

export async function analyzeRepositoryVisibility(repoRoot) {
  const currentOperationalDocs = []
  const trackedOperationalDocs = []
  const historyExposedOperationalDocs = []

  const trackedFiles = new Set(
    (await gitOutput(repoRoot, ["ls-files", ...OPERATIONAL_DOCS]))
      .split(/\r?\n/)
      .filter(Boolean),
  )

  for (const entry of OPERATIONAL_DOCS) {
    if (await fileExists(join(repoRoot, entry))) currentOperationalDocs.push(entry)
    if (trackedFiles.has(entry)) trackedOperationalDocs.push(entry)
    const history = await gitOutput(repoRoot, ["log", "--format=%H", "--", entry])
    if (history.trim()) historyExposedOperationalDocs.push(entry)
  }

  const blockers = []
  if (currentOperationalDocs.length) {
    blockers.push(
      `Current operational docs must move to private ops docs or become public-safe before root visibility changes: ${currentOperationalDocs.join(", ")}`,
    )
  }
  if (trackedOperationalDocs.length) {
    blockers.push(
      `Tracked operational docs are still part of the root repository: ${trackedOperationalDocs.join(", ")}`,
    )
  }
  if (historyExposedOperationalDocs.length) {
    blockers.push(
      `Create a clean exported CLI repository or rewrite history before flipping root visibility; operational docs exist in git history: ${historyExposedOperationalDocs.join(", ")}`,
    )
  }

  return {
    ready: blockers.length === 0,
    currentOperationalDocs,
    trackedOperationalDocs,
    historyExposedOperationalDocs,
    blockers,
    recommendation:
      blockers.length === 0
        ? "Root repository visibility has no operational-doc blockers from this audit."
        : "Keep the root repository private; publish only the package boundary or use a clean exported public repository until blockers are resolved.",
  }
}

export async function buildOpenSourceReadinessReport(repoRoot = process.cwd(), options = {}) {
  const cli = await analyzeCliPackage(repoRoot)
  const desktop = await analyzeDesktopBoundary(repoRoot)
  const repositoryVisibility = await analyzeRepositoryVisibility(repoRoot)
  const critical = [
    ...cli.critical.map((item) => `CLI: ${item}`),
    ...(options.requireRepositoryVisibility
      ? repositoryVisibility.blockers.map((item) => `Repository visibility: ${item}`)
      : []),
  ]
  const warnings = [
    ...cli.warnings.map((item) => `CLI: ${item}`),
    ...desktop.warnings.map((item) => `Desktop: ${item}`),
    ...(!repositoryVisibility.ready && !options.requireRepositoryVisibility
      ? ["Repository visibility: root repository is not ready for public visibility; run npm run audit:oss:repo for the strict gate."]
      : []),
  ]

  return {
    generatedFor: basename(repoRoot),
    cli,
    desktop,
    repositoryVisibility,
    critical,
    warnings,
    recommendation:
      critical.length === 0
        ? "CLI package boundary is ready for Product/CTO open-source review; root repository visibility remains a separate gate."
        : "Resolve critical findings before approving any public repository visibility change.",
  }
}

function printHuman(report) {
  console.log("BharatCode OSS readiness audit")
  console.log(`CLI package: ${report.cli.name}@${report.cli.version}`)
  console.log(`CLI package-ready: ${report.cli.packageReady ? "yes" : "no"}`)
  console.log(`Desktop boundary: ${report.desktop.boundary}`)
  for (const note of report.desktop.notes) console.log(`- ${note}`)
  console.log(`Repository visibility-ready: ${report.repositoryVisibility.ready ? "yes" : "no"}`)
  for (const blocker of report.repositoryVisibility.blockers) console.log(`- ${blocker}`)
  if (report.warnings.length) {
    console.log("\nWarnings")
    for (const item of report.warnings) console.log(`- ${item}`)
  }
  if (report.critical.length) {
    console.log("\nCritical")
    for (const item of report.critical) console.log(`- ${item}`)
  }
  console.log(`\nRecommendation: ${report.recommendation}`)
}

async function main() {
  const json = process.argv.includes("--json")
  const report = await buildOpenSourceReadinessReport(process.cwd(), {
    requireRepositoryVisibility: process.argv.includes("--repo-visibility"),
  })
  if (json) console.log(JSON.stringify(report, null, 2))
  else printHuman(report)
  if (report.critical.length) process.exitCode = 1
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
