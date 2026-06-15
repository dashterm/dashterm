# DashTerm

A self-hostable productivity dashboard. Sign in, place apps on a grid of
"spaces," and use AIAssistant + vibe-coded custom apps. The AI assistant
talks to whichever provider you configure (Claude, GPT, Gemini, or a
local model via Ollama) through the gateway — keys never reach the
browser. There is **no hosted tier**. You run it.

## Install

```bash
curl -fsSL https://dashterm.ai/install.sh | bash
```

That script:

1. Checks macOS or Linux + Node 20.19+ (installs Node via Homebrew or
   NodeSource if missing).
2. Clones the repo to `~/.dashterm/src/`.
3. `npm install` — postinstall builds `packages/server` + `cli/`.
4. Puts `dashterm` on your PATH via `npm link` (sudo-free fallback to
   `~/.local/bin/`).
5. Builds the web bundle (`expo export --platform web`) so the gateway
   can serve it.

### Or, from a checkout

```bash
git clone https://github.com/dashterm/dashterm.git
cd dashterm
npm install
dashterm start          # seeds admin@localhost / changeme on first boot
```

A single `npm install` at the root is enough — the postinstall hook
builds `packages/server` + the CLI automatically.

## Setup

After install, run the interactive setup wizard:

```bash
dashterm setup
```

It walks you through three steps, with spacebar-toggle checkboxes (↑/↓ to
move, space to toggle, enter to confirm):

1. **Admin account** — email + password. Skipped if the install already has
   users.
2. **AI coding agents** — pick which agents power the AgenticCoder / vibe-coded
   apps. **Claude Code** is available today; **Codex** and **Grok Build** are
   shown greyed-out as *coming soon*. The wizard checks whether Claude is
   installed and signed in (see [Pre-authorising Claude](#pre-authorising-claude)
   below) and guides you if it isn't.
3. **Start at login** — toggles the autostart background service on or off
   (launchd on macOS, systemd-user on Linux). Re-running `setup` reflects the
   current state, so you can flip it back off later.

Then open **http://localhost:8765** and sign in.

> Prefer to skip the wizard? Just run `dashterm start`. The gateway seeds an
> admin on its first boot — **`admin@localhost` / `changeme`** — and forces you
> to set a real password immediately.
>
> ⚠ Rotate the seeded password on first login, **before** exposing the gateway
> to a network.

### Pre-authorising Claude

The AgenticCoder / vibe-coding feature drives the **Claude Code CLI** on the
host machine. DashTerm doesn't keep a separate Anthropic key for it — it reuses
your existing Claude Code login. So before vibe-coding, make sure `claude` is
installed and signed in:

```bash
npm install -g @anthropic-ai/claude-code   # if you don't have it yet
claude                                      # then type /login, finish in the browser
```

`dashterm setup` detects this for you — Claude's session lives in your login
Keychain on macOS (or `~/.claude/.credentials.json` elsewhere), and the wizard
reads it without prompting. Check the state any time with:

```bash
dashterm doctor          # ✓ Claude installed / authorised, plus daemon health
dashterm doctor --deep   # also verifies the stored OAuth token hasn't expired
```

> The AI **assistant** (chat) is separate from the **agent** (vibe-coding) and
> needs no Claude login — it uses whichever provider you register with
> `dashterm provider add` (Claude API key, GPT, Gemini, or local Ollama). See
> [Common commands](#common-commands).

### Unattended install

To create the admin and install autostart in one non-interactive command (for
CI or scripted boxes), pass credentials as environment variables:

```bash
curl -fsSL https://dashterm.ai/install.sh \
  | DASHTERM_EMAIL=you@example.com DASHTERM_PASSWORD='…' DASHTERM_INSTALL_DAEMON=1 bash
```

Omit `DASHTERM_EMAIL`/`DASHTERM_PASSWORD` to fall back to the seeded admin, or
omit `DASHTERM_INSTALL_DAEMON` to skip autostart.

## Who it's for

If you'd rather run your own infrastructure than depend on someone
else's hosted product, and you're comfortable on the command line,
this is for you. Works on a Linux box at home, a Raspberry Pi, a VPS,
or a workstation you mostly use yourself.

Not for you if:

- You want one-click hosted convenience (we don't offer it).
- You need a polished iOS/Android app — the native shell is a separate
  paid product (more below).
- You're looking for a full alternative to Notion / Roam / Obsidian
  out of the box. DashTerm ships the *engine*; the apps you use are
  ones you or the community write.

## What's in the box

- `packages/server/` — Fastify gateway. Sqlite at `~/.dashterm/state.db`,
  argon2id passwords, JWT in httpOnly cookies, WebSocket cross-tab
  state push, multi-provider AI proxy, esbuild TSX compile for custom
  apps. One Node process, one port (default `8765`).
- `packages/web/` — React Native + Expo dashboard, served by the gateway.
- `packages/core/` — registry, AIAssistant, plugin system, vibe-coded
  app runtime, and the storage/auth provider seam.
- `cli/` — `dashterm setup / start / onboard / daemon / provider /
  users / doctor`.

## The mobile apps

Coming soon.

## Architecture in one paragraph

The browser hits a Fastify gateway that serves both the static web
bundle and the API from the same origin. Auth is cookie-mode HS256
JWTs over argon2id password hashes. State lives in sqlite as a JSON
blob per user (`app_state`); vibe-coded apps live in the `apps` table
keyed by five-character share codes. Cross-tab live sync rides a
WebSocket at `/api/ws`. AI calls go through `POST /api/ai/chat` —
OpenAI-shape wire — which dispatches to whichever provider is bound to
the app's id (or the default). Adapters speak Anthropic, OpenAI,
Gemini, and Ollama, so the dashboard never sees an API key. Custom
apps render via esbuild (TSX → IIFE JS) and `new Function()` eval on
web, or `react-native-webview` on mobile.

## Common commands

```bash
# setup + health
dashterm setup                  # interactive wizard: account + AI agents + autostart
dashterm doctor                 # check Claude install/auth + daemon status

# accounts
dashterm add-user alice@family.lan
dashterm list-users
dashterm set-admin alice@family.lan true

# AI providers (for the chat assistant — not the vibe-coding agent)
dashterm provider add my-claude --kind anthropic --model claude-haiku-4-5 \
  --api-key sk-ant-… --default
dashterm provider bind ai my-claude
dashterm provider list

# autostart (or just use `dashterm setup`)
dashterm daemon install
dashterm daemon status
dashterm daemon logs -f
```

## License

[Functional Source License v1.1](./LICENSE) (`FSL-1.1-ALv2`) — source-available
and free for any use **except** building a competing commercial product. Each
release **automatically converts to Apache 2.0 two years** after it ships, so it
becomes fully permissive over time.

Contributions require signing the [CLA](./CLA.md) — one-click via the bot on your
first PR. The why is explained in [CONTRIBUTING.md](./CONTRIBUTING.md#why-a-cla).
