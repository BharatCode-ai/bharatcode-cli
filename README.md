# BharatCode

BharatCode public beta website, OAuth CLI, OpenCode plugin, and operating notes.

## Project Layout

- `index.js`: OpenCode plugin entrypoint published as the `bharatcode` npm
  package.
- `bin/bharatcode.js`: BharatCode OAuth CLI wrapper.
- `lib/`: dependency-free OAuth credential and OpenCode config helpers.
- `apps/web/`: Next.js public beta website, Supabase Auth pages, OAuth consent,
  account flow, dashboard, and model proxy.
- `docs/opencode-setup.md`: OAuth-only user setup guide.
- `docs/public-beta-runbook.md`: deployment and verification runbook.
- `docs/opencode-rebrand-path.md`: OpenCode CLI/Desktop/VS Code rebrand path.
- `docs/security-hardening.md`: current server hardening checklist and ops
  notes.
- `docs/stt-dictation.md`: plan for remote dictation support through the same
  OAuth-protected BharatCode backend path.
- `stt/`: OpenAI-compatible transcription service.
- `infra/`: checked-in systemd and deployment notes.

## Live Services

- Website: `https://bharatcode.ai`
- OAuth issuer: `https://evgvlcaxfpwupaiwzqqm.supabase.co/auth/v1`
- User-facing model endpoint: `https://bharatcode.ai/api/model/v1`
- Current upstream model endpoint: `https://bharatcode.kaabil.me/v1`

## Model Capabilities

The OpenCode plugin explicitly declares image attachment support:

- input: text, image
- output: text
- tools: enabled
- reasoning: enabled

## Quick Setup

The beta path uses OAuth, not user API keys:

```bash
npm install -g bharatcode
bharatcode .
```

`bharatcode .` opens browser login when needed, stores OAuth credentials in
`~/.bharatcode/credentials.json`, installs the BharatCode OpenCode plugin, and
adds it to `~/.config/opencode/opencode.jsonc`. The plugin then calls
`https://bharatcode.ai/api/model/v1` with a short-lived Bearer token. The
explicit `bharatcode auth login` and `bharatcode opencode configure` commands
remain available as repair commands.

Full setup instructions are in
[docs/opencode-setup.md](./docs/opencode-setup.md).

## Publishing

Before publishing:

```bash
npm pack --dry-run
node -e "import('./index.js').then(m => console.log(typeof m.default, typeof m.BharatCodePlugin))"
```

Web app:

```bash
cd apps/web
npm install
npm test
npm run build
```
