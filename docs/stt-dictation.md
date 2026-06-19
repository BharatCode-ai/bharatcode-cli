# BharatCode Dictation / STT Plan

## Current GPU Budget

The live A100 40GB service runs vLLM with Qwen3.6 35B-A3B AWQ, 200K context,
3 concurrent sequences, image input, reasoning, prefix caching, and tool-call
parsing. Idle VRAM is about 37.1 GiB used with `--gpu-memory-utilization 0.95`.

vLLM now uses `--gpu-memory-utilization 0.95`. The observed
post-change KV capacity is 665,306 tokens, or 3.33x 200K sessions, which keeps
the 3 x 200K requirement intact.

## Chosen First STT Runtime

Use Faster Whisper with `deepdml/faster-whisper-large-v3-turbo-ct2` and
`int8_float16` on CUDA.

Reasons:

- OpenAI-compatible `/v1/audio/transcriptions` is simple to expose.
- The OpenCode voice plugin already supports a remote STT API.
- Whisper large-v3-turbo is a safer first deployment than Parakeet because it
  has a smaller operational surface and fewer NeMo/Riva dependencies.
- CTranslate2 needs CUDA 12 cuBLAS/cuDNN libraries; the STT venv installs the
  `nvidia-cublas-cu12` and `nvidia-cudnn-cu12` wheels and exposes them through
  `LD_LIBRARY_PATH`.

Parakeet remains a good second experiment. NVIDIA documents Parakeet TDT 0.6B
V2 as an English ASR model with punctuation, capitalization, word timestamps,
and A100 support, but it requires the NeMo stack and a custom compatibility
wrapper.

## Public API Shape

The legacy upstream still uses Nginx authorization maps, but the public beta
user path should not expose those keys. Browser, CLI, Desktop, and VS Code
clients should call the BharatCode backend with Supabase OAuth credentials; the
backend then forwards to the upstream with a server-side credential.

- `/api/model/v1/chat/completions` -> OAuth-validating model proxy -> vLLM on `127.0.0.1:18080`
- `/api/model/v1/models` -> OAuth-validating model proxy -> vLLM for now
- `/api/model/v1/audio/transcriptions` -> OAuth-validating model proxy -> STT service on `127.0.0.1:19080`

The same `Authorization: Bearer <Supabase access token>` should work for chat
and STT once STT is routed through the web proxy.

## Live Verification

- Local STT route transcribed a 7.435s WAV sample in 4.898s.
- Public authenticated STT route returned the same transcript through nginx.
- Unauthenticated public STT request returned `401`.
- Public chat completion still returned `42` for `7*6`.
- With vLLM and STT resident, observed VRAM was about 36,655 MiB used and
  3,787 MiB free.

## OpenCode Client Path

Use `@renjfk/opencode-voice` only after it can read the BharatCode OAuth access
token or be wrapped by the BharatCode CLI. Do not ask users to configure an STT
API key. Its documented remote-STT options are:

- `sttEndpoint`
- `sttModel`
- `sttApiKeyEnv`

Target configuration:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    [
      "@renjfk/opencode-voice",
      {
        "endpoint": "https://bharatcode.ai/api/model/v1",
        "model": "bharatcode:qwen36-35b-q6-256k-vision",
        "apiKeyEnv": "BHARATCODE_ACCESS_TOKEN",
        "sttEndpoint": "https://bharatcode.ai/api/model/v1",
        "sttModel": "whisper-large-v3-turbo",
        "sttApiKeyEnv": "BHARATCODE_ACCESS_TOKEN",
        "maxTokens": 512,
        "chatTemplateKwargs": {
          "enable_thinking": false
        }
      }
    ]
  ]
}
```

Open item: verify whether OpenCode Desktop loads `tui.json` plugins and
keybinds exactly like the TUI. If not, build a small Windows hotkey recorder
that calls this same STT endpoint and pastes text into the focused input.
