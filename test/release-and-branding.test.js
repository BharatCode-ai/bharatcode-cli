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

test("npm release workflow publishes only from explicit release channels", async () => {
  const workflowPath = resolve(repoRoot, ".github/workflows/npm-release.yml")
  assert.equal(existsSync(workflowPath), true, "npm release workflow should exist")

  const workflow = await readText(".github/workflows/npm-release.yml")
  assert.match(workflow, /name:\s*Publish npm package/)
  assert.match(workflow, /release:\s*\n\s*types:\s*\[published\]/)
  assert.match(workflow, /workflow_dispatch:/)
  assert.doesNotMatch(workflow, /^\s*push:/m)
  assert.match(workflow, /id-token:\s*write/)
  assert.match(workflow, /registry-url:\s*["']https:\/\/registry\.npmjs\.org["']/)
  assert.match(workflow, /npm test/)
  assert.match(workflow, /npm run audit:oss:repo/)
  assert.match(workflow, /npm run pack:check/)
  assert.match(workflow, /npm publish --dry-run --access public/)
  assert.match(workflow, /npm publish --access public --provenance/)
  assert.match(workflow, /NPM_TOKEN/)
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
