/**
 * Windows autostart for the native gateway via Task Scheduler (schtasks).
 *
 * The Windows analog of launchd (macOS) / systemd-user (Linux) "run at login,
 * no admin" is a Scheduled Task with a LogonTrigger + RunLevel=LeastPrivilege.
 * We register it from an XML spec (schtasks /Create /XML) so we can set
 * crash-restart + on-battery flags the bare CLI flags don't expose, and point
 * its action at a generated gateway.cmd that sets DASHTERM_* env then runs
 * `dashterm start` — same shape as the env baked into the plist / systemd unit.
 *
 * Scope: this is the per-user, no-admin tier (the task lives with the logged-in
 * user, like `gui/$UID` launchd / `systemctl --user`). It does NOT survive a
 * logout on a headless box the way a true Windows Service would — that's the
 * deliberate trade for not needing elevation. No external deps; pure schtasks.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { DaemonInstallEnv } from './macos';
import { dashtermHome, gatewayErrLogPath, gatewayLogPath } from './paths';
import {
  WINDOWS_TASK_SCRIPT_TEMPLATE,
  WINDOWS_TASK_XML_TEMPLATE,
  renderTemplate,
} from './templates';

export const WINDOWS_TASK_NAME = 'DashTerm Gateway';

/** The launcher the scheduled task executes. Also doubles as our "unit path". */
export function windowsScriptPath(): string {
  return path.join(dashtermHome(), 'gateway.cmd');
}

function windowsXmlPath(): string {
  return path.join(dashtermHome(), 'gateway-task.xml');
}

interface SchtasksResult {
  status: number;
  stdout: string;
  stderr: string;
}

function schtasks(args: string[]): SchtasksResult {
  const r = spawnSync('schtasks', args, { encoding: 'utf8', windowsHide: true });
  return {
    status: r.status ?? -1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
}

/** Escape values interpolated into the task XML (paths can contain &, <, >). */
function xmlEscape(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function isInstalledWindows(): boolean {
  return schtasks(['/Query', '/TN', WINDOWS_TASK_NAME]).status === 0;
}

export function installWindows(
  nodeBin: string,
  dashtermBin: string,
  env: DaemonInstallEnv,
): string {
  fs.mkdirSync(dashtermHome(), { recursive: true });

  // 1. Write the launcher script the task runs: set env, then start the gateway.
  const script = renderTemplate(WINDOWS_TASK_SCRIPT_TEMPLATE, {
    NODE_BIN: nodeBin,
    DASHTERM_BIN: dashtermBin,
    DATA_DIR: env.dataDir,
    PORT: env.port,
    BIND: env.bind,
    LOG_PATH: gatewayLogPath(),
    ERR_LOG_PATH: gatewayErrLogPath(),
    EXTRA_ENV: [
      env.agentEnabled ? 'set "DASHTERM_AGENT_ENABLED=1"' : '',
      env.agentAllowRoot ? 'set "DASHTERM_AGENT_ALLOW_ROOT=1"' : '',
      env.codexEnabled ? 'set "DASHTERM_CODEX_ENABLED=1"' : '',
    ]
      .filter(Boolean)
      .join('\n'),
  });
  const scriptPath = windowsScriptPath();
  // cmd.exe wants CRLF and no BOM (a BOM gets echoed as stray bytes).
  fs.writeFileSync(scriptPath, script.replace(/\n/g, '\r\n'), 'utf8');

  // 2. Write the task spec. schtasks /XML insists on UTF-16 LE with a BOM.
  const xml = renderTemplate(WINDOWS_TASK_XML_TEMPLATE, {
    DESCRIPTION: 'DashTerm native gateway — starts at logon.',
    TASK_SCRIPT: xmlEscape(scriptPath),
  });
  const xmlPath = windowsXmlPath();
  fs.writeFileSync(xmlPath, '\ufeff' + xml, 'utf16le');

  try {
    // /F overwrites any existing task, so this is also the reinstall path.
    const create = schtasks(['/Create', '/F', '/TN', WINDOWS_TASK_NAME, '/XML', xmlPath]);
    if (create.status !== 0) {
      const detail = create.stderr.trim() || create.stdout.trim() || `exit ${create.status}`;
      throw new Error(
        `schtasks /Create failed: ${detail}\n` +
          `The task spec was written to ${xmlPath}. You can register it manually:\n` +
          `  schtasks /Create /F /TN "${WINDOWS_TASK_NAME}" /XML "${xmlPath}"`,
      );
    }
    // Stop any already-running instance first, then start fresh — otherwise a
    // reinstall/update leaves the old process (stale code) running. Mirrors
    // launchd bootout+bootstrap / systemd restart.
    schtasks(['/End', '/TN', WINDOWS_TASK_NAME]); // best-effort; no-op if not running
    schtasks(['/Run', '/TN', WINDOWS_TASK_NAME]);
  } finally {
    try {
      fs.unlinkSync(xmlPath);
    } catch {
      /* best effort — the temp spec is gone once registered */
    }
  }
  return scriptPath;
}

export function uninstallWindows(): boolean {
  if (!isInstalledWindows()) return false;
  schtasks(['/End', '/TN', WINDOWS_TASK_NAME]); // best-effort stop first
  const del = schtasks(['/Delete', '/F', '/TN', WINDOWS_TASK_NAME]);
  try {
    fs.unlinkSync(windowsScriptPath());
  } catch {
    /* launcher already gone */
  }
  return del.status === 0;
}

// Stop/start without removing the task — used by `dashterm update` to take the
// gateway down for the rebuild, then bring it back up. Both are best-effort.
export function stopWindows(): boolean {
  return schtasks(['/End', '/TN', WINDOWS_TASK_NAME]).status === 0;
}

export function startWindows(): boolean {
  return schtasks(['/Run', '/TN', WINDOWS_TASK_NAME]).status === 0;
}

export interface WindowsStatus {
  active: boolean;
  state: string;
  raw: string;
}

export function statusWindows(): WindowsStatus | null {
  const r = schtasks(['/Query', '/TN', WINDOWS_TASK_NAME, '/V', '/FO', 'LIST']);
  if (r.status !== 0) return null;
  // `/V /FO LIST` prints a "Status:  Running | Ready | Disabled" line.
  const m = r.stdout.match(/^Status:\s*(.+)$/m);
  const state = m ? m[1].trim() : '';
  return { active: /^Running$/i.test(state), state, raw: r.stdout };
}
