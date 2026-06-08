# DashTerm

A self-hostable productivity dashboard. Sign in, place apps on a grid of
"spaces," and use AIAssistant + vibe-coded custom apps. The AI assistant
talks to whichever provider you configure (Claude, GPT, Gemini, or a
local model via Ollama) through the gateway — keys never reach the
browser. There is **no hosted tier**. You run it.

## Install

```bash
curl -fsSL https://website-mf.web.app/install.sh | bash
```

That script:

1. Checks macOS or Linux + Node 20+ (installs Node via Homebrew or
   NodeSource if missing).
2. Clones the repo to `~/.dashterm/src/`.
3. `npm install` — postinstall builds `packages/server` + `cli/`.
4. Puts `dashterm` on your PATH via `npm link` (sudo-free fallback to
   `~/.local/bin/`).
5. Builds the web bundle (`expo export --platform web`) so the gateway
   can serve it.
6. `dashterm onboard` — interactive prompt to create the admin
   account.

After that:

```bash
dashterm start          # foreground gateway
# or:
dashterm daemon install # autostart on every login (launchd / systemd)
```

Then open **http://localhost:8765**.

To get the autostart + onboarding in one command:

```bash
curl -fsSL https://website-mf.web.app/install.sh \
  | DASHTERM_INSTALL_DAEMON=1 bash
```

### Or, from a checkout

```bash
git clone https://github.com/dashterm/dashterm.git
cd dashterm
npm install
dashterm onboard
dashterm start
```

A single `npm install` at the root is enough — the postinstall hook
builds `packages/server` + the CLI automatically.

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
- `cli/` — `dashterm start / onboard / daemon / provider / users /
  homehub / doctor`.
- `services/homehub/` — *optional* Docker / Supabase install bundle for
  users who want hosted-style scaling instead of the native sqlite path.

## The paid mobile app

The native iOS / Android shell is a separate closed-source app, sold
to fund development. It's a thin client that points at *your* homehub
URL — same provider seam, no telemetry, no data on a third party. The
funding model lives there so the OSS half can stay self-host-first.

The OSS web bundle works fine on a phone browser if you don't need
push or native polish.

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
# accounts
dashterm add-user alice@family.lan
dashterm list-users
dashterm set-admin alice@family.lan true

# AI providers
dashterm provider add my-claude --kind anthropic --model claude-haiku-4-5 \
  --api-key sk-ant-… --default
dashterm provider bind ai my-claude
dashterm provider list

# autostart
dashterm daemon install
dashterm daemon status
dashterm daemon logs -f
```

## Optional Docker / Supabase install

If you'd rather run the dashboard backed by Postgres + Supabase Auth +
Realtime + Storage in containers, that path is still here:

```bash
dashterm homehub init
dashterm homehub up
# then open http://localhost:8082
```

See [`services/homehub/README.md`](./services/homehub/README.md) for
the full install + upgrade + backup + troubleshooting guide.

## License

[Apache 2.0](./LICENSE). Contributions require signing the
[CLA](./CLA.md) — one-click via the bot on your first PR. The why
is explained in [CONTRIBUTING.md](./CONTRIBUTING.md#why-a-cla).
