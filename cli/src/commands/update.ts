/**
 * `dashterm update [--check] [--json] [--force] [--no-restart]`
 *
 * Native (git-checkout) self-update. The signal is the latest release TAG:
 *   current = `git describe --tags` (the tag this checkout sits on)
 *   latest  = highest stable semver tag from `git ls-remote --tags`
 *
 * Apply order is deliberately "stop → build → start" so the rebuild never
 * overwrites files the running gateway holds open (notably better-sqlite3's
 * mmap'd .node binding, whose in-place rewrite can SIGSEGV a live process):
 *   1. acquire ~/.dashterm/update.lock (O_EXCL; reclaim a dead pid)
 *   2. stop the gateway daemon (if installed)
 *   3. git fetch --tags && git checkout <tag>
 *   4. npm install (postinstall rebuilds server + CLI)
 *   5. expo export → web-dist
 *   6. start the gateway daemon
 * On failure it rolls back to the prior ref and restarts. When the gateway's
 * /api/update/run triggers this, it runs DETACHED (systemd-run --user on Linux,
 * a setsid spawn on macOS) so it outlives the restart in step 6.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { isDaemonInstalled, startDaemon, stopDaemon } from '../daemon';
import { dashtermHome } from '../daemon/paths';
import { c, error, info, step, success, warn } from '../lib/log';

interface UpdateFlags {
  check: boolean;
  json: boolean;
  force: boolean;
  noRestart: boolean;
}

function parseFlags(args: string[]): UpdateFlags {
  return {
    check: args.includes('--check'),
    json: args.includes('--json'),
    force: args.includes('--force'),
    noRestart: args.includes('--no-restart'),
  };
}

// ---- semver (kept in sync with packages/server/src/infra/update.ts) ----

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

interface Semver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

function parseSemver(tag: string): Semver | null {
  const m = SEMVER_RE.exec(tag.trim());
  if (!m) return null;
  return {
    major: parseInt(m[1], 10),
    minor: parseInt(m[2], 10),
    patch: parseInt(m[3], 10),
    prerelease: m[4] ?? null,
  };
}

function compareSemver(a: string, b: string): number {
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

// ---- git + process helpers ----

function repoRoot(): string {
  // __dirname is cli/dist/commands → up 3 to the monorepo root (same anchor
  // resolveServerEntry in gateway.ts uses).
  return path.resolve(__dirname, '../../..');
}

function gitOut(args: string[], cwd: string): string | null {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 20_000 });
  if (r.status !== 0) return null;
  return (r.stdout || '').trim();
}

/** Run a child, streaming its output to our stdio (→ update.log when detached). */
function run(cmd: string, args: string[], cwd: string, extraEnv?: Record<string, string>): void {
  const r = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited ${r.status}`);
}

/** The npm/npx that ships beside this node (handles nvm/homebrew where the
 *  daemon's hardcoded PATH wouldn't find the matching binary). */
function siblingBin(name: string): string {
  const cand = path.join(path.dirname(process.execPath), name);
  return fs.existsSync(cand) ? cand : name;
}

function currentVersion(root: string): string | null {
  const exact = gitOut(['describe', '--tags', '--exact-match'], root);
  if (exact) return exact;
  const nearest = gitOut(['describe', '--tags', '--abbrev=0'], root);
  if (nearest) return nearest;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}

function latestRemoteTag(root: string): { tag: string | null; error: string | null } {
  const remote = process.env.DASHTERM_REPO_URL?.trim() || 'origin';
  const out = gitOut(['ls-remote', '--tags', '--refs', remote], root);
  if (out === null) return { tag: null, error: 'git ls-remote failed' };
  let best: string | null = null;
  for (const line of out.split('\n')) {
    const m = /refs\/tags\/(.+)$/.exec(line.trim());
    if (!m) continue;
    const parsed = parseSemver(m[1]);
    if (!parsed || parsed.prerelease) continue;
    if (best === null || compareSemver(m[1], best) > 0) best = m[1];
  }
  return { tag: best, error: null };
}

function isDirty(root: string): boolean {
  const out = gitOut(['status', '--porcelain'], root);
  return !!out && out.length > 0;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ---- lock ----

function lockPath(): string {
  return path.join(dashtermHome(), 'update.lock');
}

function acquireLock(from: string | null, to: string): boolean {
  fs.mkdirSync(dashtermHome(), { recursive: true });
  const body = JSON.stringify({ pid: process.pid, startedAt: Date.now(), from, to });
  try {
    const fd = fs.openSync(lockPath(), 'wx'); // O_EXCL — fails if it exists
    fs.writeSync(fd, body);
    fs.closeSync(fd);
    return true;
  } catch {
    // Exists — reclaim only if the recorded pid is dead.
    try {
      const info = JSON.parse(fs.readFileSync(lockPath(), 'utf8')) as { pid?: number };
      if (typeof info.pid === 'number' && isPidAlive(info.pid)) return false;
    } catch {
      /* unreadable lock — treat as stale */
    }
    fs.writeFileSync(lockPath(), body);
    return true;
  }
}

function releaseLock(): void {
  try {
    fs.unlinkSync(lockPath());
  } catch {
    /* already gone */
  }
}

// ---- command ----

export async function updateCommand(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const root = repoRoot();

  if (!fs.existsSync(path.join(root, '.git'))) {
    const msg = `not a git checkout (${root}) — self-update only works for git installs`;
    if (flags.json) info(JSON.stringify({ ok: false, error: msg }));
    else error(msg);
    return 1;
  }

  const current = currentVersion(root);
  const latest = latestRemoteTag(root);
  const available = !!(current && latest.tag && compareSemver(current, latest.tag) < 0);

  if (flags.check) {
    if (flags.json) {
      info(JSON.stringify({
        ok: true,
        current,
        latest: latest.tag,
        available,
        error: latest.error,
      }));
    } else {
      info(`current : ${current ?? '?'}`);
      info(`latest  : ${latest.tag ?? '?'}${latest.error ? c.gray(` (${latest.error})`) : ''}`);
      info(available ? c.yellow('update available') : c.green('up to date'));
    }
    return available ? 10 : 0;
  }

  // --- apply ---
  if (!latest.tag) {
    error(`could not resolve the latest release tag${latest.error ? ` (${latest.error})` : ''}`);
    return 1;
  }
  if (!available) {
    success(`already up to date (${current ?? '?'})`);
    return 0;
  }
  if (!flags.force && isDirty(root)) {
    error('working tree has uncommitted changes; commit/stash them or rerun with --force');
    return 1;
  }

  if (!acquireLock(current, latest.tag)) {
    error('another update is already running (update.lock held)');
    return 1;
  }

  const fromRef = gitOut(['rev-parse', 'HEAD'], root) || 'HEAD';
  const daemon = isDaemonInstalled();
  const willRestart = daemon && !flags.noRestart;
  const npm = siblingBin('npm');
  const npx = siblingBin('npx');

  try {
    info(c.bold(`Updating ${current} → ${latest.tag}`));

    if (willRestart) {
      step('stopping gateway');
      stopDaemon();
    } else if (!daemon) {
      warn('no daemon installed — will build but not restart (start the gateway manually after)');
    }

    step('git fetch --tags');
    run('git', ['fetch', '--tags', 'origin'], root);
    step(`git checkout ${latest.tag}`);
    run('git', ['checkout', latest.tag], root);
    step('npm install (rebuilds server + CLI)');
    run(npm, ['install', '--no-audit', '--no-fund'], root);
    step('building web bundle');
    run(npx, ['expo', 'export', '--platform', 'web', '--output-dir', 'web-dist'], root, {
      EXPO_PUBLIC_GATEWAY_URL: '',
    });

    if (willRestart) {
      step('starting gateway');
      startDaemon();
    }

    success(`updated to ${latest.tag}`);
    if (flags.json) info(JSON.stringify({ ok: true, from: current, to: latest.tag }));
    return 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    error(`update failed: ${msg}`);
    try {
      warn(`rolling back to ${fromRef.slice(0, 12)}`);
      run('git', ['checkout', fromRef], root);
      run(npm, ['install', '--no-audit', '--no-fund'], root);
    } catch (re) {
      error(`rollback failed: ${re instanceof Error ? re.message : String(re)}`);
    }
    if (isDaemonInstalled() && !flags.noRestart) startDaemon();
    if (flags.json) info(JSON.stringify({ ok: false, error: msg }));
    return 1;
  } finally {
    releaseLock();
  }
}
