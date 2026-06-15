# dashterm-cli

CLI for the DashTerm homehub — boot the local gateway, manage user
accounts, configure AI providers, and install the autostart unit.

The CLI is what `curl install.sh | bash` symlinks onto your `PATH` as
`dashterm`.

## Quick start

```bash
# fresh install via the website
curl -fsSL https://dashterm.ai/install.sh | bash

# or from a clone
git clone https://github.com/dashterm/dashterm.git
cd dashterm && npm install
node cli/dist/index.js help
```

Then run the interactive setup (account + AI agents + autostart):

```bash
dashterm setup
```

Requires Node 20.19+ (the wizard uses the ESM-only `@clack/prompts`).

## Command surface

### Gateway (native install — no docker)

| Command | What it does |
| --- | --- |
| `dashterm setup` | Interactive wizard (clack, spacebar-toggle checkboxes): admin account → AI coding agents (**Claude Code**; **Codex** / **Grok Build** greyed-out as *coming soon*) → "start at login" autostart toggle. Detects whether the Claude Code CLI is installed and signed in, and guides you if not. Re-runnable to flip toggles later. |
| `dashterm onboard` | Alias of `setup`. For non-interactive use (install.sh / CI), pass `--email … --password …` to seed the admin without prompts; `--install-daemon` chains the autostart install. |
| `dashterm doctor [--deep]` | Health check: is the Claude Code CLI installed + pre-authorised (login Keychain on macOS, `~/.claude/.credentials.json` elsewhere), plus daemon status and data dir. `--deep` also reads the stored OAuth token to report its expiry. |
| `dashterm start [--port N] [--bind ADDR]` | Boots the gateway in the foreground. Ctrl-C to stop. `--dev` runs via tsx for contributors. |
| `dashterm add-user EMAIL [pw] [--admin] [--force-reset]` | Create an account. |
| `dashterm list-users` | Print users in `~/.dashterm/state.db`. |
| `dashterm delete-user EMAIL` | Drop an account. |
| `dashterm set-admin EMAIL true\|false` | Toggle the admin flag. |
| `dashterm daemon install` | Drop a launchd plist (macOS) / systemd-user unit (Linux) that starts the gateway at login. |
| `dashterm daemon uninstall \| status \| logs \| restart` | Manage the unit. |

### AI providers

| Command | What it does |
| --- | --- |
| `dashterm provider add NAME --kind <anthropic\|openai\|gemini\|ollama> --model M [--api-key K] [--base-url URL] [--default]` | Register a provider. |
| `dashterm provider list` | Print configured providers. |
| `dashterm provider remove NAME` | Drop a provider (cascades to bindings). |
| `dashterm provider set-default NAME` | Mark the fallback provider for apps without a binding. |
| `dashterm provider bind APP_ID PROVIDER_NAME` | Route an app to a specific provider. |
| `dashterm provider unbind APP_ID` | Drop the binding. |
| `dashterm provider binding [APP_ID]` | Print which provider answers for an app. |

### Homehub (optional Docker Supabase bundle)

`dashterm homehub <init|up|down|logs|status|migrate|add-user>` — manages
the alternate install path under `services/homehub/` for users who want
a hosted-style scaling story.

## Data layout

Everything lives at `~/.dashterm/` (override with `DASHTERM_DATA_DIR`):

```
~/.dashterm/
├── state.db          sqlite (users, app_state, apps, providers, …)
├── state.db-wal      WAL journal
├── jwt-secret        HS256 signing secret (mode 600)
└── gateway.log       launchd / systemd stdout (when running via daemon)
```

## Building locally

```bash
cd cli
npm install
npm run build       # → cli/dist/index.js
```

The build step pre-builds `packages/server` too via the repo-root
postinstall — several CLI commands lazy-require the server's `db.js` +
`auth.js` + `ai/registry.js` so they can talk to sqlite directly without
the gateway being up.
