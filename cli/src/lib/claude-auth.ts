/**
 * Detect whether the Claude Code CLI is installed and pre-authorised.
 *
 * The gateway vibe-codes apps by spawning `claude` (see
 * packages/server/src/agent/session.ts) and assumes it's both installed and
 * logged in. This module gives the CLI a way to *check* that up front — during
 * onboarding and via `dashterm doctor` — instead of failing at first use with
 * a bare `spawn ENOENT`.
 *
 * Where Claude Code keeps its OAuth session:
 *   - macOS  → login Keychain, generic-password service "Claude Code-credentials"
 *   - else   → ~/.claude/.credentials.json
 * Both hold { "claudeAiOauth": { accessToken, refreshToken, expiresAt, scopes } }.
 *
 * Two depths:
 *   detectClaude()      — cheap. Binary on PATH + credentials *present*. On
 *                         macOS the keychain existence probe reads metadata
 *                         only, so it never pops an unlock dialog.
 *   readClaudeExpiry()  — deep. Reads the secret to parse `expiresAt`. On macOS
 *                         this can trigger a one-time "allow access" prompt, so
 *                         it's opt-in (used by `dashterm doctor --deep`).
 *
 * We can detect + guide, but we can't perform Claude's browser OAuth login for
 * the user — that stays `claude` → `/login`.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const KEYCHAIN_SERVICE = 'Claude Code-credentials';

export interface ClaudeStatus {
  /** Resolved absolute path to the `claude` binary, or null if not found. */
  binPath: string | null;
  /** Binary resolved on PATH (or via DASHTERM_CLAUDE_BIN). */
  installed: boolean;
  /** A credential store exists (keychain entry on macOS, file elsewhere). */
  credsPresent: boolean;
  credsSource: 'keychain' | 'file' | null;
  /** Best-effort overall verdict: installed AND logged in (not deep-verified). */
  authorised: boolean;
}

export interface ClaudeExpiry {
  expiresAt: number | null; // epoch ms from the OAuth bundle
  expired: boolean | null; // null when we couldn't read/parse it
  error?: string;
}

/** Resolve the `claude` binary without executing it (honours DASHTERM_CLAUDE_BIN). */
export function resolveClaudeBin(): string | null {
  const configured = process.env.DASHTERM_CLAUDE_BIN?.trim();
  const candidate = configured || 'claude';
  // An explicit path: just check it exists.
  if (candidate.includes('/') || candidate.includes('\\')) {
    return fs.existsSync(candidate) ? candidate : null;
  }
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(finder, [candidate], { encoding: 'utf8' });
  if (r.status === 0 && r.stdout) {
    const first = r.stdout.split(/\r?\n/)[0]?.trim();
    return first || null;
  }
  return null;
}

function credentialsFilePath(): string {
  return path.join(homedir(), '.claude', '.credentials.json');
}

function detectCreds(): { present: boolean; source: 'keychain' | 'file' | null } {
  if (process.platform === 'darwin') {
    // Metadata-only query (no -w) → never prompts to unlock the keychain.
    const r = spawnSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE], {
      stdio: 'ignore',
    });
    if (r.status === 0) return { present: true, source: 'keychain' };
    // Fall through: some macOS setups still keep the flat file.
  }
  if (fs.existsSync(credentialsFilePath())) return { present: true, source: 'file' };
  return { present: false, source: null };
}

/** Cheap check: binary present + a credential store exists. No prompts. */
export function detectClaude(): ClaudeStatus {
  const binPath = resolveClaudeBin();
  const installed = binPath !== null;
  const { present, source } = detectCreds();
  return {
    binPath,
    installed,
    credsPresent: present,
    credsSource: source,
    authorised: installed && present,
  };
}

/** Deep check: read the OAuth secret and parse its expiry. May prompt on macOS. */
export function readClaudeExpiry(): ClaudeExpiry {
  let raw: string | null = null;
  try {
    if (process.platform === 'darwin') {
      const r = spawnSync(
        'security',
        ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'],
        // Guard against a blocking keychain "allow access" dialog.
        { encoding: 'utf8', timeout: 15000 },
      );
      if (r.status === 0 && r.stdout) raw = r.stdout.trim();
    }
    if (!raw && fs.existsSync(credentialsFilePath())) {
      raw = fs.readFileSync(credentialsFilePath(), 'utf8');
    }
    if (!raw) return { expiresAt: null, expired: null, error: 'no readable credentials' };
    const json = JSON.parse(raw) as { claudeAiOauth?: { expiresAt?: unknown } };
    const exp = json.claudeAiOauth?.expiresAt;
    if (typeof exp !== 'number') return { expiresAt: null, expired: null };
    return { expiresAt: exp, expired: exp < Date.now() };
  } catch (e) {
    return {
      expiresAt: null,
      expired: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** One-line summary for option hints / doctor output. */
export function summariseClaude(s: ClaudeStatus): string {
  if (!s.installed) return 'not installed';
  if (!s.credsPresent) return 'installed · not logged in';
  return 'installed · authorised';
}
