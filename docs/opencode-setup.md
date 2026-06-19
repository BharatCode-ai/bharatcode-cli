# BharatCode OAuth Setup

BharatCode does not use OpenCode's API-key/provider-selection setup for beta users. Launch BharatCode from your project and the CLI handles browser OAuth plus OpenCode plugin configuration.

## Install

```bash
npm install -g bharatcode@latest
bharatcode --version
```

## Start Coding

```bash
bharatcode .
```

On first launch, this opens `bharatcode.ai` in your browser. Sign in with Google, GitHub, or email/password through Supabase Auth, approve the BharatCode native app request, and return to the terminal.

The CLI stores OAuth credentials at:

```text
~/.bharatcode/credentials.json
```

The file contains OAuth tokens, not a BharatCode API key. It should be readable only by your OS user.

The first launch also creates or updates:

```text
~/.config/opencode/opencode.jsonc
```

It installs the `bharatcode` npm plugin into OpenCode's global plugin store and adds the BharatCode plugin to config:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["bharatcode"]
}
```

If you already have plugins, the command preserves them and appends `bharatcode`.

The BharatCode wrapper refreshes your OAuth token, ensures OpenCode has the BharatCode plugin configured, and launches the OpenCode engine. The plugin sends model traffic to:

```text
https://bharatcode.ai/api/model/v1
```

That backend validates your Supabase OAuth session and forwards requests to the BharatCode model upstream with a server-side credential. You never paste a user API key.

## Desktop And VS Code

For OpenCode Desktop or the OpenCode VS Code extension:

1. Install the BharatCode CLI with `npm install -g bharatcode`.
2. Run `bharatcode .` once from any project, or run `bharatcode auth login` and `bharatcode opencode configure` manually.
3. Fully quit and reopen OpenCode Desktop or reload VS Code.

The shared OpenCode config loads the BharatCode plugin for both surfaces. A fully BharatCode-branded Desktop or VS Code build requires applying the rebrand checklist in `docs/opencode-rebrand-path.md` to the upstream OpenCode app or extension source.

## Health Check

```bash
bharatcode doctor
```

Expected output:

```text
auth: ok (...)
opencode config: ok (...)
opencode engine: ...
```

## Troubleshooting

- If auth is missing in a non-interactive shell, run `bharatcode auth login`.
- If the browser shows `unsupported scope: offline_access`, upgrade with `npm install -g bharatcode@latest`; fixed builds print `0.2.1` or newer from `bharatcode --version`.
- If the browser shows `redirect_uri is required`, upgrade with `npm install -g bharatcode@latest`; old Windows launches could truncate OAuth URLs at `&`.
- If Desktop or VS Code still asks for a provider key, run `bharatcode .` once or `bharatcode opencode configure`, then fully restart it.
- Email/password signup requires confirming the email address before sign-in. Google or GitHub sign-in uses the same BharatCode account path without an inbox step.
- Do not run `/connect -> Other -> bharatcode -> paste key` for the BharatCode beta path.
