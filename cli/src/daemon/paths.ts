/**
 * Filesystem paths the daemon writes to.
 *
 * Mirrors cli/src/serve/paths.ts but separates the gateway's log files
 * from the legacy serve command's. DASHTERM_HOME (or ~/.dashterm) is
 * the data root.
 */

import { homedir } from 'node:os';
import path from 'node:path';

export function dashtermHome(): string {
  return process.env.DASHTERM_DATA_DIR || process.env.DASHTERM_HOME || path.join(homedir(), '.dashterm');
}

export function gatewayLogPath(): string {
  return path.join(dashtermHome(), 'gateway.log');
}

export function gatewayErrLogPath(): string {
  return path.join(dashtermHome(), 'gateway.err.log');
}

/** Persisted daemon settings (bind/port + agent flags) — see daemon/config.ts. */
export function daemonConfigPath(): string {
  return path.join(dashtermHome(), 'daemon.json');
}
