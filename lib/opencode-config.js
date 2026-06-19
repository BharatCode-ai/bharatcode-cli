import { spawn } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export const BHARATCODE_PLUGIN_MODULE = "bharatcode"

const DEFAULT_CONFIG = {
  $schema: "https://opencode.ai/config.json",
  plugin: [BHARATCODE_PLUGIN_MODULE],
}

export function defaultOpenCodeConfigPath({
  home = process.env.BHARATCODE_OPENCODE_HOME || os.homedir(),
  configPath = process.env.BHARATCODE_OPENCODE_CONFIG_PATH,
} = {}) {
  if (configPath) return configPath
  return path.join(home, ".config", "opencode", "opencode.jsonc")
}

function stripJsonComments(input) {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/,\s*([}\]])/g, "$1")
}

function formatConfig(config) {
  return `${JSON.stringify(config, null, 2)}\n`
}

function patchJsonConfig(raw) {
  const config = JSON.parse(stripJsonComments(raw || "{}"))
  const plugins = Array.isArray(config.plugin) ? config.plugin : []
  if (plugins.includes(BHARATCODE_PLUGIN_MODULE)) {
    return { changed: false, content: raw }
  }
  config.plugin = [...plugins, BHARATCODE_PLUGIN_MODULE]
  if (!config.$schema) config.$schema = "https://opencode.ai/config.json"
  return { changed: true, content: formatConfig(config) }
}

function patchJsoncFallback(raw) {
  const pluginArray = /("plugin"\s*:\s*\[)([\s\S]*?)(\])/m
  const match = raw.match(pluginArray)
  if (match) {
    if (/"bharatcode"/.test(match[2])) return { changed: false, content: raw }
    const existing = match[2].trim()
    const separator = existing ? ", " : ""
    return {
      changed: true,
      content: raw.replace(pluginArray, `$1${existing}${separator}"${BHARATCODE_PLUGIN_MODULE}"$3`),
    }
  }

  const objectStart = raw.indexOf("{")
  if (objectStart >= 0) {
    const insertAt = objectStart + 1
    return {
      changed: true,
      content: `${raw.slice(0, insertAt)}\n  "plugin": ["${BHARATCODE_PLUGIN_MODULE}"],${raw.slice(insertAt)}`,
    }
  }

  return { changed: true, content: formatConfig(DEFAULT_CONFIG) }
}

export async function ensureBharatCodePlugin({ configPath = defaultOpenCodeConfigPath() } = {}) {
  await mkdir(path.dirname(configPath), { recursive: true })
  let raw = ""
  try {
    raw = await readFile(configPath, "utf8")
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
    await writeFile(configPath, formatConfig(DEFAULT_CONFIG), { mode: 0o600 })
    return { changed: true, configPath }
  }

  const patch = (() => {
    try {
      return patchJsonConfig(raw)
    } catch {
      return patchJsoncFallback(raw)
    }
  })()

  if (patch.changed) {
    await writeFile(configPath, patch.content, { mode: 0o600 })
  }
  return { changed: patch.changed, configPath }
}

function spawnCommand(command, args, { stdio = "inherit" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio })
    child.on("error", reject)
    child.on("exit", (code, signal) => {
      if (signal) reject(new Error(`OpenCode plugin installer exited with signal ${signal}`))
      else if (code) reject(new Error(`OpenCode plugin installer failed with exit code ${code}`))
      else resolve()
    })
  })
}

export async function installBharatCodeOpenCodePlugin({
  opencodeBin = "opencode",
  runner = spawnCommand,
  quiet = false,
} = {}) {
  const args = ["plugin", BHARATCODE_PLUGIN_MODULE, "--global"]
  await runner(opencodeBin, args, { stdio: quiet ? "ignore" : "inherit" })
  return { moduleName: BHARATCODE_PLUGIN_MODULE, opencodeBin }
}
