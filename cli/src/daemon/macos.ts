/**
 * macOS launchd integration for the native gateway. Installs a
 * LaunchAgent under ~/Library/LaunchAgents/com.dashterm.gateway.plist,
 * loads it via `launchctl bootstrap`, and tears it back down on
 * uninstall.
 *
 * launchd's userland mental model:
 *   - "bootstrap" loads + immediately starts the service
 *   - "bootout" stops + unloads
 *   - We target `gui/$UID` (the user's GUI session domain) so the
 *     gateway lives as long as the user is logged in.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gatewayErrLogPath, gatewayLogPath, dashtermHome } from './paths';
import { MACOS_PLIST_TEMPLATE, renderTemplate } from './templates';

export const MACOS_AGENT_LABEL = 'com.dashterm.gateway';

export function macosPlistPath(): string {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${MACOS_AGENT_LABEL}.plist`);
}

export function isInstalledMacos(): boolean {
  return fs.existsSync(macosPlistPath());
}

export interface DaemonInstallEnv {
  port: string;
  bind: string;
  dataDir: string;
  /** Bake DASHTERM_AGENT_ENABLED=1 so the auto-started gateway can vibe-code
   *  apps via `claude`. Off by default (the gateway's own default). */
  agentEnabled?: boolean;
}

export function installMacos(
  nodeBin: string,
  dashtermBin: string,
  env: DaemonInstallEnv,
): string {
  const plist = macosPlistPath();
  fs.mkdirSync(path.dirname(plist), { recursive: true });
  fs.mkdirSync(dashtermHome(), { recursive: true, mode: 0o700 });

  const extra: string[] = [];
  if (env.agentEnabled) {
    extra.push(`<key>DASHTERM_AGENT_ENABLED</key>\n      <string>1</string>`);
  }
  const extraEnv = extra.join('\n      ');
  const body = renderTemplate(MACOS_PLIST_TEMPLATE, {
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
  fs.writeFileSync(plist, body, { mode: 0o644 });

  const uid = process.getuid?.() ?? -1;
  if (uid >= 0) {
    // Best-effort tear down any previous copy so bootstrap picks up the new
    // plist contents instead of the cached spec.
    spawnSync('launchctl', ['bootout', `gui/${uid}`, plist], { stdio: 'ignore' });
    const res = spawnSync('launchctl', ['bootstrap', `gui/${uid}`, plist], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (res.status !== 0) {
      const stderr = res.stderr ? res.stderr.toString().trim() : '';
      throw new Error(
        `launchctl bootstrap failed: ${stderr || `exit ${res.status}`}\n` +
          `The plist was written to ${plist} — you can try loading it manually:\n` +
          `  launchctl bootstrap gui/${uid} ${plist}`,
      );
    }
  }
  return plist;
}

export function uninstallMacos(): boolean {
  const plist = macosPlistPath();
  if (!fs.existsSync(plist)) return false;
  const uid = process.getuid?.() ?? -1;
  if (uid >= 0) {
    spawnSync('launchctl', ['bootout', `gui/${uid}`, plist], { stdio: 'ignore' });
  }
  try {
    fs.unlinkSync(plist);
  } catch {
    /* file already gone */
  }
  return true;
}

// Stop/start without removing the plist — used by `dashterm update` to take
// the gateway down for the rebuild, then bring it back up. `bootout` unloads
// the job (returns non-zero if it wasn't loaded — fine, we want it stopped);
// `bootstrap` reloads + starts it from the existing plist.
export function stopMacos(): boolean {
  const uid = process.getuid?.() ?? -1;
  if (uid < 0) return false;
  spawnSync('launchctl', ['bootout', `gui/${uid}/${MACOS_AGENT_LABEL}`], { stdio: 'ignore' });
  return true;
}

export function startMacos(): boolean {
  const plist = macosPlistPath();
  if (!fs.existsSync(plist)) return false;
  const uid = process.getuid?.() ?? -1;
  if (uid < 0) return false;
  const res = spawnSync('launchctl', ['bootstrap', `gui/${uid}`, plist], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return res.status === 0;
}

export interface MacosStatus {
  pid: number | null;
  lastExitCode: number | null;
  raw: string;
}

export function statusMacos(): MacosStatus | null {
  const uid = process.getuid?.() ?? -1;
  if (uid < 0) return null;
  const r = spawnSync(
    'launchctl',
    ['print', `gui/${uid}/${MACOS_AGENT_LABEL}`],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) return null;
  const out = r.stdout || '';
  const pidMatch = out.match(/^\s*pid\s*=\s*(\d+)/m);
  const exitMatch = out.match(/^\s*last exit code\s*=\s*(-?\d+)/m);
  return {
    pid: pidMatch ? parseInt(pidMatch[1], 10) : null,
    lastExitCode: exitMatch ? parseInt(exitMatch[1], 10) : null,
    raw: out,
  };
}
