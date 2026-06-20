/**
 * `dashterm doctor` — quick health check for the bits the agentic coder needs.
 *
 * Reports whether the Claude Code CLI is installed and pre-authorised, plus the
 * autostart daemon state and where data lives. Pass `--deep` to also read the
 * stored OAuth secret and report token expiry (on macOS this may pop a one-time
 * keychain "allow access" prompt — that's why it's opt-in).
 */

import { homedir } from 'node:os';
import path from 'node:path';
import { daemonStatus } from '../daemon';
import { detectClaude, readClaudeExpiry } from '../lib/claude-auth';
import { detectCodex, summariseCodex } from '../lib/codex-auth';
import { c, info, success, warn } from '../lib/log';

function line(label: string, value: string): void {
  info(`  ${label.padEnd(10)} ${value}`);
}

function fmtWhen(ms: number): string {
  const delta = ms - Date.now();
  const mins = Math.round(Math.abs(delta) / 60000);
  if (mins < 60) return delta >= 0 ? `in ${mins}m` : `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return delta >= 0 ? `in ${hrs}h` : `${hrs}h ago`;
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
}

export async function doctorCommand(args: string[]): Promise<number> {
  const deep = args.includes('--deep') || args.includes('--check-expiry');

  info(c.bold('DashTerm doctor'));
  info('');

  // --- Claude Code ---
  info(c.bold('Claude Code (agentic coder)'));
  const claude = detectClaude();
  if (claude.installed) {
    success(`  installed  ${claude.binPath}`);
  } else {
    warn('  not installed — `npm install -g @anthropic-ai/claude-code` (or set DASHTERM_CLAUDE_BIN)');
  }

  if (claude.credsPresent) {
    success(`  authorised (${claude.credsSource})`);
    if (deep) {
      const exp = readClaudeExpiry();
      if (exp.error) {
        warn(`  expiry     couldn't read token: ${exp.error}`);
      } else if (exp.expiresAt == null) {
        info('  expiry     unknown (no expiresAt field)');
      } else if (exp.expired) {
        warn(`  expiry     EXPIRED (${fmtWhen(exp.expiresAt)}) — run \`claude\` then \`/login\``);
      } else {
        success(`  expiry     valid (renews/expires ${fmtWhen(exp.expiresAt)})`);
      }
    }
  } else if (claude.installed) {
    warn('  not signed in — run `claude` then type `/login`');
  }
  // (not-installed already reported above)
  if (!deep) info(c.gray('  (run `dashterm doctor --deep` to verify token expiry)'));
  info('');

  // --- Codex ---
  info(c.bold('Codex (agentic coder)'));
  const codex = detectCodex();
  if (codex.installed) {
    success(`  installed  ${codex.binPath}`);
  } else {
    warn('  not installed — `npm i -g @openai/codex` (or `brew install codex`, or set DASHTERM_CODEX_BIN)');
  }
  if (codex.credsPresent) {
    success(`  signed in (${summariseCodex(codex)})`);
  } else if (codex.installed) {
    warn('  not signed in — run `codex login` (or set OPENAI_API_KEY)');
  }
  info(c.gray('  (Codex enabled by DASHTERM_CODEX_ENABLED=1; `dashterm setup` sets it)'));
  info('');

  // --- Daemon ---
  info(c.bold('Autostart daemon'));
  const d = daemonStatus();
  if (!d.installed) {
    info('  not installed — enable with `dashterm setup` or `dashterm daemon install`');
  } else {
    line('unit', d.unitPath ?? '?');
    if (d.active === true) success(`  active     yes (pid ${d.pid ?? '?'})`);
    else if (d.active === false) warn('  active     no');
    else info('  active     unknown');
  }
  info('');

  // --- Data ---
  const dataDir = process.env.DASHTERM_DATA_DIR || path.join(homedir(), '.dashterm');
  info(c.bold('Environment'));
  line('data dir', dataDir);
  line('port', process.env.DASHTERM_PORT ?? '8765');
  line('bind', process.env.DASHTERM_BIND ?? '127.0.0.1');

  return 0;
}
