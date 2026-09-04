#!/usr/bin/env node
import { readFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import path from "node:path"

import {
  browserOpenCommand,
  clearCredentials,
  credentialsPath,
  credentialsSummary,
  getCredentials,
  loginWithBrowser,
} from "../lib/bharatcode-auth.js"
import { opencodeArgsFromCliArgs } from "../lib/cli-args.js"
import {
  ensureBharatCodePlugin,
  installBharatCodeOpenCodePlugin,
} from "../lib/opencode-config.js"
import { collectDoctorReport, DoctorCode } from "../lib/doctor.js"

const require = createRequire(import.meta.url)
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))

function printHelp() {
  console.log(`BharatCode public beta

Usage:
  bharatcode --version        Print the installed BharatCode CLI version
  bharatcode auth login       Sign in with BharatCode OAuth
  bharatcode auth status      Show the local BharatCode session
  bharatcode auth logout      Remove local BharatCode credentials
  bharatcode opencode configure
                             Prepare the BharatCode engine config
  bharatcode doctor           Check auth/config/BharatCode engine wiring
  bharatcode [args]           Launch BharatCode from the current project

No user API keys are required. Run \`bharatcode .\` from a project; the CLI opens browser login and configures BharatCode when needed.`)
}

function userLabel(user) {
  return (
    user?.preferred_username ||
    user?.user_name ||
    user?.name ||
    user?.email ||
    user?.sub ||
    "BharatCode user"
  )
}

async function resolveOpenCodeBin() {
  if (process.env.BHARATCODE_OPENCODE_BIN) return process.env.BHARATCODE_OPENCODE_BIN
  try {
    const packageJsonPath = require.resolve("opencode-ai/package.json")
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"))
    const bin = typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin?.opencode
    if (bin) return path.join(path.dirname(packageJsonPath), bin)
  } catch {
    return "opencode"
  }
  return "opencode"
}

function spawnOpenCode(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env })
    child.on("error", reject)
    child.on("exit", (code, signal) => {
      if (signal) reject(new Error(`OpenCode exited with signal ${signal}`))
      else resolve(code ?? 0)
    })
  })
}

async function authLogin() {
  console.log("Opening BharatCode OAuth in your browser...")
  const credentials = await loginWithBrowser({
    open: (url) => {
      console.log(url)
      const { command, args } = browserOpenCommand(url)
      const child = spawn(command, args, { detached: true, stdio: "ignore" })
      child.unref()
    },
  })
  console.log(`Authenticated as ${userLabel(credentials.user)}.`)
  console.log("Plan: Public beta.")
  console.log("Ready.")
  return credentials
}

async function authStatus() {
  const summary = await credentialsSummary()
  if (!summary.authenticated) {
    console.log("Not authenticated. Run `bharatcode auth login`.")
    return 1
  }

  const expiresAt = summary.expires_at
    ? new Date(summary.expires_at * 1000).toISOString()
    : "unknown"
  console.log(`Authenticated as ${userLabel(summary.user)}.`)
  console.log(`Credentials: ${summary.file}`)
  console.log(`Access token expires: ${expiresAt}`)
  if (summary.file_mode !== null && (summary.file_mode & 0o077) !== 0) {
    console.log("Warning: credentials file is readable by other users. Re-run `bharatcode auth login`.")
    return 1
  }
  return 0
}

async function authLogout() {
  await clearCredentials()
  console.log("Removed local BharatCode credentials.")
}

async function configureOpenCode({ quiet = false } = {}) {
  const opencodeBin = await resolveOpenCodeBin()
  const result = await ensureBharatCodePlugin()
  const install = await installBharatCodeOpenCodePlugin({ opencodeBin, quiet })
  if (!quiet) {
    console.log(`Installed BharatCode engine package: ${install.moduleName}`)
    console.log(`${result.changed ? "Updated" : "Already configured"} BharatCode engine config: ${result.configPath}`)
  }
  return { ...result, install, opencodeBin }
}

function isoFromUnix(seconds) {
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : "unknown"
}

function renderDoctorCheck(check) {
  switch (check.code) {
    case DoctorCode.CREDENTIALS_OK:
      return `auth: ok (${check.file})`
    case DoctorCode.CREDENTIALS_MISSING:
      return `auth: missing — no credentials file at ${check.file} (run \`bharatcode auth login\`)`
    case DoctorCode.CREDENTIALS_UNREADABLE:
      return `auth: unreadable — cannot read ${check.file} (${check.errno}) (fix permissions, then re-login)`
    case DoctorCode.CREDENTIALS_CORRUPT:
      return `auth: corrupt — ${check.file} is not valid JSON (re-run \`bharatcode auth login\`)`
    case DoctorCode.CREDENTIALS_PERMISSIONS_BROAD:
      return `auth: insecure — ${check.file} is readable by other users (mode 0o${check.mode.toString(8)}); run \`chmod 600 ${check.file}\``
    case DoctorCode.TOKEN_EXPIRED_REFRESHABLE:
      return `auth: expired — access token expired (${isoFromUnix(check.expiresAt)}); refresh token present, auto-renews on next use`
    case DoctorCode.TOKEN_EXPIRING_REFRESHABLE:
      return `auth: expiring — access token expires soon (${isoFromUnix(check.expiresAt)}); refresh token present`
    case DoctorCode.TOKEN_REFRESH_ONLY:
      return "auth: refresh-only — no access token yet; refresh token present, minted on next use"
    case DoctorCode.REFRESH_MISSING_DEGRADED:
      return "auth: degraded — refresh token missing or invalid; access token still works but cannot be renewed (run `bharatcode auth login`)"
    case DoctorCode.SESSION_UNUSABLE:
      return "auth: missing — no usable access or refresh token (run `bharatcode auth login`)"
    case DoctorCode.ENGINE_CONFIG_OK:
      return `BharatCode engine config: ok (${check.configPath})`
    case DoctorCode.ENGINE_CONFIG_MISSING:
      return `BharatCode engine config: missing (${check.configPath}); created on next launch or run \`bharatcode opencode configure\``
    case DoctorCode.ENGINE_CONFIG_NOT_WRITABLE:
      return `BharatCode engine config: not writable (${check.configPath}); check directory permissions`
    case DoctorCode.ENGINE_CONFIG_ERROR:
      return `BharatCode engine config: error (${check.errno}) (${check.configPath})`
    default:
      return `auth: ${check.code}`
  }
}

async function doctor() {
  const { checks, exitCode } = await collectDoctorReport()
  for (const check of checks) console.log(renderDoctorCheck(check))
  console.log(`BharatCode engine: ${await resolveOpenCodeBin()}`)
  return exitCode
}

function missingSessionError(error) {
  return /No BharatCode|refresh token|session/i.test(error?.message || "")
}

async function launchCredentials() {
  try {
    return await getCredentials()
  } catch (error) {
    if (!missingSessionError(error)) throw error
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw error

    console.log("No BharatCode session found. Opening browser login before launching BharatCode...")
    return authLogin()
  }
}

async function launchOpenCode(args) {
  await launchCredentials()
  const configured = await configureOpenCode({ quiet: true })
  if (configured.changed) console.log(`Configured BharatCode engine: ${configured.configPath}`)
  const command = configured.opencodeBin
  const env = {
    ...process.env,
    BHARATCODE_CREDENTIALS_PATH: credentialsPath(),
  }
  delete env.BHARATCODE_ACCESS_TOKEN
  delete env.BHARATCODE_API_KEY
  delete env.OPENCODE_BHARATCODE_API_KEY
  return spawnOpenCode(command, args, env)
}

async function main() {
  const [command, subcommand, ...rest] = process.argv.slice(2)
  try {
    if (command === "--help" || command === "-h") {
      printHelp()
      return 0
    }
    if (command === "--version" || command === "-v" || command === "version") {
      console.log(packageJson.version)
      return 0
    }
    if (command === "auth" && subcommand === "login") {
      await authLogin()
      return 0
    }
    if (command === "auth" && subcommand === "status") return await authStatus()
    if (command === "auth" && subcommand === "logout") {
      await authLogout()
      return 0
    }
    if (command === "opencode" && subcommand === "configure") {
      await configureOpenCode()
      return 0
    }
    if (command === "doctor") return await doctor()
    return await launchOpenCode(opencodeArgsFromCliArgs(process.argv.slice(2)))
  } catch (error) {
    console.error(`bharatcode: ${error.message}`)
    if (missingSessionError(error)) {
      console.error("Run `bharatcode auth login` and try again.")
    }
    return 1
  }
}

process.exitCode = await main()
