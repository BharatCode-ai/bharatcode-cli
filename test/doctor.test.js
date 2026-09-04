import test from "node:test"
import assert from "node:assert/strict"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

import {
  DoctorCode,
  DoctorStatus,
  collectDoctorReport,
  diagnoseAuth,
  diagnoseEngineConfig,
  isPermissionTooBroad,
  looksLikeToken,
} from "../lib/doctor.js"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const binPath = resolve(repoRoot, "bin/bharatcode.js")
const onWindows = process.platform === "win32"

// Fixed clock so token expiry classification is deterministic across runs.
const NOW = 1_700_000_000
// Placeholder tokens: >= 10 chars, no whitespace, no secret-like prefixes.
const ACCESS_TOKEN = "fake-access-token-0123456789"
const REFRESH_TOKEN = "fake-refresh-token-0123456789"

async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), "bharatcode-doctor-"))
  try {
    return await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function writeCreds(file, credentials, mode = 0o600) {
  await writeFile(file, JSON.stringify(credentials), { mode })
}

// --- looksLikeToken -------------------------------------------------------

test("looksLikeToken accepts a plausible token and rejects the rest", () => {
  assert.equal(looksLikeToken(ACCESS_TOKEN), true)
  assert.equal(looksLikeToken("  padded-token-value  "), true)

  assert.equal(looksLikeToken(""), false)
  assert.equal(looksLikeToken("short"), false)
  assert.equal(looksLikeToken("has internal space"), false)
  assert.equal(looksLikeToken(undefined), false)
  assert.equal(looksLikeToken(null), false)
  assert.equal(looksLikeToken(1234567890), false)
  assert.equal(looksLikeToken({ token: ACCESS_TOKEN }), false)
})

// --- isPermissionTooBroad -------------------------------------------------

test("isPermissionTooBroad flags POSIX group/other bits but never on win32", () => {
  // win32: POSIX bits are meaningless, always considered safe.
  assert.equal(isPermissionTooBroad(0o644, "win32"), false)
  assert.equal(isPermissionTooBroad(0o777, "win32"), false)

  // POSIX: any group/other bit is too broad for a secret.
  assert.equal(isPermissionTooBroad(0o600, "linux"), false)
  assert.equal(isPermissionTooBroad(0o400, "linux"), false)
  assert.equal(isPermissionTooBroad(0o644, "linux"), true)
  assert.equal(isPermissionTooBroad(0o640, "linux"), true)
  assert.equal(isPermissionTooBroad(0o604, "linux"), true)

  // Non-number mode is treated as not-broad rather than throwing.
  assert.equal(isPermissionTooBroad(undefined, "linux"), false)
})

// --- diagnoseAuth ---------------------------------------------------------

test("diagnoseAuth: missing credentials file", async () => {
  await withTempDir(async (dir) => {
    const findings = await diagnoseAuth({ credentialsPath: join(dir, "nope.json"), now: NOW })
    assert.equal(findings.length, 1)
    assert.equal(findings[0].code, DoctorCode.CREDENTIALS_MISSING)
    assert.equal(findings[0].level, DoctorStatus.ERROR)
  })
})

test("diagnoseAuth: corrupt (invalid JSON) credentials file", async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, "credentials.json")
    await writeFile(file, "{ this is not json", { mode: 0o600 })
    const findings = await diagnoseAuth({ credentialsPath: file, now: NOW })
    assert.equal(findings[0].code, DoctorCode.CREDENTIALS_CORRUPT)
    assert.equal(findings[0].level, DoctorStatus.ERROR)
  })
})

test("diagnoseAuth: non-object JSON is treated as corrupt", async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, "credentials.json")
    await writeFile(file, "null", { mode: 0o600 })
    const findings = await diagnoseAuth({ credentialsPath: file, now: NOW })
    assert.equal(findings[0].code, DoctorCode.CREDENTIALS_CORRUPT)
  })
})

test("diagnoseAuth: ok (valid, unexpired access + refresh)", async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, "credentials.json")
    await writeCreds(file, {
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
      expires_at: NOW + 100_000,
    })
    const findings = await diagnoseAuth({ credentialsPath: file, now: NOW })
    assert.equal(findings.length, 1)
    assert.equal(findings[0].code, DoctorCode.CREDENTIALS_OK)
    assert.equal(findings[0].level, DoctorStatus.OK)
  })
})

test("diagnoseAuth: expired access but refresh present (refreshable)", async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, "credentials.json")
    await writeCreds(file, {
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
      expires_at: NOW - 100,
    })
    const findings = await diagnoseAuth({ credentialsPath: file, now: NOW })
    assert.equal(findings[0].code, DoctorCode.TOKEN_EXPIRED_REFRESHABLE)
    assert.equal(findings[0].level, DoctorStatus.WARN)
  })
})

test("diagnoseAuth: access expiring within skew but refresh present", async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, "credentials.json")
    await writeCreds(file, {
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
      expires_at: NOW + 100,
    })
    const findings = await diagnoseAuth({ credentialsPath: file, now: NOW })
    assert.equal(findings[0].code, DoctorCode.TOKEN_EXPIRING_REFRESHABLE)
    assert.equal(findings[0].level, DoctorStatus.WARN)
  })
})

test("diagnoseAuth: refresh token only (no access yet)", async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, "credentials.json")
    await writeCreds(file, { refresh_token: REFRESH_TOKEN })
    const findings = await diagnoseAuth({ credentialsPath: file, now: NOW })
    assert.equal(findings[0].code, DoctorCode.TOKEN_REFRESH_ONLY)
    assert.equal(findings[0].level, DoctorStatus.WARN)
  })
})

test("diagnoseAuth: refresh missing but access still valid (degraded)", async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, "credentials.json")
    await writeCreds(file, { access_token: ACCESS_TOKEN, expires_at: NOW + 100_000 })
    const findings = await diagnoseAuth({ credentialsPath: file, now: NOW })
    assert.equal(findings[0].code, DoctorCode.REFRESH_MISSING_DEGRADED)
    assert.equal(findings[0].level, DoctorStatus.WARN)
  })
})

test("diagnoseAuth: both tokens missing -> session unusable", async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, "credentials.json")
    await writeCreds(file, { token_type: "bearer" })
    const findings = await diagnoseAuth({ credentialsPath: file, now: NOW })
    assert.equal(findings[0].code, DoctorCode.SESSION_UNUSABLE)
    assert.equal(findings[0].level, DoctorStatus.ERROR)
  })
})

test("diagnoseAuth: expired access with no refresh -> session unusable", async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, "credentials.json")
    await writeCreds(file, { access_token: ACCESS_TOKEN, expires_at: NOW - 100 })
    const findings = await diagnoseAuth({ credentialsPath: file, now: NOW })
    assert.equal(findings[0].code, DoctorCode.SESSION_UNUSABLE)
    assert.equal(findings[0].level, DoctorStatus.ERROR)
  })
})

test(
  "diagnoseAuth: over-broad file permissions add a warning",
  { skip: onWindows ? "POSIX permission bits are meaningless on win32" : false },
  async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "credentials.json")
      await writeCreds(file, {
        access_token: ACCESS_TOKEN,
        refresh_token: REFRESH_TOKEN,
        expires_at: NOW + 100_000,
      })
      await chmod(file, 0o644)
      const findings = await diagnoseAuth({ credentialsPath: file, now: NOW })

      // Primary finding still classifies the (valid) session.
      assert.equal(findings[0].code, DoctorCode.CREDENTIALS_OK)
      const broad = findings.find((f) => f.code === DoctorCode.CREDENTIALS_PERMISSIONS_BROAD)
      assert.ok(broad, "expected a broad-permissions warning")
      assert.equal(broad.level, DoctorStatus.WARN)
      assert.equal(typeof broad.mode, "number")
    })
  },
)

test("diagnoseAuth never includes token values in findings", async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, "credentials.json")
    await writeCreds(file, {
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
      expires_at: NOW - 100,
    })
    const findings = await diagnoseAuth({ credentialsPath: file, now: NOW })
    const serialized = JSON.stringify(findings)
    assert.ok(!serialized.includes(ACCESS_TOKEN))
    assert.ok(!serialized.includes(REFRESH_TOKEN))
  })
})

// --- diagnoseEngineConfig -------------------------------------------------

test("diagnoseEngineConfig: ok when config exists and is writable", async () => {
  await withTempDir(async (dir) => {
    const configPath = join(dir, "opencode.jsonc")
    await writeFile(configPath, "{}\n")
    const finding = await diagnoseEngineConfig({ engineConfigPath: configPath })
    assert.equal(finding.code, DoctorCode.ENGINE_CONFIG_OK)
    assert.equal(finding.level, DoctorStatus.OK)
  })
})

test("diagnoseEngineConfig: missing config but writable parent dir (warn)", async () => {
  await withTempDir(async (dir) => {
    const configPath = join(dir, "opencode.jsonc")
    const finding = await diagnoseEngineConfig({ engineConfigPath: configPath })
    assert.equal(finding.code, DoctorCode.ENGINE_CONFIG_MISSING)
    assert.equal(finding.level, DoctorStatus.WARN)
  })
})

test(
  "diagnoseEngineConfig: not writable when nearest ancestor is read-only",
  { skip: onWindows ? "directory permission bits are meaningless on win32" : false },
  async () => {
    await withTempDir(async (dir) => {
      const lockedDir = join(dir, "locked")
      await mkdir(lockedDir, { mode: 0o700 })
      const configPath = join(lockedDir, "opencode.jsonc")
      await chmod(lockedDir, 0o500)
      try {
        const finding = await diagnoseEngineConfig({ engineConfigPath: configPath })
        assert.equal(finding.code, DoctorCode.ENGINE_CONFIG_NOT_WRITABLE)
        assert.equal(finding.level, DoctorStatus.ERROR)
      } finally {
        // Restore write so the temp tree can be cleaned up.
        await chmod(lockedDir, 0o700)
      }
    })
  },
)

// --- collectDoctorReport --------------------------------------------------

test("collectDoctorReport: exit code 1 when any finding is an error", async () => {
  await withTempDir(async (dir) => {
    const report = await collectDoctorReport({
      credentialsPath: join(dir, "missing.json"),
      engineConfigPath: join(dir, "opencode.jsonc"),
      now: NOW,
    })
    assert.equal(report.exitCode, 1)
    assert.ok(report.checks.some((c) => c.code === DoctorCode.CREDENTIALS_MISSING))
  })
})

test("collectDoctorReport: exit code 0 when everything is ok", async () => {
  await withTempDir(async (dir) => {
    const credentialsPath = join(dir, "credentials.json")
    const engineConfigPath = join(dir, "opencode.jsonc")
    await writeCreds(credentialsPath, {
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
      expires_at: NOW + 100_000,
    })
    await writeFile(engineConfigPath, "{}\n")
    const report = await collectDoctorReport({ credentialsPath, engineConfigPath, now: NOW })
    assert.equal(report.exitCode, 0)
    assert.ok(report.checks.some((c) => c.code === DoctorCode.CREDENTIALS_OK))
    assert.ok(report.checks.some((c) => c.code === DoctorCode.ENGINE_CONFIG_OK))
  })
})

// --- end-to-end CLI -------------------------------------------------------

test("doctor CLI prints human-readable output without leaking tokens", async () => {
  await withTempDir(async (dir) => {
    const credentialsPath = join(dir, "credentials.json")
    const engineConfigPath = join(dir, "opencode.jsonc")
    // Expired-but-refreshable: a warning, so exit code stays 0 deterministically.
    await writeCreds(credentialsPath, {
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
      expires_at: 1_000_000_000,
    })

    const result = spawnSync(process.execPath, [binPath, "doctor"], {
      encoding: "utf8",
      env: {
        ...process.env,
        BHARATCODE_CREDENTIALS_PATH: credentialsPath,
        BHARATCODE_OPENCODE_CONFIG_PATH: engineConfigPath,
      },
    })

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /auth:/)
    assert.match(result.stdout, /BharatCode engine config:/)
    assert.match(result.stdout, /BharatCode engine:/)
    assert.ok(!result.stdout.includes(ACCESS_TOKEN), "stdout must not leak the access token")
    assert.ok(!result.stdout.includes(REFRESH_TOKEN), "stdout must not leak the refresh token")
  })
})
