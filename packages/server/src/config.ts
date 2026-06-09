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
  claudeBin: string;                   // `claude` binary to spawn
  claudeModel: string | null;          // --model override; null = CLI default
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
  const dataDir =
    overrides.dataDir ??
    process.env.DASHTERM_DATA_DIR ??
    path.join(homedir(), '.dashterm');

  const webBundleDir =
    overrides.webBundleDir ??
    process.env.DASHTERM_WEB_BUNDLE ??
    findBundledWeb();

  const agentEnabled =
    overrides.agentEnabled ??
    ['1', 'true', 'yes'].includes((process.env.DASHTERM_AGENT_ENABLED ?? '').toLowerCase());

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
    claudeBin: overrides.claudeBin ?? process.env.DASHTERM_CLAUDE_BIN ?? 'claude',
    claudeModel: overrides.claudeModel ?? process.env.DASHTERM_CLAUDE_MODEL ?? null,
    agentPermissionMode:
      overrides.agentPermissionMode ??
      process.env.DASHTERM_AGENT_PERMISSION_MODE ??
      'bypassPermissions',
    agentRoot: overrides.agentRoot ?? path.join(dataDir, 'agent-workspaces'),
  };
}
