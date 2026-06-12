/**
 * Self-update detection + handoff for the native (git-checkout) install.
 *
 * dashterm installs as a git checkout at ~/.dashterm/src (scripts/install.sh).
 * "Is there a new version?" is answered from git, not package.json: the root
 * package.json version is not bumped per release, but releases are tagged
 * (1.0.3 … 1.0.25). So:
 *   - currentVersion = `git describe --tags` (the tag this checkout sits on)
 *   - latestVersion  = highest stable semver tag from `git ls-remote --tags`
 *
 * The actual update can't happen in-process — rebuilding + restarting the
 * gateway would pull the rug from under the running process (notably
 * better-sqlite3's mmap'd .node binding). So `launchUpdater()` spawns a
 * DETACHED `dashterm update`, decoupled from the gateway's service lifecycle,
 * that stops the gateway, rebuilds, and starts it again. On Linux that means
 * `systemd-run --user` (a transient unit OUTSIDE the gateway's cgroup, so
 * `systemctl --user stop` of the gateway doesn't kill the updater); on macOS a
 * `detached` spawn (setsid) survives launchd's bootout.
 */

import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { GatewayConfig } from '../config';

const GIT_TIMEOUT_MS = 20_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const BOOT_DELAY_MS = 20_000;

export interface UpdateStatus {
  /** false in dev / non-git checkouts — the banner stays hidden. */
  supported: boolean;
  /** why unsupported (set when supported=false). */
  reason: string | null;
  available: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
  /** a daemon is installed, so the updater can restart automatically. */
  canRestart: boolean;
  /** an update is currently in progress (lock held by a live pid). */
  running: boolean;
  checkedAt: number | null;
  /** last check error (offline / git failure); never blocks the gateway. */
  error: string | null;
}

// ---- semver (self-contained; no dependency) ----

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

interface Semver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

export function parseSemver(tag: string): Semver | null {
  const m = SEMVER_RE.exec(tag.trim());
  if (!m) return null;
  return {
    major: parseInt(m[1], 10),
    minor: parseInt(m[2], 10),
    patch: parseInt(m[3], 10),
    prerelease: m[4] ?? null,
  };
}

/** -1 if a<b, 1 if a>b, 0 if equal/unparseable. A release outranks its prerelease. */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;
  if (pa.prerelease && !pb.prerelease) return -1;
  if (!pa.prerelease && pb.prerelease) return 1;
  if (pa.prerelease && pb.prerelease) {
    if (pa.prerelease < pb.prerelease) return -1;
    if (pa.prerelease > pb.prerelease) return 1;
  }
  return 0;
}

// ---- git helpers ----

function git(args: string[], cwd: string): { ok: boolean; out: string; err: string } {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: GIT_TIMEOUT_MS });
  return {
    ok: r.status === 0,
    out: (r.stdout || '').trim(),
    err: (r.stderr || '').trim() || (r.error ? r.error.message : ''),
  };
}

function resolveRepoRoot(config: GatewayConfig): string {
  // webBundleDir is <repoRoot>/web-dist when a bundle is present — the most
  // reliable anchor. Fall back to walking up from this compiled file
  // (dist/infra/update.js → repo root is four levels up).
  if (config.webBundleDir) return path.dirname(path.resolve(config.webBundleDir));
  return path.resolve(__dirname, '../../../..');
}

function isGitRepo(root: string): boolean {
  return fs.existsSync(path.join(root, '.git'));
}

/** The tag this checkout sits on, else the nearest ancestor tag, else package.json. */
function currentVersion(root: string): string | null {
  const exact = git(['describe', '--tags', '--exact-match'], root);
  if (exact.ok && exact.out) return exact.out;
  const nearest = git(['describe', '--tags', '--abbrev=0'], root);
  if (nearest.ok && nearest.out) return nearest.out;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}

/** Highest stable (non-prerelease) semver tag on the remote. */
function latestRemoteTag(root: string): { tag: string | null; error: string | null } {
  const remote = process.env.DASHTERM_REPO_URL?.trim() || 'origin';
  const r = git(['ls-remote', '--tags', '--refs', remote], root);
  if (!r.ok) return { tag: null, error: r.err || 'git ls-remote failed' };
  let best: string | null = null;
  for (const line of r.out.split('\n')) {
    const m = /refs\/tags\/(.+)$/.exec(line.trim());
    if (!m) continue;
    const tag = m[1];
    const parsed = parseSemver(tag);
    if (!parsed) continue; // skip non-semver tags (nightly, latest, …)
    if (parsed.prerelease) continue; // stable channel only
    if (best === null || compareSemver(tag, best) > 0) best = tag;
  }
  return { tag: best, error: null };
}

// ---- environment detection ----

function runningViaTsx(): boolean {
  // In `npm run dev` the gateway boots from src/cli.ts via tsx; argv[1] is a
  // .ts path. A prod install runs dist/cli.js.
  return (process.argv[1] || '').endsWith('.ts');
}

function daemonInstalled(): boolean {
  if (process.platform === 'darwin') {
    return fs.existsSync(
      path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.dashterm.gateway.plist'),
    );
  }
  if (process.platform === 'linux') {
    const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    return fs.existsSync(path.join(xdg, 'systemd', 'user', 'dashterm-gateway.service'));
  }
  return false;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function updateLockPath(config: GatewayConfig): string {
  return path.join(config.dataDir, 'update.lock');
}

/** True only when a lock exists AND its recorded pid is still alive. */
export function isUpdateRunning(config: GatewayConfig): boolean {
  try {
    const info = JSON.parse(fs.readFileSync(updateLockPath(config), 'utf8')) as {
      pid?: number;
    };
    return typeof info.pid === 'number' && isPidAlive(info.pid);
  } catch {
    return false;
  }
}

// ---- status (cached) ----

let cache: UpdateStatus | null = null;

export function getUpdateStatus(
  config: GatewayConfig,
  opts: { force?: boolean } = {},
): UpdateStatus {
  const root = resolveRepoRoot(config);
  const running = isUpdateRunning(config);
  const canRestart = daemonInstalled();

  const unsupported = (reason: string): UpdateStatus => ({
    supported: false,
    reason,
    available: false,
    currentVersion: isGitRepo(root) ? currentVersion(root) : null,
    latestVersion: null,
    canRestart,
    running,
    checkedAt: cache?.checkedAt ?? null,
    error: null,
  });

  if (runningViaTsx()) return unsupported('dev runtime (tsx)');
  if (!config.webBundleDir) return unsupported('dev mode (no web bundle)');
  if (!isGitRepo(root)) return unsupported('not a git checkout');

  const stale = !cache || !cache.supported || Date.now() - (cache.checkedAt ?? 0) > CHECK_INTERVAL_MS;
  if (!opts.force && !stale && cache) {
    return { ...cache, running, canRestart };
  }

  const cur = currentVersion(root);
  const { tag: latest, error } = latestRemoteTag(root);
  const available = !!(cur && latest && compareSemver(cur, latest) < 0);
  cache = {
    supported: true,
    reason: null,
    available,
    currentVersion: cur,
    latestVersion: latest,
    canRestart,
    running,
    checkedAt: Date.now(),
    error,
  };
  return cache;
}

// ---- handoff: launch the detached updater ----

function hasSystemdRun(): boolean {
  const r = spawnSync('systemd-run', ['--version'], { stdio: 'ignore', timeout: 3000 });
  return r.status === 0;
}

/**
 * Spawn `dashterm update --json` detached from the gateway's service lifecycle.
 * The returned promise is irrelevant — the updater outlives this process.
 */
export function launchUpdater(config: GatewayConfig): { started: boolean; reason?: string } {
  const root = resolveRepoRoot(config);
  if (!isGitRepo(root)) return { started: false, reason: 'not a git checkout' };
  const cliEntry = path.join(root, 'cli', 'dist', 'index.js');
  if (!fs.existsSync(cliEntry)) return { started: false, reason: 'CLI build not found' };

  fs.mkdirSync(config.dataDir, { recursive: true });
  const logFd = fs.openSync(path.join(config.dataDir, 'update.log'), 'a');
  const node = process.execPath;

  try {
    if (process.platform === 'linux' && hasSystemdRun()) {
      // A transient SERVICE unit runs entirely outside dashterm-gateway.service's
      // cgroup, so the updater's later `systemctl --user stop dashterm-gateway`
      // can't kill it. setsid/unref alone would NOT escape the cgroup.
      const passEnv = [
        'DASHTERM_DATA_DIR',
        'DASHTERM_PORT',
        'DASHTERM_BIND',
        'PATH',
        'HOME',
        'XDG_RUNTIME_DIR',
        'DBUS_SESSION_BUS_ADDRESS',
      ];
      const setenv = passEnv
        .filter((k) => process.env[k])
        .map((k) => `--setenv=${k}=${process.env[k]}`);
      const child = spawn(
        'systemd-run',
        ['--user', '--collect', `--unit=dashterm-update-${Date.now()}`, ...setenv, node, cliEntry, 'update', '--json'],
        { cwd: root, detached: true, stdio: ['ignore', logFd, logFd], env: process.env },
      );
      child.unref();
      return { started: true };
    }

    // macOS (and Linux without systemd-run): detached:true gives the child its
    // own session (setsid); it survives launchd `bootout` / `kickstart -k`.
    const child = spawn(node, [cliEntry, 'update', '--json'], {
      cwd: root,
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: process.env,
    });
    child.unref();
    return { started: true };
  } catch (e) {
    return { started: false, reason: e instanceof Error ? e.message : String(e) };
  } finally {
    fs.closeSync(logFd);
  }
}

// ---- periodic check (boot + interval) ----

let timer: ReturnType<typeof setInterval> | null = null;
let lastBroadcastVersion: string | null = null;

/**
 * Kick off the boot + interval update check. Calls onAvailable(status) once per
 * newly-discovered latest version. Never throws into the timer.
 */
export function startUpdateChecker(
  config: GatewayConfig,
  onAvailable: (status: UpdateStatus) => void,
): void {
  const tick = () => {
    try {
      const status = getUpdateStatus(config, { force: true });
      if (
        status.supported &&
        status.available &&
        status.latestVersion &&
        status.latestVersion !== lastBroadcastVersion
      ) {
        lastBroadcastVersion = status.latestVersion;
        onAvailable(status);
      }
    } catch {
      /* a failed check must never take down the gateway */
    }
  };
  setTimeout(tick, BOOT_DELAY_MS).unref();
  timer = setInterval(tick, CHECK_INTERVAL_MS);
  timer.unref();
}
