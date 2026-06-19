# BharatCode OpenCode Rebrand Path

This repo now provides the beta-safe path: a `bharatcode` CLI wrapper plus an OpenCode plugin that authenticates with Supabase OAuth and routes model traffic through `https://bharatcode.ai/api/model/v1`.

The upstream OpenCode Desktop and VS Code extension sources are not checked into this repo, so a full binary rebrand is tracked as a patch path rather than committed source.

## Beta Branding Already Implemented

- npm package: `bharatcode`
- CLI binary: `bharatcode`
- OpenCode provider id: `bharatcode`
- OpenCode provider display name: `BharatCode`
- Model proxy endpoint: `https://bharatcode.ai/api/model/v1`
- User setup: `bharatcode auth login`, not `/connect -> Other -> paste API key`
- Shared config command: `bharatcode opencode configure`

## Desktop Fork Patch Checklist

Apply this to the upstream OpenCode desktop repository once it is vendored or forked:

1. Rename app display name from OpenCode to BharatCode.
2. Replace icons and installer artwork with BharatCode assets.
3. Change onboarding to run or deep-link to `bharatcode auth login`.
4. Remove provider/API-key selection from the BharatCode onboarding path.
5. Preload the `bharatcode` plugin and model id.
6. Add `bharatcode://auth/callback` as the native OAuth callback.
7. Keep attribution in About/License screens: BharatCode is based on OpenCode.

## VS Code Extension Patch Checklist

Apply this to the upstream OpenCode VS Code extension source:

1. Rename extension display name to BharatCode.
2. Change command palette labels and sidebar title to BharatCode.
3. Register `vscode://bharatcode.bharatcode/auth/callback` and `vscode-insiders://bharatcode.bharatcode/auth/callback`.
4. Replace setup prompts with `bharatcode auth login` and `bharatcode opencode configure`.
5. Hide generic provider/API-key setup from the BharatCode first-run path.
6. Keep OpenCode attribution in package license metadata.

## Verification

- Fresh machine has no `BHARATCODE_API_KEY` or OpenCode provider key.
- User installs BharatCode CLI, logs in through OAuth, and launches the coding interface.
- Model calls contain `Authorization: Bearer <Supabase access token>` to `bharatcode.ai`.
- Backend proxy validates the token and forwards upstream with a server-side secret.
