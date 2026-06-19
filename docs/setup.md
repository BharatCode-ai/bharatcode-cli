# BharatCode CLI Setup

Install the public beta CLI from npm:

```bash
npm install -g bharatcode
bharatcode --version
```

Start BharatCode inside a project:

```bash
bharatcode .
```

On first launch, the CLI opens browser sign-in for BharatCode OAuth. Sign in,
approve the BharatCode native app request, and return to your terminal.

The CLI stores OAuth credentials at:

```text
~/.bharatcode/credentials.json
```

That file contains OAuth tokens, not a BharatCode API key. It should be readable
only by your OS user.

The first launch also prepares the local BharatCode engine configuration at:

```text
~/.config/opencode/opencode.jsonc
```

If you already have local plugins, BharatCode preserves them and appends the
`bharatcode` provider entry.

## Health Check

```bash
bharatcode doctor
```

Expected output:

```text
auth: ok (...)
BharatCode engine config: ok (...)
BharatCode engine: ...
```

## Repair Commands

Use these only when the first launch needs help:

```bash
bharatcode auth login
bharatcode opencode configure
```

The second command is retained as a compatibility repair command because the
current BharatCode CLI uses the upstream engine configuration file.

## Troubleshooting

- If auth is missing in a non-interactive shell, run `bharatcode auth login`.
- If browser login fails after an old install, upgrade with
  `npm install -g bharatcode@latest`.
- If the app still asks for a provider key, run `bharatcode .` once, then fully
  restart the app.
- Do not paste API keys for the public beta path.
