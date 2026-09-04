import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")

async function readText(relativePath) {
  return readFile(resolve(repoRoot, relativePath), "utf8")
}

test("npm release workflow publishes only the signed first-class Desktop cohort", async () => {
  const workflowPath = resolve(repoRoot, ".github/workflows/npm-release.yml")
  assert.equal(
    existsSync(workflowPath),
    true,
    "npm release workflow should exist",
  )

  const workflow = await readText(".github/workflows/npm-release.yml")
  assert.match(workflow, /name:\s*Publish first-class BharatCode CLI cohort/)
  assert.match(workflow, /workflow_dispatch:/)
  assert.doesNotMatch(workflow, /^\s*push:/m)
  assert.doesNotMatch(workflow, /^\s*release:/m)
  assert.match(workflow, /id-token:\s*write/)
  assert.match(workflow, /registry-url:\s*https:\/\/registry\.npmjs\.org/)
  assert.match(workflow, /desktop-beta-1\.15\.25/)
  assert.match(workflow, /bharatcode-next-beta-cohort\.json/)
  assert.match(
    workflow,
    /gh attestation verify release-input\/bharatcode-next-beta-cohort\.json/,
  )
  assert.match(workflow, /gh attestation verify "\$subject"/)
  assert.match(workflow, /--source-digest "\$DESKTOP_SOURCE_SHA"/)
  assert.match(
    workflow,
    /node scripts\/first-class-cohort-release\.mjs release-input/,
  )
  assert.match(
    workflow,
    /npm publish "\$package" --tag next --access public --provenance/,
  )
  assert.match(
    workflow,
    /local package="\.\/release-input\/\$name-\$CLI_VERSION\.tgz"/,
  )
  assert.match(workflow, /promote_or_verify bharatcode/)
  assert.match(workflow, /environment:\s*npm-next/)
  assert.match(workflow, /environment:\s*npm-latest/)
  assert.match(
    workflow,
    /npx --yes "npm@\$npm_major" install[\s\S]*"bharatcode@\$CLI_VERSION"/,
  )
  assert.match(workflow, /NPM_TOKEN/)
  assert.equal(
    workflow.match(/NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}/g)?.length,
    2,
  )
  assert.doesNotMatch(workflow, /^ {0,8}NODE_AUTH_TOKEN:/m)
  assert.doesNotMatch(workflow, /npm pack|opencode-ai|--force|--ignore-scripts/)
  const platformPublish = workflow.indexOf(
    'for name in "${PLATFORM_PACKAGE_NAMES[@]}"; do publish_or_verify "$name"; done',
  )
  const metaPublish = workflow.indexOf("publish_or_verify bharatcode")
  const installedSmoke = workflow.indexOf("for npm_major in 11 12; do")
  const latest = workflow.indexOf("promote_or_verify bharatcode")
  assert.ok(
    platformPublish >= 0 &&
      platformPublish < metaPublish &&
      metaPublish < installedSmoke &&
      installedSmoke < latest,
    "platform publication, meta publication, installed smoke, and latest promotion must stay ordered",
  )
})

test("npm publication recovery converges only on byte-identical registry packages", async () => {
  const workflow = await readText(".github/workflows/npm-release.yml")
  assert.match(workflow, /publish_or_verify\(\)/)
  assert.match(workflow, /npm view "\$name@\$CLI_VERSION" version/)
  assert.match(workflow, /sha256sum registry-existing\.tgz/)
  assert.match(
    workflow,
    /npm publish "\$package" --tag next --access public --provenance/,
  )
  assert.match(
    workflow,
    /local package="\.\/release-input\/\$name-\$CLI_VERSION\.tgz"/,
  )
  assert.match(workflow, /Verify registry closure and create next receipt/)
  assert.match(workflow, /bharatcode-first-class-cli-next\.json/)
  assert.doesNotMatch(
    workflow,
    /continue-on-error:\s*true|npm publish[^\n]*(?:\|\|\s*true|;\s*true)/,
  )
})

test("npm recovery preserves the exact attempt-one package and requires an explicit admin bypass", async () => {
  const workflow = await readText(".github/workflows/npm-release-recovery.yml")
  const runtime = await readText("scripts/verify-npm-release-runtime.mjs")

  assert.match(workflow, /name:\s*Recover npm 0\.2\.10 publication/)
  assert.match(workflow, /workflow_dispatch:/)
  assert.doesNotMatch(workflow, /^\s*push:/m)
  assert.match(
    workflow,
    /PACKAGE_SOURCE_SHA:\s*9cb1c18535dc9cfcd49cadeeec152bd580e588e4/,
  )
  assert.match(
    workflow,
    /PACKAGE_SHA256:\s*c7e5352994d9b0b9a03ce8a576addeff943182a156bf89b2d78249ce904e2953/,
  )
  assert.match(workflow, /SOURCE_RUN_ID:\s*["']33812971614["']/)
  assert.match(workflow, /SOURCE_RUN_ATTEMPT:\s*["']1["']/)
  assert.match(workflow, /SOURCE_ARTIFACT_ID:\s*["']9915607947["']/)
  assert.match(
    workflow,
    /SOURCE_ARTIFACT_DIGEST:\s*sha256:7cc210b4ba69cf3f7472f697b0af3456ea56b75f1a594ab85ced0b723d57a308/,
  )
  assert.match(
    workflow,
    /actions\/runs\/\$SOURCE_RUN_ID\/attempts\/\$SOURCE_RUN_ATTEMPT/,
  )
  assert.match(
    workflow,
    /validateRecoverySourceEvidence\(\{ artifacts, jobs, run \}\)/,
  )
  assert.doesNotMatch(workflow, /artifacts\.length\s*!==\s*1/)
  assert.match(workflow, /gh attestation verify bharatcode-0\.2\.10\.tgz/)
  assert.match(workflow, /RELEASE_CONTROLLER_SHA:\s*\$\{\{ github\.sha \}\}/)
  assert.equal(
    workflow.match(/RELEASE_APPROVAL_MODE:\s*owner-admin-bypass-v1/g)?.length,
    2,
  )
  assert.equal(workflow.match(/OWNER_BYPASS_ACTOR:\s*shrey16/g)?.length, 2)
  assert.match(
    runtime,
    /collaborators\/\$\{encodeURIComponent\(bypassActor\)\}\/permission/,
  )
  assert.match(
    workflow,
    /npm publish bharatcode-0\.2\.10\.tgz --tag next --access public --provenance/,
  )
  assert.match(workflow, /npm dist-tag add bharatcode@0\.2\.10 latest/)
  assert.doesNotMatch(workflow, /npm pack|gh release|git tag|git push|--force/)
})

test("npm recovery converges without replaying an exact published package or latest tag", async () => {
  const workflow = await readText(".github/workflows/npm-release-recovery.yml")

  assert.match(workflow, /id:\s*package-state/)
  assert.match(workflow, /already_published=true/)
  assert.match(workflow, /sha256sum registry-existing\.tgz/)
  assert.match(
    workflow,
    /Exact package and next tag already exist; skipping npm publish\./,
  )
  assert.match(workflow, /steps\.package-state\.outputs\.already_published/)
  assert.match(workflow, /already_latest=true/)
  assert.match(
    workflow,
    /Exact latest tag already exists; skipping dist-tag mutation\./,
  )
  assert.match(workflow, /steps\.next\.outputs\.already_latest/)
  assert.match(workflow, /for delay in 0 2 4 8 16 30/)
  assert.doesNotMatch(
    workflow,
    /Exact version already exists; refusing replay or overwrite/,
  )
})

test("npm release review authority requires explicit protected approval evidence", async () => {
  const policy = await readText("docs/release-review-authority.md")

  assert.match(policy, /`npm-next` requires approval from `Pankaj-IIT`/)
  assert.match(
    policy,
    /`npm-latest` requires a separate approval from `satyamlohiya`/,
  )
  assert.match(policy, /`prevent_self_review` enabled/)
  assert.match(policy, /owner-admin-bypass-v1/)
  assert.match(policy, /exact `shrey16` bypass actor/i)
  assert.match(policy, /missing or foreign bypass record/i)
  assert.match(policy, /attempt-one package\s+artifact/i)
  assert.match(policy, /authoritative\s+workflow-run\s+review history/i)
  assert.match(policy, /annotated tag object/i)
  assert.match(policy, /registry-installed\s+behavioral smoke/i)
  assert.match(policy, /no tag ruleset is currently configured/i)
  assert.match(
    policy,
    /Approval or bypass evidence for\s+`npm-next` cannot be reused for `npm-latest`/,
  )
  assert.match(policy, /assignment does not authorize publication by itself/i)
  assert.match(
    policy,
    /None of\s+these assignments permits a workflow dispatch, npm publication, dist-tag\s+change/i,
  )
})

test("package metadata describes the BharatCode CLI release boundary", async () => {
  const pkg = JSON.parse(await readText("package.json"))

  assert.equal(
    pkg.description,
    "BharatCode CLI for OAuth-based coding with the BharatCode public beta.",
  )
  assert.ok(pkg.files.includes("docs/setup.md"))
  assert.ok(pkg.files.includes("docs/compatibility.md"))
  assert.equal(pkg.files.includes("docs/opencode-setup.md"), false)
  assert.equal(pkg.files.includes("docs/opencode-rebrand-path.md"), false)
  assert.ok(pkg.keywords.includes("bharatcode"))
  assert.equal(pkg.keywords.includes("opencode-plugin"), false)
})

test("README is CLI-first and documents npm installation plus release path", async () => {
  const readme = await readText("README.md")

  assert.match(readme, /^# BharatCode CLI/)
  assert.match(readme, /npm install -g bharatcode/)
  assert.match(readme, /bharatcode \./)
  assert.match(readme, /## Release Path/)
  assert.doesNotMatch(readme, /public beta website/i)
  assert.doesNotMatch(readme, /apps\/web/)
  assert.doesNotMatch(readme, /infra\//)
  assert.doesNotMatch(readme, /stt\//)
  assert.doesNotMatch(readme, /OpenCode plugin/)
})

test("setup and compatibility docs keep OpenCode as dependency context, not product framing", async () => {
  const setup = await readText("docs/setup.md")
  const compatibility = await readText("docs/compatibility.md")

  assert.match(setup, /^# BharatCode CLI Setup/)
  assert.doesNotMatch(setup, /OpenCode Desktop/)
  assert.doesNotMatch(setup, /OpenCode VS Code/)
  assert.doesNotMatch(setup, /rebrand checklist/i)
  assert.match(compatibility, /BharatCode uses the OpenCode engine/)
  assert.match(compatibility, /OpenCode is an upstream runtime dependency/)
})

test("CLI visible copy is BharatCode-first", async () => {
  const cli = await readText("bin/bharatcode.js")
  const config = await readText("lib/opencode-config.js")

  assert.match(cli, /Launch BharatCode from the current project/)
  assert.match(cli, /Check auth\/config\/BharatCode engine wiring/)
  assert.match(cli, /BharatCode engine config: ok/)
  assert.match(cli, /BharatCode engine:/)
  assert.doesNotMatch(cli, /Launch OpenCode through the BharatCode wrapper/)
  assert.doesNotMatch(cli, /OpenCode config:/)
  assert.doesNotMatch(cli, /opencode config:/)
  assert.doesNotMatch(cli, /opencode engine:/)
  assert.doesNotMatch(config, /OpenCode plugin installer/)
})
