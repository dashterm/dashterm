/**
 * Cross-platform shim for the gateway daemon. Routes to launchd on
 * macOS, systemd-user on Linux, and Task Scheduler (schtasks) on
 * Windows. Other platforms bail with an instructive error (run
 * `dashterm start` in the foreground or set up your own service manager).
 *
 * The CLI layer (cli/src/commands/daemon.ts) calls into this module;
 * platform specifics live next to it (./macos, ./linux, ./windows).
 */

import fs from 'node:fs';
import {
  type DaemonInstallEnv,
  installMacos,
  isInstalledMacos,
  macosPlistPath,
  startMacos,
  statusMacos,
  stopMacos,
  uninstallMacos,
} from './macos';
import {
  installLinux,
  isInstalledLinux,
  linuxUnitPath,
  startLinux,
  statusLinux,
  stopLinux,
  uninstallLinux,
} from './linux';
import {
  installWindows,
  isInstalledWindows,
  startWindows,
  statusWindows,
  stopWindows,
  uninstallWindows,
  windowsScriptPath,
} from './windows';

export type { DaemonInstallEnv } from './macos';

function resolveNodeBin(): string {
  // process.execPath = the Node binary running this very process. That's
  // exactly what we want baked into the unit so nvm/fnm versions stay
  // honoured at boot.
  return process.execPath;
}

function resolveDashTermBin(): string {
  // process.argv[1] = the entry script (dist/index.js or src/index.ts via
  // tsx). For `dashterm` invoked via the npm-link symlink, this resolves
  // to the real dist/index.js path, which is what launchd wants.
  const candidate = process.argv[1];
  if (!candidate || !fs.existsSync(candidate)) {
    throw new Error(
      `Could not resolve the dashterm CLI path (argv[1]=${candidate || '?'}). ` +
        `Re-run via the installed \`dashterm\` binary, not \`node dist/index.js\` directly.`,
    );
  }
  return candidate;
}

export function installDaemon(env: DaemonInstallEnv): string {
  const nodeBin = resolveNodeBin();
  const dashtermBin = resolveDashTermBin();
  if (process.platform === 'darwin') {
    return installMacos(nodeBin, dashtermBin, env);
  }
  if (process.platform === 'linux') {
    return installLinux(nodeBin, dashtermBin, env);
  }
  if (process.platform === 'win32') {
    return installWindows(nodeBin, dashtermBin, env);
  }
  throw new Error(
    `Daemon install isn't supported on ${process.platform}. Run \`dashterm start\` ` +
      `in the foreground, or set up your own service manager pointing at ${dashtermBin}.`,
  );
}

export function uninstallDaemon(): boolean {
  if (process.platform === 'darwin') return uninstallMacos();
  if (process.platform === 'linux') return uninstallLinux();
  if (process.platform === 'win32') return uninstallWindows();
  return false;
}

export function isDaemonInstalled(): boolean {
  if (process.platform === 'darwin') return isInstalledMacos();
  if (process.platform === 'linux') return isInstalledLinux();
  if (process.platform === 'win32') return isInstalledWindows();
  return false;
}

/** Stop the running gateway without removing the unit (for in-place updates). */
export function stopDaemon(): boolean {
  if (process.platform === 'darwin') return stopMacos();
  if (process.platform === 'linux') return stopLinux();
  if (process.platform === 'win32') return stopWindows();
  return false;
}

/** Start the gateway from the already-installed unit. */
export function startDaemon(): boolean {
  if (process.platform === 'darwin') return startMacos();
  if (process.platform === 'linux') return startLinux();
  if (process.platform === 'win32') return startWindows();
  return false;
}

export function daemonUnitPath(): string | null {
  if (process.platform === 'darwin') return macosPlistPath();
  if (process.platform === 'linux') return linuxUnitPath();
  if (process.platform === 'win32') return windowsScriptPath();
  return null;
}

export interface DaemonStatus {
  installed: boolean;
  unitPath: string | null;
  active: boolean | null; // null when we can't tell (e.g. status query failed)
  pid: number | null;
  raw: string | null;
}

export function daemonStatus(): DaemonStatus {
  const unitPath = daemonUnitPath();
  const installed = isDaemonInstalled();
  if (!installed) {
    return { installed: false, unitPath, active: null, pid: null, raw: null };
  }
  if (process.platform === 'darwin') {
    const s = statusMacos();
    return {
      installed,
      unitPath,
      active: s ? (s.pid !== null && s.pid > 0) : null,
      pid: s?.pid ?? null,
      raw: s?.raw ?? null,
    };
  }
  if (process.platform === 'linux') {
    const s = statusLinux();
    return {
      installed,
      unitPath,
      active: s?.active ?? null,
      pid: s?.pid ?? null,
      raw: s?.raw ?? null,
    };
  }
  if (process.platform === 'win32') {
    const s = statusWindows();
    return {
      installed,
      unitPath,
      active: s?.active ?? null,
      // schtasks /Query doesn't expose the worker PID; leave it unknown.
      pid: null,
      raw: s?.raw ?? null,
    };
  }
  return { installed, unitPath, active: null, pid: null, raw: null };
}
