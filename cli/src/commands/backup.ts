/**
 * `dashterm backup [dest]` / `dashterm restore <src>` — snapshot and restore
 * the gateway's sqlite database (DASHTERM_DATA_DIR/state.db, default
 * ~/.dashterm/state.db).
 *
 * backup uses better-sqlite3's online backup API, so it is safe to run while
 * the gateway is live — you get a consistent single-file snapshot that
 * includes any committed WAL frames.
 *
 * restore overwrites the live database from a snapshot. The gateway must be
 * stopped first (it holds the file open in WAL mode). restore auto-saves the
 * current db to a state.db.pre-restore-<ts> file, so a mistaken restore is
 * reversible.
 */

import fs from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { c, error, info, success, warn } from '../lib/log';

// The CLI takes no direct better-sqlite3 dep — we lazy-require it from the
// server package. Only the bits we use are typed here.
type SqliteDb = {
  backup: (destination: string) => Promise<{ totalPages: number; remainingPages: number }>;
  close: () => void;
};

interface ServerModule {
  openDb: (dataDir: string) => SqliteDb;
}

function dataDir(): string {
  return process.env.DASHTERM_DATA_DIR || path.join(homedir(), '.dashterm');
}

const monorepoRoot = path.resolve(__dirname, '../../..');
const SERVER_DIST = [
  path.join(monorepoRoot, 'packages/server'),
  path.join(__dirname, '../../../server'),
];

function loadServer(): ServerModule | null {
  for (const root of SERVER_DIST) {
    try {
      const db = require(path.join(root, 'dist', 'db.js')) as Partial<ServerModule>;
      if (db?.openDb) return { openDb: db.openDb };
    } catch {
      /* try next layout */
    }
  }
  return null;
}

function withServer(): ServerModule {
  const mod = loadServer();
  if (!mod) {
    error('Server module not found. Run `npm install` and `npm run build` in packages/server/.');
    process.exit(2);
  }
  return mod;
}

// better-sqlite3 isn't a CLI dep; borrow it from the server package to open an
// arbitrary file (the backup) for validation.
function loadBetterSqlite(): (new (p: string, o?: object) => SqliteProbe) | null {
  const candidates = [
    ...SERVER_DIST.map((r) => path.join(r, 'node_modules/better-sqlite3')),
    'better-sqlite3',
  ];
  for (const cand of candidates) {
    try {
      return require(cand) as new (p: string, o?: object) => SqliteProbe;
    } catch {
      /* try next */
    }
  }
  return null;
}

type SqliteProbe = {
  prepare: (sql: string) => { get: () => { n: number } | undefined };
  close: () => void;
};

// YYYYMMDD-HHMMSS in local time, filesystem-safe.
function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export async function backupCommand(args: string[]): Promise<number> {
  const dir = dataDir();
  const livePath = path.join(dir, 'state.db');
  if (!fs.existsSync(livePath)) {
    error(`No database at ${livePath}. Nothing to back up (has the gateway started yet?).`);
    return 1;
  }

  // Destination: explicit file, an existing directory (→ timestamped file
  // inside), or the default timestamped file in the current directory.
  const defaultName = `dashterm-backup-${stamp()}.db`;
  let dest = args.find((a) => !a.startsWith('--'));
  if (!dest) {
    dest = path.join(process.cwd(), defaultName);
  } else if (fs.existsSync(dest) && fs.statSync(dest).isDirectory()) {
    dest = path.join(dest, defaultName);
  }
  dest = path.resolve(dest);

  if (fs.existsSync(dest)) {
    error(`Refusing to overwrite existing file: ${dest}`);
    return 1;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  const { openDb } = withServer();
  const db = openDb(dir);
  try {
    // Online backup: a consistent snapshot even while the gateway is running.
    await db.backup(dest);
  } catch (e: unknown) {
    error(`Backup failed: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  } finally {
    try {
      db.close();
    } catch {
      /* one-shot CLI process; the handle is released on exit anyway */
    }
  }

  const kib = (fs.statSync(dest).size / 1024).toFixed(1);
  success(`Backed up → ${c.bold(dest)}`);
  info(c.gray(`  ${kib} KiB · restore with \`dashterm restore ${dest}\``));
  return 0;
}

export async function restoreCommand(args: string[]): Promise<number> {
  const src = args.find((a) => !a.startsWith('--'));
  if (!src) {
    error('Usage: dashterm restore <backup.db>');
    return 1;
  }
  const srcPath = path.resolve(src);
  if (!fs.existsSync(srcPath)) {
    error(`No such file: ${srcPath}`);
    return 1;
  }

  // Validate it's a DashTerm sqlite db before we clobber anything.
  const Database = loadBetterSqlite();
  let userCount: number | null = null;
  if (Database) {
    try {
      const probe = new Database(srcPath, { readonly: true, fileMustExist: true });
      userCount = probe.prepare('select count(*) as n from users').get()?.n ?? 0;
      probe.close();
    } catch {
      error(`Not a valid DashTerm database (no users table): ${srcPath}`);
      return 1;
    }
  } else {
    // Fallback: at least confirm the SQLite file magic.
    const fd = fs.openSync(srcPath, 'r');
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    if (!buf.toString('utf8').startsWith('SQLite format 3')) {
      error(`Not a SQLite database: ${srcPath}`);
      return 1;
    }
  }

  const dir = dataDir();
  const livePath = path.join(dir, 'state.db');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  warn('Restore overwrites the live database. Stop the gateway first — it holds');
  warn('the file open in WAL mode, and overwriting it underneath a live process');
  warn('can corrupt the copy. Re-run after `dashterm daemon uninstall` / Ctrl-C.');

  // Auto-save the current db so a mistaken restore is reversible.
  if (fs.existsSync(livePath)) {
    const safety = path.join(dir, `state.db.pre-restore-${stamp()}`);
    fs.copyFileSync(livePath, safety);
    info(c.gray(`  saved current db → ${safety}`));
  }

  // Replace, then clear stale WAL/SHM sidecars (they belong to the old file).
  fs.copyFileSync(srcPath, livePath);
  for (const side of ['state.db-wal', 'state.db-shm']) {
    const p = path.join(dir, side);
    if (fs.existsSync(p)) fs.rmSync(p);
  }

  success(`Restored ${path.basename(srcPath)} → ${livePath}`);
  if (userCount !== null) info(c.gray(`  users in restored db: ${userCount}`));
  info(c.gray('  start the gateway: `dashterm start`'));
  return 0;
}
