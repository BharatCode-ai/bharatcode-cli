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

test("stale BharatCode config fields fail without mutation or auth/network side effects", async () => {
  const ids = [
    "bharatcode:qwen36-35b-q6-256k-vision",
    "bharatcode:qwen36-35b-q8-256k",
    "bharatcode:embed-small-v1",
    "bharatcode:unknown-coding-model",
  ]

  for (const field of ["model", "small_model"]) {
    for (const id of ids) {
      for (const value of [id, `bharatcode/${id}`]) {
        let fetchCount = 0
        const config = {
          [field]: value,
          unrelated: { provider: "external", enabled: true },
          provider: { external: { models: { existing: {} } } },
        }
        const before = JSON.stringify(config)
        const plugin = await BharatCodePlugin(null, {
          fetchImpl: async () => {
            fetchCount += 1
            throw new Error("must not fetch")
          },
        })

        await assert.rejects(plugin.config(config), /bharatcode\/bharatcode:qwen36-35b-awq-200k.*not translated/)
        assert.equal(JSON.stringify(config), before)
        assert.equal(fetchCount, 0)
      }
    }
  }
})

test("canonical existing config fields are idempotent", async () => {
  const config = { model: CODING_MODEL, small_model: CODING_MODEL }
  const plugin = await BharatCodePlugin(null, { accessToken: "test-token" })

  await plugin.config(config)

  assert.equal(config.model, CODING_MODEL)
  assert.equal(config.small_model, CODING_MODEL)
})

test("unrelated provider config retains the prior plugin behavior", async () => {
  const config = { model: "external/model", unrelated: { keep: true } }
  const plugin = await BharatCodePlugin(null, { accessToken: "test-token" })

  await plugin.config(config)

  assert.equal(config.model, CODING_MODEL)
  assert.deepEqual(config.unrelated, { keep: true })
})
