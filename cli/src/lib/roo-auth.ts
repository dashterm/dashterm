/**
 * Detect whether the Roo Code CLI is installed and configured.
 *
 * The gateway can vibe-code apps by spawning `roo --print --stdin-prompt-stream`
 * (see packages/server/src/agent/agents.ts). Unlike Claude Code (browser OAuth),
 * Roo authenticates to an LLM provider with an API key, resolved in priority:
 *   1. --api-key flag (the gateway does NOT pass one),
 *   2. settings file at $XDG_CONFIG_HOME/roo/settings.json (~/.config/roo/…),
 *   3. provider env var (ANTHROPIC_API_KEY, OPENROUTER_API_KEY, …).
 * The operator configures Roo itself; this module only *checks* that the binary
 * is present and a credential source exists, for onboarding + `dashterm doctor`.
 *
 * Install: curl -fsSL https://raw.githubusercontent.com/RooCodeInc/Roo-Code/main/apps/cli/install.sh | sh
 * (binary lands in ~/.local/bin/roo by default).
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

// Env vars Roo reads for a provider key (apps/cli README "Environment Variables").
const ROO_API_KEY_ENV = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'GOOGLE_API_KEY',
  'VERCEL_AI_GATEWAY_API_KEY',
];

export interface RooStatus {
  /** Resolved absolute path to the `roo` binary, or null if not found. */
  binPath: string | null;
  /** Binary resolved on PATH (or via DASHTERM_ROO_BIN / known install dirs). */
  installed: boolean;
  /** A credential source exists (settings.json or a provider env var). */
  credsPresent: boolean;
  credsSource: 'settings' | 'env' | null;
  /** Best-effort verdict: installed AND a credential source is present. */
  authorised: boolean;
}

/** Resolve the `roo` binary without executing it (honours DASHTERM_ROO_BIN). */
export function resolveRooBin(): string | null {
  const configured = process.env.DASHTERM_ROO_BIN?.trim();
  const candidate = configured || 'roo';
  // An explicit path: just check it exists.
  if (candidate.includes('/') || candidate.includes('\\')) {
    return fs.existsSync(candidate) ? candidate : null;
  }
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(finder, [candidate], { encoding: 'utf8' });
  if (r.status === 0 && r.stdout) {
    const first = r.stdout.split(/\r?\n/)[0]?.trim();
    if (first) return first;
  }
  // The installer drops `roo` in ~/.local/bin (or ROO_BIN_DIR) which often isn't
  // on a daemon's PATH — fall back to the common install locations.
  const fallbacks = [
    process.env.ROO_BIN_DIR ? path.join(process.env.ROO_BIN_DIR, 'roo') : null,
    path.join(homedir(), '.local', 'bin', 'roo'),
    '/usr/local/bin/roo',
  ].filter((p): p is string => !!p);
  for (const f of fallbacks) {
    if (fs.existsSync(f)) return f;
  }
  return null;
}

function rooSettingsPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim() || path.join(homedir(), '.config');
  return path.join(xdg, 'roo', 'settings.json');
}

function detectRooCreds(): { present: boolean; source: 'settings' | 'env' | null } {
  if (fs.existsSync(rooSettingsPath())) return { present: true, source: 'settings' };
  if (ROO_API_KEY_ENV.some((k) => (process.env[k] ?? '').trim())) {
    return { present: true, source: 'env' };
  }
  return { present: false, source: null };
}

/** Cheap check: binary present + a credential source exists. No prompts. */
export function detectRoo(): RooStatus {
  const binPath = resolveRooBin();
  const installed = binPath !== null;
  const { present, source } = detectRooCreds();
  return {
    binPath,
    installed,
    credsPresent: present,
    credsSource: source,
    authorised: installed && present,
  };
}

/** One-line summary for option hints / doctor output. */
export function summariseRoo(s: RooStatus): string {
  if (!s.installed) return 'not installed';
  if (!s.credsPresent) return 'installed · no provider key';
  return `installed · ${s.credsSource === 'env' ? 'key in env' : 'configured'}`;
}
