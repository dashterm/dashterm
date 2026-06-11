/**
 * Per-app SQLite. Each agent-authored app gets its OWN database file at
 * <dataDir>/app-data/<uid>/<shareCode>.db, exposed to its backend as ctx.db.
 *
 * Isolation is by (owner, app): the path is built only from the cookie-verified
 * uid and the owner-checked share code, so an app can't reach another app's
 * data or the gateway's own state.db. The file is created lazily on first use,
 * so apps that never touch ctx.db never create one. Open handles are cached and
 * kept in WAL mode — better-sqlite3 is synchronous, so concurrent requests in
 * the process serialise naturally.
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import type { GatewayConfig } from '../config';

export interface AppDb {
  /** Run raw SQL with no result (DDL, multiple statements). */
  exec(sql: string): void;
  /** Insert/update/delete. params: positional array or named-param object. */
  run(
    sql: string,
    params?: unknown[] | Record<string, unknown>,
  ): { changes: number; lastInsertRowid: number | bigint };
  /** Fetch a single row (or undefined). */
  get<T = unknown>(sql: string, params?: unknown[] | Record<string, unknown>): T | undefined;
  /** Fetch all matching rows. */
  all<T = unknown>(sql: string, params?: unknown[] | Record<string, unknown>): T[];
}

// Share codes are 5 chars from [A-HJ-NP-Z2-9]; allow a slightly wider alnum
// range and bound the length so it's always a safe single path segment.
const SHARE_CODE_RE = /^[A-Za-z0-9]{1,16}$/;
const handles = new Map<string, Database.Database>();

function argify(params?: unknown[] | Record<string, unknown>): unknown[] {
  if (params === undefined || params === null) return [];
  // Array → positional (?), object → a single named-param argument (@name).
  return Array.isArray(params) ? params : [params];
}

function openHandle(config: GatewayConfig, uid: string, shareCode: string): Database.Database {
  if (uid.includes('/') || uid.includes('..') || uid.includes('\\')) throw new Error('invalid uid');
  if (!SHARE_CODE_RE.test(shareCode)) throw new Error('invalid app id');
  const dir = path.join(config.dataDir, 'app-data', uid);
  const file = path.join(dir, `${shareCode}.db`);
  const cached = handles.get(file);
  if (cached) return cached;
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  handles.set(file, db);
  return db;
}

export function getAppDb(config: GatewayConfig, uid: string, shareCode: string): AppDb {
  // Lazy: the handle (and file) open on first real query, not on ctx build.
  let db: Database.Database | null = null;
  const handle = () => (db ??= openHandle(config, uid, shareCode));
  return {
    exec: (sql) => {
      handle().exec(sql);
    },
    run: (sql, params) => {
      const info = handle().prepare(sql).run(...argify(params));
      return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
    },
    get: (sql, params) => handle().prepare(sql).get(...argify(params)) as never,
    all: (sql, params) => handle().prepare(sql).all(...argify(params)) as never[],
  };
}

/** Drop an app's database file + cached handle (e.g. when an app is deleted). */
export function deleteAppDb(config: GatewayConfig, uid: string, shareCode: string): void {
  if (uid.includes('/') || uid.includes('..') || uid.includes('\\')) return;
  if (!SHARE_CODE_RE.test(shareCode)) return;
  const file = path.join(config.dataDir, 'app-data', uid, `${shareCode}.db`);
  const cached = handles.get(file);
  if (cached) {
    try {
      cached.close();
    } catch {
      /* already closed */
    }
    handles.delete(file);
  }
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(file + suffix);
    } catch {
      /* not present */
    }
  }
}
