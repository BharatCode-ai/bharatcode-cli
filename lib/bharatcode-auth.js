import crypto from "node:crypto"
import { createServer } from "node:http"
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"

export const BHARATCODE_SUPABASE_URL =
  process.env.BHARATCODE_SUPABASE_URL || "https://evgvlcaxfpwupaiwzqqm.supabase.co"
export const BHARATCODE_NATIVE_CLIENT_ID =
  process.env.BHARATCODE_NATIVE_CLIENT_ID || "4cad332a-232f-4ef2-9363-12fea4420635"
export const BHARATCODE_DEFAULT_REDIRECT_URI =
  process.env.BHARATCODE_REDIRECT_URI || "http://127.0.0.1:27182/callback"
export const BHARATCODE_OAUTH_SCOPE =
  process.env.BHARATCODE_OAUTH_SCOPE || "openid email profile"

const TOKEN_REFRESH_SKEW_SECONDS = 300

function homeDir(options = {}) {
  return options.home || process.env.BHARATCODE_HOME || os.homedir()
}

export function credentialsPath(options = {}) {
  if (options.credentialsPath) return options.credentialsPath
  if (process.env.BHARATCODE_CREDENTIALS_PATH) return process.env.BHARATCODE_CREDENTIALS_PATH
  return path.join(homeDir(options), ".bharatcode", "credentials.json")
}

export function configDir(options = {}) {
  return path.dirname(credentialsPath(options))
}

export function base64Url(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "")
}

export function randomVerifier() {
  return base64Url(crypto.randomBytes(32))
}

export function codeChallenge(verifier) {
  return base64Url(crypto.createHash("sha256").update(verifier).digest())
}

export function randomState() {
  return base64Url(crypto.randomBytes(24))
}

export function normalizeLoopbackRedirectUri(redirectUri = BHARATCODE_DEFAULT_REDIRECT_URI) {
  const url = new URL(redirectUri)
  const isLoopback = url.hostname === "127.0.0.1" || url.hostname === "localhost"
  if (isLoopback && url.protocol === "https:") url.protocol = "http:"
  return url.toString()
}

export function buildAuthorizationUrl({
  state,
  codeChallenge,
  redirectUri = BHARATCODE_DEFAULT_REDIRECT_URI,
  clientId = BHARATCODE_NATIVE_CLIENT_ID,
  scope = BHARATCODE_OAUTH_SCOPE,
} = {}) {
  const normalizedRedirectUri = normalizeLoopbackRedirectUri(redirectUri)
  const url = new URL("/auth/v1/oauth/authorize", BHARATCODE_SUPABASE_URL)
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("redirect_uri", normalizedRedirectUri)
  url.searchParams.set("scope", scope)
  url.searchParams.set("code_challenge", codeChallenge)
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("state", state)
  return url
}

export async function readCredentials(options = {}) {
  try {
    const raw = await readFile(credentialsPath(options), "utf8")
    return JSON.parse(raw)
  } catch (error) {
    if (error?.code === "ENOENT") return null
    throw error
  }
}

export async function saveCredentials(credentials, options = {}) {
  const dir = configDir(options)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await writeFile(credentialsPath(options), `${JSON.stringify(credentials, null, 2)}\n`, {
    mode: 0o600,
  })
}

export async function clearCredentials(options = {}) {
  await rm(credentialsPath(options), { force: true })
}

export function shouldRefreshToken(credentials, { now = Math.floor(Date.now() / 1000) } = {}) {
  if (!credentials?.access_token || !credentials?.expires_at) return true
  return credentials.expires_at - now <= TOKEN_REFRESH_SKEW_SECONDS
}

function normalizeTokenResponse(tokenResponse, previousCredentials = null) {
  const now = Math.floor(Date.now() / 1000)
  return {
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token || previousCredentials?.refresh_token,
    token_type: tokenResponse.token_type || "bearer",
    expires_at: now + Number(tokenResponse.expires_in || 3600),
    id_token: tokenResponse.id_token || previousCredentials?.id_token,
    user: tokenResponse.user || previousCredentials?.user,
  }
}

async function postTokenForm(params, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(new URL("/auth/v1/oauth/token", BHARATCODE_SUPABASE_URL), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = body.error_description || body.error || `OAuth token request failed (${response.status})`
    throw new Error(message)
  }
  return body
}

export async function exchangeAuthorizationCode({
  code,
  codeVerifier,
  redirectUri = BHARATCODE_DEFAULT_REDIRECT_URI,
  clientId = BHARATCODE_NATIVE_CLIENT_ID,
  fetchImpl = fetch,
} = {}) {
  const normalizedRedirectUri = normalizeLoopbackRedirectUri(redirectUri)
  const tokenResponse = await postTokenForm(
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: normalizedRedirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    },
    { fetchImpl },
  )
  return normalizeTokenResponse(tokenResponse)
}

export async function refreshCredentials(credentials, {
  clientId = BHARATCODE_NATIVE_CLIENT_ID,
  fetchImpl = fetch,
} = {}) {
  if (!credentials?.refresh_token) {
    throw new Error("No BharatCode refresh token found. Run `bharatcode auth login`.")
  }
  const tokenResponse = await postTokenForm(
    {
      grant_type: "refresh_token",
      refresh_token: credentials.refresh_token,
      client_id: clientId,
    },
    { fetchImpl },
  )
  return normalizeTokenResponse(tokenResponse, credentials)
}

export async function fetchUserInfo(accessToken, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(new URL("/auth/v1/oauth/userinfo", BHARATCODE_SUPABASE_URL), {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(body.error_description || body.error || `Userinfo request failed (${response.status})`)
  }
  return body
}

export async function getCredentials(options = {}, { forceRefresh = false } = {}) {
  const credentials = await readCredentials(options)
  if (!forceRefresh && !shouldRefreshToken(credentials)) return credentials

  const refreshed = await refreshCredentials(credentials, options)
  await saveCredentials(refreshed, options)
  return refreshed
}

export async function getAccessToken(options = {}, authOptions = {}) {
  const credentials = await getCredentials(options, authOptions)
  if (!credentials?.access_token) {
    throw new Error("No BharatCode session found. Run `bharatcode auth login`.")
  }
  return credentials.access_token
}

export function browserOpenCommand(url, platform = process.platform) {
  const commands = {
    win32: { command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] },
    darwin: { command: "open", args: [url] },
    linux: { command: "xdg-open", args: [url] },
  }
  return commands[platform] || commands.linux
}

function openBrowser(url) {
  const { command, args } = browserOpenCommand(url)
  const child = spawn(command, args, { detached: true, stdio: "ignore" })
  child.unref()
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character])
}

function callbackHtml(status, message) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>BharatCode Auth</title>
    <style>
      body { background: #0a0a0a; color: #e8e8e8; font: 16px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; display: grid; min-height: 100vh; place-items: center; margin: 0; }
      main { border: 1px solid #1e1e1e; background: #141414; padding: 32px; max-width: 560px; }
      strong { color: ${status === "ok" ? "#00ff88" : "#ff4444"}; }
    </style>
  </head>
  <body><main><strong>${escapeHtml(status)}</strong><p>${escapeHtml(message)}</p></main></body>
</html>`
}

function callbackListenError(error, port) {
  if (error?.code === "EADDRINUSE") {
    return new Error(
      `OAuth callback port ${port} is already in use. Close the other process or set BHARATCODE_REDIRECT_URI to an available http://127.0.0.1:<port>/callback URL.`,
    )
  }
  return error
}

function createCallbackListener({ expectedState, redirectUri, timeoutMs = 180000 }) {
  const normalizedRedirectUri = normalizeLoopbackRedirectUri(redirectUri)
  const redirect = new URL(normalizedRedirectUri)
  const host = redirect.hostname === "localhost" ? "127.0.0.1" : redirect.hostname
  const port = Number(redirect.port || 80)
  const pathname = redirect.pathname

  let timer = null
  let settled = false
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url || "/", normalizedRedirectUri)
    if (requestUrl.pathname !== pathname) {
      response.writeHead(404, { "content-type": "text/plain" })
      response.end("Not found")
      return
    }

    const state = requestUrl.searchParams.get("state")
    const code = requestUrl.searchParams.get("code")
    const error = requestUrl.searchParams.get("error")
    if (error) {
      response.writeHead(400, { "content-type": "text/html" })
      response.end(callbackHtml("error", `Authorization failed: ${error}`))
      settle(new Error(`Authorization failed: ${error}`))
      return
    }
    if (!code || state !== expectedState) {
      response.writeHead(400, { "content-type": "text/html" })
      response.end(callbackHtml("error", "Authorization state did not match. Return to the terminal and try again."))
      settle(new Error("OAuth callback state mismatch."))
      return
    }

    response.writeHead(200, { "content-type": "text/html" })
    response.end(callbackHtml("ok", "BharatCode is authenticated. You can close this tab and return to the terminal."))
    settle(null, code)
  })

  let settle = () => {}
  const code = new Promise((resolve, reject) => {
    settle = (error, value) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve(value)
    }
  })

  const listening = new Promise((resolve, reject) => {
    function onListenError(error) {
      cleanup()
      reject(callbackListenError(error, port))
    }

    function onListening() {
      server.off("error", onListenError)
      server.on("error", settle)
      timer = setTimeout(() => {
        settle(new Error("Timed out waiting for OAuth callback."))
      }, timeoutMs)
      resolve()
    }

    server.once("error", onListenError)
    server.once("listening", onListening)
    server.listen(port, host)
  })

  function cleanup() {
    if (timer) clearTimeout(timer)
    if (server.listening) server.close()
  }

  return {
    listening,
    code,
    close: cleanup,
  }
}

export async function loginWithBrowser({
  redirectUri = BHARATCODE_DEFAULT_REDIRECT_URI,
  open = openBrowser,
  fetchImpl = fetch,
  home,
  timeoutMs,
} = {}) {
  const normalizedRedirectUri = normalizeLoopbackRedirectUri(redirectUri)
  const verifier = randomVerifier()
  const state = randomState()
  const authorizationUrl = buildAuthorizationUrl({
    state,
    codeChallenge: codeChallenge(verifier),
    redirectUri: normalizedRedirectUri,
  })

  const callback = createCallbackListener({ expectedState: state, redirectUri: normalizedRedirectUri, timeoutMs })
  await callback.listening
  try {
    open(authorizationUrl.toString())
  } catch (error) {
    callback.close()
    throw error
  }
  const code = await callback.code
  let credentials = await exchangeAuthorizationCode({
    code,
    codeVerifier: verifier,
    redirectUri: normalizedRedirectUri,
    fetchImpl,
  })
  try {
    credentials = {
      ...credentials,
      user: await fetchUserInfo(credentials.access_token, { fetchImpl }),
    }
  } catch {
    credentials = { ...credentials, user: null }
  }
  await saveCredentials(credentials, { home })
  return credentials
}

export async function credentialsSummary(options = {}) {
  const credentials = await readCredentials(options)
  if (!credentials) return { authenticated: false }
  let fileMode = null
  try {
    fileMode = (await stat(credentialsPath(options))).mode & 0o777
  } catch {
    fileMode = null
  }
  return {
    authenticated: Boolean(credentials.access_token || credentials.refresh_token),
    expires_at: credentials.expires_at || null,
    user: credentials.user || null,
    file: credentialsPath(options),
    file_mode: fileMode,
  }
}
