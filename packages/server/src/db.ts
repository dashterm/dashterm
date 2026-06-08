/**
 * SQLite wrapper. One Database handle per process, opened lazily.
 *
 * WAL mode is enabled so the gateway can read while a write transaction
 * holds the file lock. Synchronous = NORMAL trades a tiny window of
 * crash-loss for ~10x write throughput, which is the right tradeoff for
 * a homelab app.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

let _db: Database.Database | null = null;
let _dbPath: string | null = null;

export function openDb(dataDir: string): Database.Database {
  if (_db) {
    if (_dbPath !== path.join(dataDir, 'state.db')) {
      throw new Error(
        `db already opened at ${_dbPath}, refusing to switch to ${dataDir}`,
      );
    }
    return _db;
  }
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const dbPath = path.join(dataDir, 'state.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  _db = db;
  _dbPath = dbPath;
  runMigrations(db);
  return db;
}

export function getDb(): Database.Database {
  if (!_db) throw new Error('db not opened — call openDb(dataDir) first');
  return _db;
}

/**
 * Apply every migration in src/migrations/ in lexicographic order.
 * Tracks applied filenames in a `schema_migrations` table so reruns are
 * idempotent.
 */
function runMigrations(db: Database.Database): void {
  db.exec(`
    create table if not exists schema_migrations (
      filename text primary key,
      applied_at integer not null
    );
  `);

  // tsc doesn't copy .sql files into dist/, so look in both the colocated
  // dist/migrations (when a publish step copies them) and ../src/migrations
  // (the monorepo source layout, where dist sits next to src).
  const migrationsDir = [
    path.join(__dirname, 'migrations'),
    path.join(__dirname, '..', 'src', 'migrations'),
  ].find((p) => fs.existsSync(p));
  if (!migrationsDir) {
    throw new Error(
      `migrations directory not found near ${__dirname}; checked ./migrations and ../src/migrations`,
    );
  }
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const seen = new Set(
    (db.prepare('select filename from schema_migrations').all() as { filename: string }[])
      .map((r) => r.filename),
  );

  for (const file of files) {
    if (seen.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare('insert into schema_migrations (filename, applied_at) values (?, ?)').run(
        file,
        Date.now(),
      );
    });
    tx();
    console.log(`[db] applied ${file}`);
  }
}
