/**
 * Runtime configuration for the gateway.
 *
 * Sources (highest precedence first):
 *   1. CLI flags (--port, --bind, --data-dir)
 *   2. Environment variables (DASHTERM_PORT, DASHTERM_BIND, DASHTERM_DATA_DIR)
 *   3. Defaults below
 *
 * The CLI parses flags and overrides env before importing this module.
 */

import fs from 'fs';
import { homedir } from 'os';
import path from 'path';

export interface GatewayConfig {
  port: number;
  bind: string;
  dataDir: string;
  webBundleDir: string | null;  // null in dev (web served by Expo)
  jwtSecretPath: string;
  // Permissive CORS for the dev cross-origin case (Expo on :8081 talking to
  // the gateway on :8765). Production serves the bundle from the same origin
  // so CORS doesn't matter.
  devCorsOrigin: string | null;
  // AgenticCoder/Scheduler agent: the gateway spawns `claude` to vibe-code
  // apps. This runs with --permission-mode bypassPermissions, i.e. arbitrary
  // file writes + Bash on the host as the gateway user, for any signed-in
  // user. OFF by default; `npm run dev` turns it on for localhost. Don't
  // enable on a 0.0.0.0-bound gateway without rotating the default admin.
  agentEnabled: boolean;
  // Opt-in (DASHTERM_AGENT_ALLOW_ROOT): allow agent sessions when the gateway
  // runs as root. Claude Code blocks bypassed-permissions as root, so without
  // this the agent refuses; with it we set IS_SANDBOX so Claude will run.
  agentAllowRoot: boolean;
  claudeBin: string;                   // `claude` binary to spawn
  claudeModel: string | null;          // --model override; null = CLI default
  // Codex (OpenAI's CLI agent). The user picks the agent per AgenticCoder
  // workspace; Codex is only offered to clients when codexEnabled is on
  // (DASHTERM_CODEX_ENABLED), and self-configures its own provider (ChatGPT
  // login or API key in ~/.codex) — the gateway passes none.
  codexEnabled: boolean;
  codexBin: string;                    // `codex` binary to spawn
  agentPermissionMode: string;         // --permission-mode value
  agentRoot: string;                   // root dir for per-user workspaces
}

// Look for a built web bundle in the conventional spot next to this package.
// install.sh runs `expo export --platform web --output-dir web-dist` from
// the repo root, so an in-place install sees:
//   <install-root>/web-dist/index.html
//   <install-root>/packages/server/dist/config.js   ← this file
// __dirname resolves to packages/server/dist (compiled) or
// packages/server/src (tsx) — both are exactly three levels below the repo
// root, so the bundle is at ../../../web-dist from here in either layout.
function findBundledWeb(): string | null {
  const dir = path.resolve(__dirname, '../../..', 'web-dist');
  if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
  return null;
}

export function loadConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  // Resolve to an absolute path: derived paths (SSH IdentityFile, the agent's
  // ssh wrapper -F config, workspace dirs) get baked into files and configs
  // that are later read from a different cwd (claude runs in the workspace
  // dir), so a relative DASHTERM_DATA_DIR like "../../.dashterm-dev-data" must
  // be pinned now, at boot, while cwd is still the gateway's.
  const dataDir = path.resolve(
    overrides.dataDir ??
      process.env.DASHTERM_DATA_DIR ??
      path.join(homedir(), '.dashterm'),
  );

  const webBundleDir =
    overrides.webBundleDir ??
    process.env.DASHTERM_WEB_BUNDLE ??
    findBundledWeb();

  const agentEnabled =
    overrides.agentEnabled ??
    ['1', 'true', 'yes'].includes((process.env.DASHTERM_AGENT_ENABLED ?? '').toLowerCase());

  const agentAllowRoot =
    overrides.agentAllowRoot ??
    ['1', 'true', 'yes'].includes((process.env.DASHTERM_AGENT_ALLOW_ROOT ?? '').toLowerCase());

  const codexEnabled =
    overrides.codexEnabled ??
    ['1', 'true', 'yes'].includes((process.env.DASHTERM_CODEX_ENABLED ?? '').toLowerCase());

  return {
    port: overrides.port ?? parseInt(process.env.DASHTERM_PORT ?? '8765', 10),
    bind: overrides.bind ?? process.env.DASHTERM_BIND ?? '127.0.0.1',
    dataDir,
    webBundleDir,
    jwtSecretPath: overrides.jwtSecretPath ?? path.join(dataDir, 'jwt-secret'),
    devCorsOrigin:
      overrides.devCorsOrigin ??
      process.env.DASHTERM_DEV_CORS_ORIGIN ??
      null,
    agentEnabled,
    agentAllowRoot,
    claudeBin: overrides.claudeBin ?? process.env.DASHTERM_CLAUDE_BIN ?? 'claude',
    claudeModel: overrides.claudeModel ?? process.env.DASHTERM_CLAUDE_MODEL ?? null,
    codexEnabled,
    codexBin: overrides.codexBin ?? process.env.DASHTERM_CODEX_BIN ?? 'codex',
    agentPermissionMode:
      overrides.agentPermissionMode ??
      process.env.DASHTERM_AGENT_PERMISSION_MODE ??
      'bypassPermissions',
    agentRoot: overrides.agentRoot ?? path.join(dataDir, 'agent-workspaces'),
  };
}
