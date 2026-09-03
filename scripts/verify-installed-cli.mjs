#!/usr/bin/env node
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const packageRoot = resolve(process.argv[2] || "")
const outputPath = process.env.SMOKE_RESULT_PATH
const credentialsPath = process.env.BHARATCODE_CREDENTIALS_PATH
if (!process.argv[2] || !outputPath || !credentialsPath) throw new Error("installed package, smoke output and isolated credentials are required")

const expectedVersion = "0.2.10"
const canonicalModel = "bharatcode/bharatcode:qwen36-35b-awq-200k"
const canonicalModelId = "bharatcode:qwen36-35b-awq-200k"
const retiredModels = [
  "bharatcode/bharatcode:qwen36-35b-q6-256k-vision",
  "bharatcode/bharatcode:qwen36-35b-q8-256k",
]
const credentialsBefore = readFileSync(credentialsPath)
const authDirectoryBefore = readdirSync(dirname(credentialsPath)).sort()
const cliVersion = execFileSync(resolve(packageRoot, "bin/bharatcode.js"), ["--version"], {
  encoding: "utf8",
  env: {
    ...process.env,
    BHARATCODE_ACCESS_TOKEN: "",
    BHARATCODE_API_KEY: "",
    OPENCODE_BHARATCODE_API_KEY: "",
  },
}).trim()
assert.equal(cliVersion, expectedVersion)

let networkCalls = 0
const forbiddenFetch = async () => {
  networkCalls += 1
  throw new Error("registry behavior smoke forbids network calls")
}
globalThis.fetch = forbiddenFetch

const { BharatCodePlugin } = await import(pathToFileURL(resolve(packageRoot, "index.js")))
const { DEFAULT_OPENCODE_MODEL, opencodeArgsFromCliArgs } = await import(pathToFileURL(resolve(packageRoot, "lib/cli-args.js")))
assert.equal(DEFAULT_OPENCODE_MODEL, canonicalModel)

const plugin = await BharatCodePlugin({}, {
  accessToken: "registry-smoke-token",
  fetchImpl: forbiddenFetch,
})
const config = {}
await plugin.config(config)
assert.equal(config.model, canonicalModel)
assert.equal(config.small_model, canonicalModel)
assert.deepEqual(Object.keys(config.provider.bharatcode.models), [canonicalModelId])
assert.deepEqual(opencodeArgsFromCliArgs(["run", "."]), ["run", "--model", canonicalModel, "."])

for (const model of retiredModels) {
  assert.throws(() => opencodeArgsFromCliArgs(["run", "--model", model, "."]), /supports only/)
  const retired = await BharatCodePlugin({}, { accessToken: "registry-smoke-token", model })
  await assert.rejects(() => retired.config({}), /supports only/)
}

const credentialsAfter = readFileSync(credentialsPath)
assert.deepEqual(credentialsAfter, credentialsBefore)
assert.deepEqual(readdirSync(dirname(credentialsPath)).sort(), authDirectoryBefore)
assert.equal(networkCalls, 0)

writeFileSync(
  outputPath,
  JSON.stringify({
    canonical_config: true,
    cli_version: cliVersion,
    credentials_unchanged: true,
    network_calls: networkCalls,
    retired_models_rejected: true,
  }),
  { mode: 0o600 },
)
