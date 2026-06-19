export const DEFAULT_OPENCODE_MODEL = "bharatcode/bharatcode:qwen36-35b-q6-256k-vision"

const NO_MODEL_COMMANDS = new Set([
  "completion",
  "acp",
  "mcp",
  "attach",
  "debug",
  "providers",
  "auth",
  "agent",
  "upgrade",
  "uninstall",
  "models",
  "stats",
  "export",
  "import",
  "github",
  "session",
  "plugin",
  "plug",
  "db",
])

const RUN_OPTIONS_WITH_VALUE = new Set([
  "--command",
  "--session",
  "-s",
  "--model",
  "-m",
  "--agent",
  "--format",
  "--file",
  "-f",
  "--title",
  "--attach",
  "--password",
  "-p",
  "--username",
  "-u",
  "--dir",
  "--port",
  "--variant",
  "--replay-limit",
  "--log-level",
])

function hasExplicitModel(args) {
  return args.some((arg) => arg === "--model" || arg === "-m" || arg.startsWith("--model=") || arg.startsWith("-m="))
}

function shouldInjectModel(args) {
  if (hasExplicitModel(args)) return false
  const first = args[0]
  if (!first) return true
  return !NO_MODEL_COMMANDS.has(first)
}

function runModelInsertIndex(args, runIndex) {
  let index = runIndex + 1
  while (index < args.length) {
    const arg = args[index]
    if (arg === "--") return index
    if (!arg.startsWith("-")) return index
    if (arg.includes("=")) {
      index += 1
      continue
    }
    index += RUN_OPTIONS_WITH_VALUE.has(arg) ? 2 : 1
  }
  return args.length
}

function injectModel(args) {
  const runIndex = args.indexOf("run")
  if (runIndex >= 0) {
    const insertAt = runModelInsertIndex(args, runIndex)
    return [
      ...args.slice(0, insertAt),
      "--model",
      DEFAULT_OPENCODE_MODEL,
      ...args.slice(insertAt),
    ]
  }
  return [...args, "--model", DEFAULT_OPENCODE_MODEL]
}

export function opencodeArgsFromCliArgs(args = []) {
  const normalized = args.length ? args : ["."]
  if (!shouldInjectModel(normalized)) return normalized
  return injectModel(normalized)
}
