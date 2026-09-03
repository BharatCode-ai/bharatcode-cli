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

test("npm release workflow protects next smoke and latest promotion", async () => {
  const workflowPath = resolve(repoRoot, ".github/workflows/npm-release.yml")
  assert.equal(existsSync(workflowPath), true, "npm release workflow should exist")

  const workflow = await readText(".github/workflows/npm-release.yml")
  const installedSmoke = await readText("scripts/verify-installed-cli.mjs")
  assert.match(workflow, /name:\s*Publish npm package/)
  assert.match(workflow, /workflow_dispatch:/)
  assert.doesNotMatch(workflow, /^\s*push:/m)
  assert.doesNotMatch(workflow, /^\s*release:/m)
  assert.match(workflow, /id-token:\s*write/)
  assert.match(workflow, /registry-url:\s*["']https:\/\/registry\.npmjs\.org["']/)
  assert.match(workflow, /npm test/)
  assert.match(workflow, /npm run audit:oss:repo/)
  assert.match(workflow, /npm run pack:check/)
  assert.match(workflow, /npm publish .*--tag next --access public --provenance/)
  assert.match(workflow, /npm dist-tag add bharatcode@0\.2\.10 latest/)
  assert.match(workflow, /environment:\s*npm-next/)
  assert.match(workflow, /environment:\s*npm-latest/)
  assert.equal(workflow.match(/actions:\s*read/g)?.length, 2)
  const runtimeChecks = [...workflow.matchAll(/node scripts\/verify-npm-release-runtime\.mjs/g)].map((match) => match.index)
  assert.equal(runtimeChecks.length, 3)
  assert.match(workflow, /REQUIRED_REVIEWER:\s*Pankaj-IIT/)
  assert.match(workflow, /REQUIRED_REVIEWER:\s*satyamlohiya/)
  assert.equal(workflow.match(/ADMITTED_TAG_OBJECT_SHA:/g)?.length, 2)
  assert.match(workflow, /bharatcode-cli-registry-smoke\.json/)
  assert.match(workflow, /bharatcode-cli-next-gate-/)
  assert.match(workflow, /bharatcode-cli-latest-gate-/)
  assert.match(workflow, /npm install[\s\S]*--registry=https:\/\/registry\.npmjs\.org "\$PACKAGE_NAME@\$PACKAGE_VERSION"/)
  assert.match(installedSmoke, /\["--version"\]/)
  assert.match(installedSmoke, /qwen36-35b-q6-256k-vision/)
  assert.match(installedSmoke, /qwen36-35b-q8-256k/)
  assert.equal(workflow.match(/RELEASE_SUBJECT_SHA256:/g)?.length, 2)
  assert.match(workflow, /cli-v0\.2\.10/)
  assert.match(workflow, /0\.2\.9/)
  assert.match(workflow, /NPM_TOKEN/)
  assert.equal(workflow.match(/NODE_AUTH_TOKEN:/g)?.length, 2)
  assert.doesNotMatch(workflow, /^ {0,8}NODE_AUTH_TOKEN:/m)
  assert.doesNotMatch(workflow, /--force|--ignore-scripts/)
  assert.ok(
    runtimeChecks[1] < workflow.indexOf("npm publish bharatcode-0.2.10.tgz") &&
      workflow.indexOf("npm publish bharatcode-0.2.10.tgz") < runtimeChecks[2],
    "approval and tag checks must precede npm publish",
  )
  assert.ok(
    runtimeChecks[2] < workflow.indexOf("npm dist-tag add bharatcode@0.2.10 latest"),
    "independent approval and tag checks must precede latest promotion",
  )
})

test("npm release review authority is split and cannot authorize itself", async () => {
  const policy = await readText("docs/release-review-authority.md")

  assert.match(policy, /`npm-next` requires approval from `Pankaj-IIT`/)
  assert.match(policy, /`npm-latest` requires a separate approval from `satyamlohiya`/)
  assert.match(policy, /`prevent_self_review` enabled/)
  assert.match(policy, /administrator bypass is not accepted as review evidence/i)
  assert.match(policy, /authoritative\s+workflow-run review history/i)
  assert.match(policy, /annotated tag object/i)
  assert.match(policy, /registry-installed\s+behavioral smoke/i)
  assert.match(policy, /no tag ruleset is currently configured/i)
  assert.match(policy, /Approval for\s+`npm-next` cannot be reused for `npm-latest`/)
  assert.match(policy, /assignment does not authorize publication by itself/i)
  assert.match(policy, /None of\s+these assignments permits a workflow dispatch, npm publication, dist-tag\s+change/i)
})

test("package metadata describes the BharatCode CLI release boundary", async () => {
  const pkg = JSON.parse(await readText("package.json"))

  assert.equal(pkg.description, "BharatCode CLI for OAuth-based coding with the BharatCode public beta.")
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
