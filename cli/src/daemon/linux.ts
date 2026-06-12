/**
 * Linux systemd-user integration for the native gateway. Drops a
 * unit at $XDG_CONFIG_HOME/systemd/user/dashterm-gateway.service,
 * runs `systemctl --user daemon-reload && enable --now`.
 *
 * Headless boxes need `loginctl enable-linger $USER` to keep the unit
 * alive across logouts; surfaced in the error message if enable fails.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { DaemonInstallEnv } from './macos';
import { gatewayErrLogPath, gatewayLogPath, dashtermHome } from './paths';
import { LINUX_SERVICE_TEMPLATE, renderTemplate } from './templates';

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

  const body = renderTemplate(LINUX_SERVICE_TEMPLATE, {
    NODE_BIN: nodeBin,
    DASHTERM_BIN: dashtermBin,
    HOME: os.homedir(),
    DATA_DIR: env.dataDir,
    PORT: env.port,
    BIND: env.bind,
    LOG_PATH: gatewayLogPath(),
    ERR_LOG_PATH: gatewayErrLogPath(),
  });
  fs.writeFileSync(unit, body, { mode: 0o644 });

  for (const args of [['daemon-reload'], ['enable', '--now', LINUX_UNIT_NAME]]) {
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
  return unit;
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
