import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const SUPPORT_FILES = [
  "package.json",
  "package-lock.json",
  "scripts/audit-open-source-readiness.mjs",
  "scripts/export-cli-public-repo.mjs",
  "test/open-source-readiness.test.js",
  "test/cli-public-export.test.js",
  ".github/ISSUE_TEMPLATE/cli_bug_report.yml",
]

const DEFAULT_PUBLIC_GITHUB_REPO = "BharatCode-ai/bharatcode-cli"

const BLOCKED_EXPORT_PREFIXES = [
  ".env",
  ".git",
  ".agents/",
  "apps/",
  "assets/",
  "imagegen/",
  "infra/",
  "marketing/",
  "scripts/configure-",
  "scripts/send-",
  "scripts/smoke-",
  "supabase/",
  "tts/",
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

function unique(items) {
  return [...new Set(items)]
}

function isInside(parent, child) {
  const rel = relative(parent, child)
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)
}

function isBlockedExportEntry(entry) {
  return OPERATIONAL_DOCS.has(entry) || BLOCKED_EXPORT_PREFIXES.some((prefix) =>
    prefix.endsWith("/") ? entry.startsWith(prefix) : entry === prefix || entry.startsWith(`${prefix}/`),
  )
}

function publicRepositoryMetadata(githubRepo) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(githubRepo)) {
    throw new Error(`Invalid GitHub repository target: ${githubRepo}. Expected owner/name.`)
  }

  return {
    repository: {
      type: "git",
      url: `git+https://github.com/${githubRepo}.git`,
    },
    bugs: {
      url: `https://github.com/${githubRepo}/issues`,
    },
    homepage: `https://github.com/${githubRepo}#readme`,
  }
}

function sanitizePackageJson(pkg, options = {}) {
  const githubRepo = options.githubRepo ?? DEFAULT_PUBLIC_GITHUB_REPO
  const repositoryMetadata = publicRepositoryMetadata(githubRepo)

  return {
    ...pkg,
    ...repositoryMetadata,
    scripts: {
      test: "node --test test/*.test.js",
      "audit:oss": "node scripts/audit-open-source-readiness.mjs",
      "audit:oss:repo": "node scripts/audit-open-source-readiness.mjs --repo-visibility",
      "export:oss:cli": "node scripts/export-cli-public-repo.mjs",
      smoke: pkg.scripts?.smoke,
      "pack:check": pkg.scripts?.["pack:check"],
    },
  }
}

export async function buildCliPublicExportManifest(repoRoot = process.cwd()) {
  const packageJsonPath = join(repoRoot, "package.json")
  const pkg = await readJson(packageJsonPath)
  const files = unique([...SUPPORT_FILES, ...(Array.isArray(pkg.files) ? pkg.files : [])])
  const blocked = files.filter(isBlockedExportEntry)
  const missing = []

  for (const entry of files) {
    if (!(await fileExists(join(repoRoot, entry)))) missing.push(entry)
  }

  return {
    packageName: pkg.name,
    packageVersion: pkg.version,
    files,
    blocked,
    missing,
  }
}

function assertSafeOutputPath(repoRoot, outputDir) {
  const resolvedRepoRoot = resolve(repoRoot)
  const resolvedOutputDir = resolve(outputDir)
  const defaultExportRoot = resolve(resolvedRepoRoot, "output", "oss")

  if (resolvedOutputDir === resolvedRepoRoot) {
    throw new Error("Refusing to export over the repository root")
  }

  if (isInside(resolvedRepoRoot, resolvedOutputDir) && resolvedOutputDir !== defaultExportRoot && !isInside(defaultExportRoot, resolvedOutputDir)) {
    throw new Error("Refusing to write inside the repository except under output/oss")
  }
}

export async function exportCliPublicRepo(repoRoot = process.cwd(), outputDir = join(repoRoot, "output", "oss", "bharatcode-cli-public"), options = {}) {
  const resolvedRepoRoot = resolve(repoRoot)
  const resolvedOutputDir = resolve(outputDir)
  assertSafeOutputPath(resolvedRepoRoot, resolvedOutputDir)

  const manifest = await buildCliPublicExportManifest(resolvedRepoRoot)
  if (manifest.blocked.length) {
    throw new Error(`Refusing to export blocked files: ${manifest.blocked.join(", ")}`)
  }
  if (manifest.missing.length) {
    throw new Error(`Refusing to export missing files: ${manifest.missing.join(", ")}`)
  }

  if (existsSync(resolvedOutputDir)) {
    if (!options.force) {
      throw new Error(`Output directory already exists: ${resolvedOutputDir}. Pass --force to replace it.`)
    }
    await rm(resolvedOutputDir, { recursive: true, force: true })
  }
  await mkdir(resolvedOutputDir, { recursive: true })

  const pkg = await readJson(join(resolvedRepoRoot, "package.json"))
  const sanitizedPackage = sanitizePackageJson(pkg, options)

  for (const entry of manifest.files) {
    const source = join(resolvedRepoRoot, entry)
    const destination = join(resolvedOutputDir, entry)
    await mkdir(dirname(destination), { recursive: true })
    if (entry === "package.json") {
      await writeFile(destination, `${JSON.stringify(sanitizedPackage, null, 2)}\n`)
    } else {
      await copyFile(source, destination)
    }
  }

  return {
    outputDir: resolvedOutputDir,
    files: manifest.files,
  }
}

function argValue(args, name) {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  return args[index + 1]
}

async function main() {
  const args = process.argv.slice(2)
  const json = args.includes("--json")
  const dryRun = args.includes("--dry-run")
  const force = args.includes("--force")
  const githubRepo = argValue(args, "--github-repo") ?? DEFAULT_PUBLIC_GITHUB_REPO
  const outputDir = argValue(args, "--out") ?? join(process.cwd(), "output", "oss", "bharatcode-cli-public")

  if (dryRun) {
    const manifest = await buildCliPublicExportManifest(process.cwd())
    console.log(JSON.stringify(manifest, null, 2))
    if (manifest.blocked.length || manifest.missing.length) process.exitCode = 1
    return
  }

  const result = await exportCliPublicRepo(process.cwd(), outputDir, { force, githubRepo })
  if (json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(`Exported ${result.files.length} files to ${result.outputDir}`)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
