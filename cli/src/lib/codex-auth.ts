/**
 * Detect whether the OpenAI Codex CLI is installed and signed in.
 *
 * The gateway can vibe-code apps by spawning `codex exec` / `codex exec resume`
 * (see packages/server/src/agent/agents.ts). Codex authenticates either by
 * ChatGPT sign-in (`codex login`) or an API key; either way credentials live in
 * ~/.codex/auth.json. The operator configures Codex itself (self-configured —
 * the gateway never sees the key); this module only *checks* that the binary is
 * present and a credential source
 * exists, for onboarding + `dashterm doctor`.
 *
 * Install: `npm i -g @openai/codex` (or `brew install codex`).
 * Sign in:  `codex login`  (headless: `codex login --device-auth`).
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

// Env keys Codex accepts for an API key (in addition to the ChatGPT login flow).
const CODEX_API_KEY_ENV = ['OPENAI_API_KEY', 'CODEX_API_KEY'];

export interface CodexStatus {
  /** Resolved absolute path to the `codex` binary, or null if not found. */
  binPath: string | null;
  /** Binary resolved on PATH (or via DASHTERM_CODEX_BIN / known install dirs). */
  installed: boolean;
  /** A credential source exists (~/.codex/auth.json or an API-key env var). */
  credsPresent: boolean;
  credsSource: 'login' | 'env' | null;
  /** Best-effort verdict: installed AND a credential source is present. */
  authorised: boolean;
}

/** Resolve the `codex` binary without executing it (honours DASHTERM_CODEX_BIN). */
export function resolveCodexBin(): string | null {
  const configured = process.env.DASHTERM_CODEX_BIN?.trim();
  const candidate = configured || 'codex';
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
  // Common install locations that may not be on a daemon's PATH.
  const fallbacks = ['/usr/local/bin/codex', '/opt/homebrew/bin/codex'];
  for (const f of fallbacks) {
    if (fs.existsSync(f)) return f;
  }
  return null;
}

function codexAuthPath(): string {
  return path.join(homedir(), '.codex', 'auth.json');
}

function detectCodexCreds(): { present: boolean; source: 'login' | 'env' | null } {
  if (fs.existsSync(codexAuthPath())) return { present: true, source: 'login' };
  if (CODEX_API_KEY_ENV.some((k) => (process.env[k] ?? '').trim())) {
    return { present: true, source: 'env' };
  }
  return { present: false, source: null };
}

/** Cheap check: binary present + a credential source exists. No prompts. */
export function detectCodex(): CodexStatus {
  const binPath = resolveCodexBin();
  const installed = binPath !== null;
  const { present, source } = detectCodexCreds();
  return {
    binPath,
    installed,
    credsPresent: present,
    credsSource: source,
    authorised: installed && present,
  };
}

/** One-line summary for option hints / doctor output. */
export function summariseCodex(s: CodexStatus): string {
  if (!s.installed) return 'not installed';
  if (!s.credsPresent) return 'installed · not signed in';
  return `installed · ${s.credsSource === 'env' ? 'key in env' : 'signed in'}`;
}
