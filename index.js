import { getAccessToken } from "./lib/bharatcode-auth.js"

const PROVIDER_ID = "bharatcode"
const MODEL_ID = "bharatcode:qwen36-35b-q6-256k-vision"
const LEGACY_MODEL_ID = "bharatcode:qwen36-35b-q8-256k"
const MODEL = `${PROVIDER_ID}/${MODEL_ID}`
const DEFAULT_BASE_URL = "https://bharatcode.ai/api/model/v1"
const OAUTH_PROVIDER_API_KEY = "bharatcode-oauth"
const MODEL_CAPABILITIES = {
  reasoning: true,
  temperature: true,
  tool_call: true,
  attachment: true,
  modalities: {
    input: ["text", "image"],
    output: ["text"],
  },
}

function explicitApiKey(options) {
  return (
    options?.accessToken ||
    options?.apiKey ||
    process.env.BHARATCODE_ACCESS_TOKEN ||
    process.env.BHARATCODE_API_KEY ||
    process.env.OPENCODE_BHARATCODE_API_KEY ||
    undefined
  )
}

function credentialsOptions(options) {
  return {
    home: options.credentialsHome,
    credentialsPath: options.credentialsPath,
    fetchImpl: options.fetchImpl,
  }
}

async function credentialsAccessToken(options, authOptions) {
  return getAccessToken(credentialsOptions(options), authOptions)
}

function setBearerHeader(output, token) {
  output.headers ||= {}
  for (const name of Object.keys(output.headers)) {
    if (name.toLowerCase() === "authorization") delete output.headers[name]
  }
  output.headers.Authorization = `Bearer ${token}`
}

export const BharatCodePlugin = async (_ctx, options = {}) => {
  const explicit = explicitApiKey(options)
  async function requestToken(authOptions) {
    if (explicit) return explicit
    return credentialsAccessToken(options, authOptions)
  }

  function withBearer(init, token) {
    const headers = new Headers(init?.headers)
    headers.set("authorization", `Bearer ${token}`)
    return { ...(init ?? {}), headers }
  }

  async function authFetch(input, init) {
    const fetchImpl = options.fetchImpl ?? fetch
    const firstToken = await requestToken()
    const first = await fetchImpl(input, withBearer(init, firstToken))
    if (first.status !== 401) return first

    try {
      await first.body?.cancel?.()
    } catch {}

    const secondToken = await requestToken({ forceRefresh: true })
    return fetchImpl(input, withBearer(init, secondToken))
  }

  return {
    config: async (config) => {
      const selectedModel = options.model || MODEL
      const selectedSmallModel = options.small_model || selectedModel
      const providerOptions = {
        baseURL: options.baseURL || DEFAULT_BASE_URL,
        timeout: options.timeout ?? 1800000,
        chunkTimeout: options.chunkTimeout ?? 180000,
        apiKey: explicit || OAUTH_PROVIDER_API_KEY,
      }
      if (!explicit) providerOptions.fetch = authFetch

      config.model = selectedModel
      config.small_model = selectedSmallModel

      config.compaction = {
        ...(config.compaction || {}),
        auto: options.autoCompaction ?? false,
      }

      config.agent = config.agent || {}
      for (const name of ["build", "plan"]) {
        config.agent[name] = {
          ...(config.agent[name] || {}),
          model: selectedModel,
          temperature: options.temperature ?? 0.6,
          top_p: options.topP ?? 0.95,
          steps: options.steps ?? 16,
        }
      }

      for (const name of ["title", "compaction"]) {
        config.agent[name] = {
          ...(config.agent[name] || {}),
          model: selectedSmallModel,
          temperature: options.temperature ?? 0.6,
          top_p: options.topP ?? 0.95,
          steps: options.smallSteps ?? 3,
        }
      }

      config.provider = config.provider || {}
      config.provider[PROVIDER_ID] = {
        npm: "@ai-sdk/openai-compatible",
        name: "BharatCode",
        options: providerOptions,
        models: {
          [MODEL_ID]: {
            name: "BharatCode Qwen3.6 35B-A3B AWQ 200K Vision Thinking",
            ...MODEL_CAPABILITIES,
            limit: {
              context: options.context ?? 200000,
              output: options.output ?? 32768,
            },
          },
          [LEGACY_MODEL_ID]: {
            name: "BharatCode legacy Q8 model id compatibility alias",
            ...MODEL_CAPABILITIES,
            limit: {
              context: options.context ?? 200000,
              output: options.output ?? 32768,
            },
          },
        },
      }
    },
    "chat.headers": async (_input, output) => {
      setBearerHeader(output, await requestToken())
    },
  }
}

export default BharatCodePlugin
