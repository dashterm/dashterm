/**
 * Linux systemd-user integration for the native gateway. Drops a
 * unit at $XDG_CONFIG_HOME/systemd/user/dashterm-gateway.service,
 * runs `systemctl --user daemon-reload && enable --now`.
 *
 * Install also runs `loginctl enable-linger $USER` so the systemd user
 * manager — and therefore this --user unit — keeps running after the
 * installing login session ends and comes back up at boot. Without it a
 * `systemctl --user` service is killed the moment you log out: the classic
 * "gateway dies / I lose connectivity as soon as I close my SSH session" on
 * headless boxes. Enabling linger is best-effort (see `enableLinger`).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { DaemonInstallEnv } from './macos';
import { gatewayErrLogPath, gatewayLogPath, dashtermHome } from './paths';
import { LINUX_SERVICE_TEMPLATE, renderTemplate } from './templates';
import { success, warn } from '../lib/log';

export const LINUX_UNIT_NAME = 'dashterm-gateway.service';

export function linuxUnitPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdg, 'systemd', 'user', LINUX_UNIT_NAME);
}

export function isInstalledLinux(): boolean {
  return fs.existsSync(linuxUnitPath());
}

export function installLinux(
  nodeBin: string,
  dashtermBin: string,
  env: DaemonInstallEnv,
): string {
  const unit = linuxUnitPath();
  fs.mkdirSync(path.dirname(unit), { recursive: true });
  fs.mkdirSync(dashtermHome(), { recursive: true, mode: 0o700 });

  const extra: string[] = [];
  if (env.agentEnabled) {
    extra.push(`Environment="DASHTERM_AGENT_ENABLED=1"`);
  }
  if (env.agentAllowRoot) {
    extra.push(`Environment="DASHTERM_AGENT_ALLOW_ROOT=1"`);
  }
  if (env.codexEnabled) {
    extra.push(`Environment="DASHTERM_CODEX_ENABLED=1"`);
  }
  const extraEnv = extra.join('\n');
  const body = renderTemplate(LINUX_SERVICE_TEMPLATE, {
    NODE_BIN: nodeBin,
    DASHTERM_BIN: dashtermBin,
    HOME: os.homedir(),
    DATA_DIR: env.dataDir,
    PORT: env.port,
    BIND: env.bind,
    LOG_PATH: gatewayLogPath(),
    ERR_LOG_PATH: gatewayErrLogPath(),
    EXTRA_ENV: extraEnv,
  });
  fs.writeFileSync(unit, body, { mode: 0o644 });

  // daemon-reload picks up the (re)written unit; `enable` sets boot-start;
  // `restart` starts it now AND restarts an already-running unit — so a
  // reinstall/update actually loads the new build instead of leaving the stale
  // process running (`enable --now` no-ops on an already-active unit).
  for (const args of [
    ['daemon-reload'],
    ['enable', LINUX_UNIT_NAME],
    ['restart', LINUX_UNIT_NAME],
  ]) {
    const res = spawnSync('systemctl', ['--user', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (res.status !== 0) {
      const stderr = res.stderr ? res.stderr.toString().trim() : '';
      throw new Error(
        `systemctl --user ${args.join(' ')} failed: ${stderr || `exit ${res.status}`}\n` +
          `Unit was written to ${unit}. If you're on a headless box, you may need:\n` +
          `  sudo loginctl enable-linger $USER\n` +
          `then re-run \`dashterm daemon install\`.`,
      );
    }
  }

  // The unit is now installed + running in this session — make it survive
  // logout. Done last so a systemctl failure above short-circuits first.
  enableLinger();
  return unit;
}

/**
 * Turn on systemd user-lingering for the current user so the gateway keeps
 * running after the installing session ends and starts at boot. `loginctl
 * enable-linger` is idempotent (re-enabling an already-lingering user is a
 * no-op), so we can call it on every (re)install unconditionally.
 *
 * Best-effort: the unit is already up for this session by the time we get
 * here, so if linger can't be set — e.g. polkit denies it for a non-root SSH
 * session, or `loginctl` is missing — we warn with the one command to run by
 * hand rather than failing the whole install. (As root it just works, no
 * sudo/polkit involved, which covers most headless boxes.)
 */
function enableLinger(): void {
  const user = os.userInfo().username;
  const res = spawnSync('loginctl', ['enable-linger', user], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (res.status === 0) {
    success(`Lingering enabled for ${user} — the gateway survives logout and starts at boot.`);
    return;
  }
  const detail =
    (res.stderr && res.stderr.toString().trim()) ||
    (res.error && res.error.message) ||
    `exit ${res.status}`;
  warn(
    `Couldn't enable user lingering automatically (${detail}).\n` +
      `  The gateway is running now but will STOP when you log out. To keep it up, run:\n` +
      `    sudo loginctl enable-linger ${user}`,
  );
}

/**
 * Whether systemd user-lingering is on for the current user. `true`/`false`
 * when we can tell, `null` when we can't (e.g. `loginctl` is missing — not a
 * systemd box). A non-zero exit with no spawn error means logind doesn't know
 * the user, which only happens when linger is off and there's no live session
 * — so we report that as `false`, the actionable case `dashterm doctor` flags.
 */
export function lingerEnabledLinux(): boolean | null {
  const user = os.userInfo().username;
  const r = spawnSync('loginctl', ['show-user', user, '--property=Linger'], {
    encoding: 'utf8',
  });
  if (r.error) return null;
  if (r.status !== 0) return false;
  return /Linger=yes/.test(r.stdout || '');
}

export function uninstallLinux(): boolean {
  const unit = linuxUnitPath();
  if (!fs.existsSync(unit)) return false;
  spawnSync('systemctl', ['--user', 'disable', '--now', LINUX_UNIT_NAME], { stdio: 'ignore' });
  try {
    fs.unlinkSync(unit);
  } catch {
    /* already gone */
  }
  spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
  return true;
}

// Stop/start without removing the unit — used by `dashterm update` to take the
// gateway down for the rebuild, then bring it back up. Both are best-effort.
export function stopLinux(): boolean {
  const r = spawnSync('systemctl', ['--user', 'stop', LINUX_UNIT_NAME], { stdio: 'ignore' });
  return r.status === 0;
}

export function startLinux(): boolean {
  const r = spawnSync('systemctl', ['--user', 'start', LINUX_UNIT_NAME], { stdio: 'ignore' });
  return r.status === 0;
}

export interface LinuxStatus {
  active: boolean;
  state: string;
  pid: number | null;
  raw: string;
}

export function statusLinux(): LinuxStatus | null {
  const r = spawnSync('systemctl', ['--user', 'show', LINUX_UNIT_NAME], {
    encoding: 'utf8',
  });
  if (r.status !== 0) return null;
  const out = r.stdout || '';
  const m = (k: string) => {
    const match = out.match(new RegExp(`^${k}=(.*)$`, 'm'));
    return match ? match[1].trim() : '';
  };
  const state = m('ActiveState');
  const pidStr = m('MainPID');
  return {
    active: state === 'active',
    state,
    pid: pidStr && pidStr !== '0' ? parseInt(pidStr, 10) : null,
    raw: out,
  };
}
