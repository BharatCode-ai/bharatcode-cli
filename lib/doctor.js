import { access, readFile, stat } from "node:fs/promises"
import { constants as fsConstants } from "node:fs"
import path from "node:path"

import { credentialsPath, TOKEN_REFRESH_SKEW_SECONDS } from "./bharatcode-auth.js"
import { defaultOpenCodeConfigPath } from "./opencode-config.js"

// Severity levels a finding can carry. `error` flips doctor's exit code to 1.
export const DoctorStatus = Object.freeze({
  OK: "ok",
  WARN: "warn",
  ERROR: "error",
})

// Stable, machine-readable codes for each diagnosable state. The CLI renderer
// maps these to human prose; tests assert on the codes, not the wording.
export const DoctorCode = Object.freeze({
  CREDENTIALS_OK: "CREDENTIALS_OK",
  CREDENTIALS_MISSING: "CREDENTIALS_MISSING",
  CREDENTIALS_UNREADABLE: "CREDENTIALS_UNREADABLE",
  CREDENTIALS_CORRUPT: "CREDENTIALS_CORRUPT",
  CREDENTIALS_PERMISSIONS_BROAD: "CREDENTIALS_PERMISSIONS_BROAD",
  TOKEN_EXPIRED_REFRESHABLE: "TOKEN_EXPIRED_REFRESHABLE",
  TOKEN_EXPIRING_REFRESHABLE: "TOKEN_EXPIRING_REFRESHABLE",
  TOKEN_REFRESH_ONLY: "TOKEN_REFRESH_ONLY",
  REFRESH_MISSING_DEGRADED: "REFRESH_MISSING_DEGRADED",
  SESSION_UNUSABLE: "SESSION_UNUSABLE",
  ENGINE_CONFIG_OK: "ENGINE_CONFIG_OK",
  ENGINE_CONFIG_MISSING: "ENGINE_CONFIG_MISSING",
  ENGINE_CONFIG_NOT_WRITABLE: "ENGINE_CONFIG_NOT_WRITABLE",
  ENGINE_CONFIG_ERROR: "ENGINE_CONFIG_ERROR",
})

// A heuristic "this is a real token" check used to tell a present-but-blank or
// placeholder token from a usable one. Never inspects token *value* meaning.
export function looksLikeToken(value) {
  if (typeof value !== "string") return false
  const trimmed = value.trim()
  return trimmed.length >= 10 && !/\s/.test(trimmed)
}

// POSIX file mode is meaningless on Windows, so broad-permission warnings are
// suppressed there; elsewhere any group/other bit is "too broad" for a secret.
export function isPermissionTooBroad(mode, platform = process.platform) {
  if (platform === "win32") return false
  if (typeof mode !== "number") return false
  return (mode & 0o077) !== 0
}

function nowSeconds(options) {
  return Number.isFinite(options.now) ? options.now : Math.floor(Date.now() / 1000)
}

function classifyTokens(credentials, { now, file }) {
  const hasAccess = looksLikeToken(credentials.access_token)
  const hasRefresh = looksLikeToken(credentials.refresh_token)
  const expiresAt = Number.isFinite(credentials.expires_at) ? credentials.expires_at : null
  const secondsLeft = expiresAt === null ? null : expiresAt - now
  const expired = secondsLeft !== null && secondsLeft <= 0
  const expiring = secondsLeft !== null && secondsLeft > 0 && secondsLeft <= TOKEN_REFRESH_SKEW_SECONDS
  const meta = { file, expiresAt, secondsLeft }

  if (!hasAccess && !hasRefresh) {
    return { code: DoctorCode.SESSION_UNUSABLE, level: DoctorStatus.ERROR, ...meta }
  }
  if (hasRefresh) {
    if (!hasAccess) return { code: DoctorCode.TOKEN_REFRESH_ONLY, level: DoctorStatus.WARN, ...meta }
    if (expired) return { code: DoctorCode.TOKEN_EXPIRED_REFRESHABLE, level: DoctorStatus.WARN, ...meta }
    if (expiring) return { code: DoctorCode.TOKEN_EXPIRING_REFRESHABLE, level: DoctorStatus.WARN, ...meta }
    return { code: DoctorCode.CREDENTIALS_OK, level: DoctorStatus.OK, ...meta }
  }
  // Has a usable access token but no usable refresh token.
  if (expired) return { code: DoctorCode.SESSION_UNUSABLE, level: DoctorStatus.ERROR, ...meta }
  return { code: DoctorCode.REFRESH_MISSING_DEGRADED, level: DoctorStatus.WARN, ...meta }
}

// Read-only inspection of the credentials file: reachability, parseability,
// token/session state, and (POSIX only) an over-broad-permissions warning.
export async function diagnoseAuth(options = {}) {
  const file = credentialsPath(options)
  const now = nowSeconds(options)
  const platform = options.platform || process.platform

  let raw
  try {
    raw = await readFile(file, "utf8")
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [{ code: DoctorCode.CREDENTIALS_MISSING, level: DoctorStatus.ERROR, file }]
    }
    return [
      { code: DoctorCode.CREDENTIALS_UNREADABLE, level: DoctorStatus.ERROR, file, errno: error?.code || "EUNKNOWN" },
    ]
  }

  let credentials
  try {
    credentials = JSON.parse(raw)
  } catch {
    return [{ code: DoctorCode.CREDENTIALS_CORRUPT, level: DoctorStatus.ERROR, file }]
  }
  if (credentials === null || typeof credentials !== "object" || Array.isArray(credentials)) {
    return [{ code: DoctorCode.CREDENTIALS_CORRUPT, level: DoctorStatus.ERROR, file }]
  }

  const findings = [classifyTokens(credentials, { now, file })]

  if (platform !== "win32") {
    try {
      const mode = (await stat(file)).mode & 0o777
      if (isPermissionTooBroad(mode, platform)) {
        findings.push({ code: DoctorCode.CREDENTIALS_PERMISSIONS_BROAD, level: DoctorStatus.WARN, file, mode })
      }
    } catch {
      // A stat failure here is non-fatal: the primary finding already covers
      // whether the file could be read; we just skip the permission warning.
    }
  }

  return findings
}

async function isWritable(target) {
  try {
    await access(target, fsConstants.W_OK)
    return true
  } catch {
    return false
  }
}

async function nearestExistingAncestor(dir) {
  let current = dir
  while (true) {
    try {
      await access(current, fsConstants.F_OK)
      return current
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return null
      current = parent
    }
  }
}

// Read-only writability check for the engine config. Never creates or mutates
// the file — that is `opencode configure`'s job, not the doctor's.
export async function diagnoseEngineConfig(options = {}) {
  const configPath = defaultOpenCodeConfigPath({
    home: options.engineHome,
    configPath: options.engineConfigPath,
  })

  try {
    await access(configPath, fsConstants.W_OK)
    return { code: DoctorCode.ENGINE_CONFIG_OK, level: DoctorStatus.OK, configPath }
  } catch (error) {
    if (error?.code === "ENOENT") {
      const ancestor = await nearestExistingAncestor(path.dirname(configPath))
      const writable = ancestor !== null && (await isWritable(ancestor))
      return writable
        ? { code: DoctorCode.ENGINE_CONFIG_MISSING, level: DoctorStatus.WARN, configPath }
        : { code: DoctorCode.ENGINE_CONFIG_NOT_WRITABLE, level: DoctorStatus.ERROR, configPath }
    }
    if (error?.code === "EACCES" || error?.code === "EPERM") {
      return { code: DoctorCode.ENGINE_CONFIG_NOT_WRITABLE, level: DoctorStatus.ERROR, configPath }
    }
    return { code: DoctorCode.ENGINE_CONFIG_ERROR, level: DoctorStatus.ERROR, configPath, errno: error?.code || "EUNKNOWN" }
  }
}

// Aggregate every check into one report. Exit code is 1 if any finding is an
// error; recoverable warnings (expired-but-refreshable, broad perms, config
// missing) keep doctor succeeding.
export async function collectDoctorReport(options = {}) {
  const authChecks = await diagnoseAuth(options)
  const engineCheck = await diagnoseEngineConfig(options)
  const checks = [...authChecks, engineCheck]
  const exitCode = checks.some((check) => check.level === DoctorStatus.ERROR) ? 1 : 0
  return { checks, exitCode }
}
