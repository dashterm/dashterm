/**
 * Persisted daemon settings (~/.dashterm/daemon.json).
 *
 * `dashterm setup` and `dashterm daemon install` bake the operator's choices —
 * bind/port and the agent flags (DASHTERM_AGENT_ENABLED / _ALLOW_ROOT /
 * _CODEX_ENABLED) — into the autostart unit. Those choices used to live ONLY in
 * the generated unit, rebuilt from `process.env` on every (re)install. So a bare
 * `dashterm daemon install`/`restart` (or any regeneration) silently dropped any
 * flag that wasn't exported in that moment's shell — e.g. the agent would go
 * back to "disabled by operator" after an unrelated reinstall.
 *
 * Recording the effective settings here on install, and reading them back as the
 * base on the next (re)install, makes `dashterm setup` stick: the autostart
 * config survives reinstalls, restarts, and updates without a hand-written
 * systemd drop-in.
 */
import fs from 'node:fs';
import path from 'node:path';
import { daemonConfigPath } from './paths';
import type { DaemonInstallEnv } from './macos';

/** Last-installed daemon settings, or {} if none persisted / unreadable. */
export function readDaemonConfig(): Partial<DaemonInstallEnv> {
  try {
    const parsed = JSON.parse(fs.readFileSync(daemonConfigPath(), 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Partial<DaemonInstallEnv>) : {};
  } catch {
    return {};
  }
}

/** Record the settings an install used. Best-effort: never fail the install over it. */
export function writeDaemonConfig(env: DaemonInstallEnv): void {
  try {
    fs.mkdirSync(path.dirname(daemonConfigPath()), { recursive: true, mode: 0o700 });
    fs.writeFileSync(daemonConfigPath(), `${JSON.stringify(env, null, 2)}\n`, { mode: 0o600 });
  } catch {
    /* best-effort persistence */
  }
}
