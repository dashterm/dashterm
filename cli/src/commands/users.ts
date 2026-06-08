/**
 * `dashterm add-user` / `list-users` / `delete-user` / `set-admin` — direct
 * sqlite mutations against ~/.dashterm/state.db.
 *
 * These commands run without the gateway up: useful for first-boot
 * provisioning (seed the operator account, hand out family credentials)
 * and for breaking glass when the dashboard is down.
 *
 * Native bindings: @node-rs/argon2 + better-sqlite3. Both ship from the
 * server package's node_modules — we lazy-require so the CLI doesn't pay
 * the boot cost on every invocation.
 */

import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { c, error, info, success, warn } from '../lib/log';

// The CLI doesn't take a direct better-sqlite3 dep — we lazy-require it
// from packages/server's node_modules. So the type stays opaque here.
type SqliteDb = {
  prepare: <P extends unknown[] = unknown[], R = unknown>(
    sql: string,
  ) => {
    all: (...p: P) => R[];
    get: (...p: P) => R | undefined;
    run: (...p: unknown[]) => { changes: number; lastInsertRowid: number | bigint };
  };
};

function dataDir(): string {
  return process.env.DASHTERM_DATA_DIR || path.join(homedir(), '.dashterm');
}

interface ServerModule {
  openDb: (dataDir: string) => SqliteDb;
  hashPassword: (pw: string) => Promise<string>;
}

function loadServer(): ServerModule | null {
  const tryRequire = (p: string) => {
    try {
      return require(p) as Partial<ServerModule>;
    } catch {
      return null;
    }
  };
  // packages/server/dist for built install; src for monorepo dev (handled by
  // the gateway command's tsx path, not here).
  // __dirname is cli/dist/commands → up 3 to monorepo root.
  const monorepoRoot = path.resolve(__dirname, '../../..');
  const candidates = [
    path.join(monorepoRoot, 'packages/server/dist'),
    // Global npm install layout: this file lives at <pkg>/cli/dist/commands,
    // server sits next door at <pkg>/server/dist.
    path.join(__dirname, '../../../server/dist'),
  ];
  for (const root of candidates) {
    const db = tryRequire(path.join(root, 'db.js'));
    const auth = tryRequire(path.join(root, 'auth.js'));
    if (db?.openDb && auth?.hashPassword) {
      return { openDb: db.openDb, hashPassword: auth.hashPassword };
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

function randomAlnum(len: number): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < len; i++) {
    s += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return s;
}

interface AddUserOpts {
  email: string;
  password?: string;
  admin: boolean;
  forceReset: boolean;
}

function parseAddUser(args: string[]): AddUserOpts | null {
  let email = '';
  let password: string | undefined;
  let admin = false;
  let forceReset = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--admin') admin = true;
    else if (a === '--force-reset') forceReset = true;
    else if (a === '--password') {
      password = args[i + 1];
      i++;
    } else if (!email && !a.startsWith('--')) {
      email = a;
    } else if (!password && !a.startsWith('--')) {
      password = a;
    }
  }
  if (!email || !email.includes('@')) {
    error('Usage: dashterm add-user <email> [password] [--admin] [--force-reset]');
    return null;
  }
  return { email: email.toLowerCase(), password, admin, forceReset };
}

export async function addUserCommand(args: string[]): Promise<number> {
  const opts = parseAddUser(args);
  if (!opts) return 1;
  const { openDb, hashPassword } = withServer();
  const db = openDb(dataDir());

  const existing = db
    .prepare<[string], { id: string }>('select id from users where email = ?')
    .get(opts.email);
  if (existing) {
    error(`User ${opts.email} already exists. Use \`set-admin\` or \`delete-user\` to modify.`);
    return 1;
  }

  const password = opts.password || randomAlnum(12);
  const hash = await hashPassword(password);
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `insert into users (id, email, password_hash, display_name, is_admin, must_reset_password, metadata, created_at, last_active)
       values (?, ?, ?, ?, ?, ?, '{}', ?, ?)`,
  ).run(
    id,
    opts.email,
    hash,
    opts.email.split('@')[0],
    opts.admin ? 1 : 0,
    opts.forceReset ? 1 : 0,
    now,
    now,
  );

  success(`Created ${opts.email}${opts.admin ? ' (admin)' : ''}`);
  if (!opts.password) {
    info(`  password: ${c.bold(password)}`);
    if (!opts.forceReset) {
      info(c.gray('  pass --force-reset if you want them to rotate it on first sign-in'));
    }
  }
  return 0;
}

export async function listUsersCommand(): Promise<number> {
  const { openDb } = withServer();
  const db = openDb(dataDir());
  interface Row {
    email: string;
    display_name: string;
    is_admin: number;
    must_reset_password: number;
    created_at: number;
    last_active: number;
  }
  const rows = db
    .prepare<[], Row>(
      'select email, display_name, is_admin, must_reset_password, created_at, last_active from users order by created_at asc',
    )
    .all();
  if (rows.length === 0) {
    warn('No users yet. Try `dashterm add-user <email> --admin`.');
    return 0;
  }
  const longest = Math.max(...rows.map((r: Row) => r.email.length), 5);
  info(c.bold('EMAIL'.padEnd(longest + 2) + 'ADMIN  RESET  LAST_ACTIVE'));
  for (const r of rows) {
    const last = r.last_active ? new Date(r.last_active).toISOString().slice(0, 16) : '—';
    info(
      `${r.email.padEnd(longest + 2)}${(r.is_admin ? 'yes' : 'no').padEnd(7)}${(r.must_reset_password ? 'yes' : 'no').padEnd(7)}${last}`,
    );
  }
  return 0;
}

export async function deleteUserCommand(args: string[]): Promise<number> {
  const email = args[0];
  if (!email) {
    error('Usage: dashterm delete-user <email>');
    return 1;
  }
  const { openDb } = withServer();
  const db = openDb(dataDir());
  const result = db
    .prepare('delete from users where email = ?')
    .run(email.toLowerCase());
  if (result.changes === 0) {
    error(`No such user: ${email}`);
    return 1;
  }
  success(`Deleted ${email}`);
  return 0;
}

export async function setAdminCommand(args: string[]): Promise<number> {
  const [email, flag] = args;
  if (!email || (flag !== 'true' && flag !== 'false')) {
    error('Usage: dashterm set-admin <email> <true|false>');
    return 1;
  }
  const { openDb } = withServer();
  const db = openDb(dataDir());
  const result = db
    .prepare('update users set is_admin = ? where email = ?')
    .run(flag === 'true' ? 1 : 0, email.toLowerCase());
  if (result.changes === 0) {
    error(`No such user: ${email}`);
    return 1;
  }
  success(`${email} → is_admin=${flag}`);
  return 0;
}
