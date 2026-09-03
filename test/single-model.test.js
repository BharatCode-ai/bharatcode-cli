import assert from "node:assert/strict"
import test from "node:test"

import { BharatCodePlugin } from "../index.js"
import { DEFAULT_OPENCODE_MODEL, opencodeArgsFromCliArgs } from "../lib/cli-args.js"

const CODING_MODEL_ID = "bharatcode:qwen36-35b-awq-200k"
const CODING_MODEL = `bharatcode/${CODING_MODEL_ID}`

test("the CLI and provider expose only the canonical BharatCode coding model", async () => {
  assert.equal(DEFAULT_OPENCODE_MODEL, CODING_MODEL)
  assert.deepEqual(opencodeArgsFromCliArgs([]), [".", "--model", CODING_MODEL])

  const config = {}
  const plugin = await BharatCodePlugin(null, { accessToken: "test-token" })
  await plugin.config(config)

  assert.equal(config.model, CODING_MODEL)
  assert.equal(config.small_model, CODING_MODEL)
  assert.deepEqual(Object.keys(config.provider.bharatcode.models), [CODING_MODEL_ID])
  assert.equal(config.provider.bharatcode.models[CODING_MODEL_ID].limit.output, 32000)
})

test("retired model IDs fail clearly and are never rewritten", async () => {
  for (const option of ["model", "small_model"]) {
    for (const model of [
      "bharatcode/bharatcode:qwen36-35b-q6-256k-vision",
      "bharatcode/bharatcode:qwen36-35b-q8-256k",
    ]) {
      assert.throws(
        () => opencodeArgsFromCliArgs([".", `--model=${model}`]),
        /bharatcode\/bharatcode:qwen36-35b-awq-200k.*not translated/,
      )
      const plugin = await BharatCodePlugin(null, {
        accessToken: "test-token",
        [option]: model,
      })
      await assert.rejects(plugin.config({}), /bharatcode\/bharatcode:qwen36-35b-awq-200k.*not translated/)
    }
  }
})
