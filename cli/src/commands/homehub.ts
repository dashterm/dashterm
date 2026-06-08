/**
 * `dashterm homehub` — manage the self-hostable Supabase + compile + web
 * bundle in services/homehub.
 *
 *   dashterm homehub init     # write .env with random secrets
 *   dashterm homehub up       # docker compose up -d, wait for healthchecks
 *   dashterm homehub down     # docker compose down (data persists in volumes)
 *   dashterm homehub logs     # tail logs (Ctrl-C to exit)
 *   dashterm homehub migrate  # apply unrun migrations against the live DB
 *   dashterm homehub status   # is it up? which services are healthy?
 *
 * Designed for operators: clear errors, idempotent commands, no
 * surprises. The bundle lives at services/homehub relative to the
 * monorepo root.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawnSync } from 'child_process';
import { c, error, info, success, warn } from '../lib/log';

// ---------------------------------------------------------------------------
// Resolve the bundle dir.
// The CLI ships as `dist/index.js` inside cli/; the monorepo root is two
// levels up. From an installed npm bin, we walk up from __dirname looking
// for a sibling services/homehub.
// ---------------------------------------------------------------------------

function findBundleDir(): string | null {
  // 1) Explicit override.
  const fromEnv = process.env.DASHTERM_HOMEHUB_DIR;
  if (fromEnv && fs.existsSync(path.join(fromEnv, 'docker-compose.yml'))) {
    return fromEnv;
  }
  // 2) Walk up looking for services/homehub/docker-compose.yml.
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'services', 'homehub', 'docker-compose.yml');
    if (fs.existsSync(candidate)) return path.dirname(candidate);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tiny HS256 JWT signer for Supabase role keys.
// ---------------------------------------------------------------------------

function b64url(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf) : buf;
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signJwt(payload: Record<string, unknown>, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerEnc = b64url(JSON.stringify(header));
  const payloadEnc = b64url(JSON.stringify(payload));
  const signing = `${headerEnc}.${payloadEnc}`;
  const sig = crypto.createHmac('sha256', secret).update(signing).digest();
  return `${signing}.${b64url(sig)}`;
}

function randomAlnum(len: number): string {
  // a-z A-Z 0-9, generated from random bytes; reject-and-resample is fine here.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  while (out.length < len) {
    const b = crypto.randomBytes(len - out.length);
    for (const byte of b) {
      if (byte < 248) out += alphabet[byte % alphabet.length];
      if (out.length === len) break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// docker compose helpers
// ---------------------------------------------------------------------------

// Derive a compose project name from the install root so two checkouts of
// DashTerm on the same machine don't end up sharing the same docker
// volumes. Without this, both installs default to project name "homehub"
// (the directory containing docker-compose.yml) and the second install's
// fresh .env collides with the first install's persisted postgres data.
//
// Override with COMPOSE_PROJECT_NAME if you want explicit control.
function composeProjectName(bundleDir: string): string {
  if (process.env.COMPOSE_PROJECT_NAME) return process.env.COMPOSE_PROJECT_NAME;
  const installRoot = path.resolve(bundleDir, '..', '..');
  const dir = path.basename(installRoot).toLowerCase();
  const sanitised = dir.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return `dashterm-${sanitised || 'default'}`;
}

function dockerComposeArgs(bundleDir: string, args: string[]): string[] {
  return [
    'compose',
    '--project-name', composeProjectName(bundleDir),
    '--project-directory', bundleDir,
    '-f', path.join(bundleDir, 'docker-compose.yml'),
    ...args,
  ];
}

function runDockerCompose(bundleDir: string, args: string[], _opts: { passthrough?: boolean } = {}): number {
  const r = spawnSync('docker', dockerComposeArgs(bundleDir, args), {
    stdio: 'inherit',
    cwd: bundleDir,
    env: process.env,
  });
  return r.status ?? 1;
}

function dockerAvailable(): boolean {
  const r = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { stdio: 'ignore' });
  return r.status === 0;
}

// Loads .env into process.env so subsequent psql exec calls see POSTGRES_USER etc.
// docker compose itself reads .env automatically, but our migrate command uses
// spawnSync('docker', ['exec', ...]) which doesn't go through compose env loading.
function loadEnvFile(bundleDir: string): void {
  const envPath = path.join(bundleDir, '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

// Run a psql command against the running postgres container. Returns the
// raw output + exit code. Stdin (sql) is fed through `docker compose exec -T`.
function psqlExec(bundleDir: string, sql: string): { code: number; stdout: string; stderr: string } {
  const dbName = process.env.POSTGRES_DB || 'dashterm';
  const dbUser = process.env.POSTGRES_USER || 'postgres';
  const r = spawnSync(
    'docker',
    dockerComposeArgs(bundleDir, [
      'exec', '-T', 'postgres',
      'psql', '-v', 'ON_ERROR_STOP=1', '-U', dbUser, '-d', dbName, '-A', '-t',
    ]),
    { input: sql, encoding: 'utf8' },
  );
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// Poll until auth.users exists. GoTrue creates it lazily on first boot via
// its own migrations; the wait is typically 5-15s. Returns true if found,
// false if the timeout expires.
async function waitForAuthSchema(bundleDir: string, timeoutSec: number): Promise<boolean> {
  const deadline = Date.now() + timeoutSec * 1000;
  let lastErr = '';
  while (Date.now() < deadline) {
    const r = psqlExec(
      bundleDir,
      `select 1 from information_schema.tables where table_schema='auth' and table_name='users';`,
    );
    if (r.code === 0 && r.stdout.trim() === '1') return true;
    lastErr = r.stderr.trim() || r.stdout.trim();
    await new Promise((res) => setTimeout(res, 2000));
  }
  warn(`Timed out waiting for auth.users. Last psql output: ${lastErr || '(empty)'}`);
  return false;
}


// ---------------------------------------------------------------------------
// GoTrue admin client — used by seedAdmin + addUser
// ---------------------------------------------------------------------------

function kongUrl(): string {
  const port = process.env.KONG_HTTP_PORT || '8000';
  // The browser-facing PUBLIC_URL might be a domain behind a reverse proxy;
  // the CLI runs on the host, so we go straight to the Kong container's
  // host-published port.
  return `http://localhost:${port}`;
}

async function gotrueAdminCreateUser(opts: {
  email: string;
  password: string;
  user_metadata?: Record<string, unknown>;
}): Promise<{ id: string }> {
  const key = process.env.SERVICE_ROLE_KEY;
  if (!key) throw new Error('SERVICE_ROLE_KEY missing from .env');

  const res = await fetch(`${kongUrl()}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: opts.email,
      password: opts.password,
      email_confirm: true,
      user_metadata: opts.user_metadata || {},
    }),
  });

  const body = await res.text();
  let parsed: any;
  try { parsed = JSON.parse(body); } catch { parsed = { raw: body }; }

  if (!res.ok) {
    const msg = parsed?.msg || parsed?.error || parsed?.error_description || body;
    throw new Error(`GoTrue admin createUser failed (${res.status}): ${msg}`);
  }
  return { id: parsed.id };
}

async function gotrueAdminFindUserByEmail(email: string): Promise<{ id: string } | null> {
  // GoTrue's /admin/users endpoint does NOT honour ?email= as a server-side
  // filter — it just paginates the full list. We list and match locally.
  // For a home install with O(family) users a single page is plenty; if a
  // server ever grows past `perPage` we can add pagination then.
  const key = process.env.SERVICE_ROLE_KEY;
  if (!key) throw new Error('SERVICE_ROLE_KEY missing from .env');
  const res = await fetch(`${kongUrl()}/auth/v1/admin/users?per_page=200`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null) as any;
  const users = body?.users || [];
  if (!Array.isArray(users)) return null;
  const wanted = email.toLowerCase();
  const match = users.find((u: any) => (u?.email || '').toLowerCase() === wanted);
  return match ? { id: match.id } : null;
}

// Poll a single service until its Health status is 'healthy' (or, if it
// has no healthcheck, until it's at least 'running'). Compose v2.2.1 lacks
// `--wait` AND rejects `{{.Health}}` in `ps --format`, so we resolve the
// container ID via `compose ps -q` and then read the health/state field
// directly via `docker inspect`, which works back to engine 1.13.
async function waitForService(bundleDir: string, service: string, timeoutSec: number): Promise<boolean> {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    const idR = spawnSync(
      'docker',
      dockerComposeArgs(bundleDir, ['ps', '-q', service]),
      { encoding: 'utf8' },
    );
    const containerId = (idR.stdout || '').trim().split('\n')[0];
    if (containerId) {
      const inspectR = spawnSync(
        'docker',
        [
          'inspect',
          '--format',
          '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}',
          containerId,
        ],
        { encoding: 'utf8' },
      );
      const status = (inspectR.stdout || '').trim();
      if (status === 'healthy' || status === 'running') return true;
    }
    await new Promise((res) => setTimeout(res, 2000));
  }
  return false;
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

function initBundle(bundleDir: string, opts: { force?: boolean }): number {
  const envPath = path.join(bundleDir, '.env');
  const examplePath = path.join(bundleDir, '.env.example');

  if (fs.existsSync(envPath) && !opts.force) {
    warn(`${envPath} already exists. Use --force to overwrite (destroys existing secrets).`);
    return 1;
  }
  if (!fs.existsSync(examplePath)) {
    error(`Bundle template missing: ${examplePath}`);
    return 1;
  }

  const jwtSecret = randomAlnum(48);
  const now = Math.floor(Date.now() / 1000);
  const tenYears = now + 60 * 60 * 24 * 365 * 10;

  const anonKey = signJwt({ role: 'anon', iss: 'supabase', iat: now, exp: tenYears }, jwtSecret);
  const serviceRoleKey = signJwt({ role: 'service_role', iss: 'supabase', iat: now, exp: tenYears }, jwtSecret);
  const postgresPassword = randomAlnum(32);
  const realtimeEncKey = randomAlnum(16);
  const realtimeSecretKeyBase = randomAlnum(64);

  let env = fs.readFileSync(examplePath, 'utf8');
  const replacements: Array<[RegExp, string]> = [
    [/^POSTGRES_PASSWORD=.*$/m, `POSTGRES_PASSWORD=${postgresPassword}`],
    [/^JWT_SECRET=.*$/m, `JWT_SECRET=${jwtSecret}`],
    [/^ANON_KEY=.*$/m, `ANON_KEY=${anonKey}`],
    [/^SERVICE_ROLE_KEY=.*$/m, `SERVICE_ROLE_KEY=${serviceRoleKey}`],
    [/^REALTIME_ENC_KEY=.*$/m, `REALTIME_ENC_KEY=${realtimeEncKey}`],
    [/^REALTIME_SECRET_KEY_BASE=.*$/m, `REALTIME_SECRET_KEY_BASE=${realtimeSecretKeyBase}`],
  ];
  for (const [re, val] of replacements) env = env.replace(re, val);

  fs.writeFileSync(envPath, env, { mode: 0o600 });
  success(`Wrote ${envPath} with fresh secrets (chmod 600).`);
  info('');
  info(`Next: ${c.bold('dashterm homehub up')}`);
  info('  - Pulls images on first run (several GB; takes a few minutes)');
  info('  - Brings up Postgres + auth + REST + Realtime + Storage + Kong + compile + web');
  info('  - First-run schema apply happens automatically via the Postgres init hook');
  return 0;
}

// ---------------------------------------------------------------------------
// up
// ---------------------------------------------------------------------------

async function up(bundleDir: string, opts: { dev?: boolean; skipMigrate?: boolean }): Promise<number> {
  if (!fs.existsSync(path.join(bundleDir, '.env'))) {
    error(`No .env in ${bundleDir}. Run "dashterm homehub init" first.`);
    return 1;
  }
  if (!dockerAvailable()) {
    error('docker daemon is not reachable. Start Docker Desktop / dockerd and retry.');
    return 1;
  }
  loadEnvFile(bundleDir);

  // up -d (no --wait — that flag is Compose v2.6+; we hand-roll the wait below
  // so older Docker installs work too).
  const args = ['up', '-d'];
  if (opts.dev) args.unshift('--profile', 'dev');
  const code = runDockerCompose(bundleDir, args);
  if (code !== 0) {
    error('docker compose up failed. Try "dashterm homehub logs" for details.');
    return code;
  }

  info('Waiting for postgres to become healthy...');
  if (!(await waitForService(bundleDir, 'postgres', 60))) {
    error('postgres did not become healthy within 60s. See: dashterm homehub logs postgres');
    return 1;
  }

  if (!opts.skipMigrate) {
    info('Waiting for auth schema to bootstrap (gotrue first-boot migrations)...');
    if (!(await waitForAuthSchema(bundleDir, 60))) {
      warn('auth.users not yet visible; skipping automatic migrate. Run "dashterm homehub migrate" once auth is up.');
    } else {
      // 002 creates the supabase_realtime publication itself (Realtime
      // expects it to be there and reads from it but doesn't create it),
      // so we don't need to wait for Realtime to bootstrap.
      info('Applying SQL migrations...');
      const migrateCode = migrate(bundleDir);
      if (migrateCode !== 0) {
        error('Migrations failed. Stack is up but the schema is incomplete.');
        return migrateCode;
      }

      // Seed the admin account if it isn't there yet. Idempotent: the seed
      // check uses GoTrue's admin search-by-email; if the user exists we
      // skip silently.
      await seedAdmin(bundleDir);

      // Seed the Realtime tenant row. supabase/realtime is multi-tenant
      // even with SEED_SELF_HOST=true (the flag controls cluster mode, not
      // tenant bootstrap), so without this every Realtime WebSocket from
      // the dashboard returns 403 TenantNotFound. Idempotent (ON CONFLICT).
      seedRealtimeTenant(bundleDir);
    }
  }

  success('DashTerm homehub is up.');
  info(`  Web      → http://localhost:${process.env.WEB_PORT || '8082'}`);
  info(`  API      → ${process.env.PUBLIC_URL || 'http://localhost:8000'}`);
  if (opts.dev) info(`  Studio   → http://localhost:${process.env.STUDIO_PORT || '3001'}`);
  info(`  Compile  → http://localhost:${process.env.COMPILE_PORT || '8089'}`);
  return 0;
}

// ---------------------------------------------------------------------------
// seed-admin — create the operator's admin account on first run.
//
// Default credentials are admin@localhost / changeme + `must_reset_password`
// in user_metadata. The dashboard's force-reset screen gates everything else
// until the password is rotated.
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = 'admin@localhost';
const ADMIN_DEFAULT_PASSWORD = 'changeme';

async function seedAdmin(bundleDir: string): Promise<void> {
  loadEnvFile(bundleDir);
  try {
    const existing = await gotrueAdminFindUserByEmail(ADMIN_EMAIL);
    if (existing) {
      // Already seeded — nothing to do.
      return;
    }
    info('Seeding admin account...');
    const { id } = await gotrueAdminCreateUser({
      email: ADMIN_EMAIL,
      password: ADMIN_DEFAULT_PASSWORD,
      user_metadata: { must_reset_password: true, full_name: 'Admin' },
    });
    // Promote the matching profile row (created by the on_auth_user_created
    // trigger in 003) to admin.
    const promote = psqlExec(
      bundleDir,
      `update public.profiles set is_admin = true where id = '${id.replace(/'/g, "''")}';`,
    );
    if (promote.code !== 0) {
      warn('Created admin user but failed to set is_admin=true on profile; you may need to run `update public.profiles set is_admin=true where email=\'admin@localhost\';` manually.');
    } else {
      success(`Seeded admin: ${ADMIN_EMAIL} / ${ADMIN_DEFAULT_PASSWORD}`);
      info(`  ↑ The dashboard will force-reset the password on first sign-in.`);
    }
  } catch (e: any) {
    warn(`seed-admin failed: ${e?.message || e}. Re-run \`dashterm homehub up\` to retry.`);
  }
}

// ---------------------------------------------------------------------------
// seed-realtime-tenant — supabase/realtime requires a row in _realtime.tenants
// keyed by external_id (which the Realtime service derives from APP_NAME or
// the request host). Without it, every WebSocket connect is rejected with
// "TenantNotFound" → 403, and the dashboard logs spam the console even though
// auth + REST work fine. SEED_SELF_HOST in the compose file is required but
// doesn't actually create this row; we have to insert it ourselves.
//
// Idempotent: ON CONFLICT (external_id) DO NOTHING so re-running `up` is safe.
// ---------------------------------------------------------------------------

function seedRealtimeTenant(bundleDir: string): void {
  loadEnvFile(bundleDir);
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    warn('seed-realtime-tenant: JWT_SECRET missing from .env; skipping.');
    return;
  }
  // Generate a stable UUID per install from the JWT_SECRET so reruns are
  // idempotent without us having to read the existing row first. The actual
  // id value doesn't matter — Realtime keys by external_id, not by id.
  const tenantId = uuidV5FromString(`dashterm-realtime-${jwtSecret.slice(0, 16)}`);
  const escapedSecret = jwtSecret.replace(/'/g, "''");
  const sql = `
    insert into _realtime.tenants
      (id, name, external_id, jwt_secret, max_concurrent_users, inserted_at, updated_at, postgres_cdc_default)
    values
      ('${tenantId}', 'realtime', 'realtime', '${escapedSecret}', 200, now(), now(), 'postgres_cdc_rls')
    on conflict (external_id) do nothing;

    insert into _realtime.extensions
      (id, type, settings, tenant_external_id, inserted_at, updated_at)
    values
      (gen_random_uuid(), 'postgres_cdc_rls',
       jsonb_build_object(
         'db_host', 'postgres',
         'db_port', 5432,
         'db_name', '${(process.env.POSTGRES_DB || 'dashterm').replace(/'/g, "''")}',
         'db_user', 'supabase_admin',
         'db_password', '${(process.env.POSTGRES_PASSWORD || '').replace(/'/g, "''")}',
         'region', 'us-east-1',
         'poll_interval_ms', 100,
         'poll_max_record_bytes', 1048576,
         'ssl_enforced', false,
         'publication', 'supabase_realtime',
         'slot_name', 'supabase_realtime_replication_slot'
       ),
       'realtime', now(), now())
    on conflict do nothing;
  `;
  const r = psqlExec(bundleDir, sql);
  if (r.code === 0) {
    info('✓ Realtime tenant seeded.');
  } else {
    warn(`seed-realtime-tenant: psql exit ${r.code}: ${r.stderr.trim() || r.stdout.trim()}`);
  }
}

// Minimal deterministic UUID-v5-ish: takes a string, returns a stable
// UUID-shaped string. We only need uniqueness + stability across reruns,
// not strict RFC compliance — _realtime.tenants.id is a uuid column but
// not foreign-keyed by uuid semantics anywhere.
function uuidV5FromString(s: string): string {
  // Cheap hex digest from the string (FNV-1a 32-bit, repeated to 32 hex chars).
  let h = 2166136261;
  const out: string[] = [];
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < s.length; j++) {
      h ^= s.charCodeAt(j) + i;
      h = (h * 16777619) >>> 0;
    }
    out.push(h.toString(16).padStart(8, '0'));
  }
  const hex = out.join('').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// ---------------------------------------------------------------------------
// add-user — invite a new user. The operator runs this on the host; family
// members then sign in via the web dashboard.
// ---------------------------------------------------------------------------

async function addUser(bundleDir: string, email: string, password?: string): Promise<number> {
  loadEnvFile(bundleDir);
  if (!email || !email.includes('@')) {
    error(`Invalid email: ${email}`);
    return 1;
  }
  const pwd = password || randomAlnum(12);
  try {
    const existing = await gotrueAdminFindUserByEmail(email);
    if (existing) {
      error(`A user with email ${email} already exists.`);
      return 1;
    }
    await gotrueAdminCreateUser({
      email,
      password: pwd,
      user_metadata: { full_name: email.split('@')[0] },
    });
    success(`Created ${email}`);
    if (!password) {
      info(`  password: ${c.bold(pwd)}`);
      info(c.gray('  ↑ Shown only once — copy it now.'));
    }
    return 0;
  } catch (e: any) {
    error(`Failed to create user: ${e?.message || e}`);
    return 1;
  }
}

// ---------------------------------------------------------------------------
// down / logs / status
// ---------------------------------------------------------------------------

function down(bundleDir: string): number {
  return runDockerCompose(bundleDir, ['down']);
}

function logs(bundleDir: string, services: string[]): number {
  return runDockerCompose(bundleDir, ['logs', '-f', ...services]);
}

function status(bundleDir: string): number {
  return runDockerCompose(bundleDir, ['ps']);
}

// ---------------------------------------------------------------------------
// migrate — apply every SQL file in migrations/ that hasn't been recorded.
//
// We use a tiny ledger table public.schema_migrations(version text primary key).
// 001_init.sql is implicitly applied via /docker-entrypoint-initdb.d on first
// run; we still record it after-the-fact so the ledger stays consistent.
// ---------------------------------------------------------------------------

function migrate(bundleDir: string): number {
  const migrationsDir = path.join(bundleDir, 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    error(`No migrations directory at ${migrationsDir}.`);
    return 1;
  }
  loadEnvFile(bundleDir);
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  if (files.length === 0) {
    info('No migrations to apply.');
    return 0;
  }

  // Ledger table — tracks which versions have applied. Using -A -t output mode
  // (via psqlExec) means the parsed output is just bare values, one per line.
  const setup = psqlExec(
    bundleDir,
    `create table if not exists public.schema_migrations (version text primary key, applied_at timestamptz not null default now());`,
  );
  if (setup.code !== 0) {
    error('Could not create schema_migrations table. Is the homehub running?');
    if (setup.stderr) info(setup.stderr.trim());
    return setup.code;
  }

  const appliedRes = psqlExec(bundleDir, `select version from public.schema_migrations order by version;`);
  const applied = new Set(
    appliedRes.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0),
  );

  let appliedCount = 0;
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;
    info(`Applying ${file}...`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const r = psqlExec(bundleDir, sql);
    if (r.code !== 0) {
      error(`Migration ${file} failed:`);
      if (r.stderr) info(r.stderr.trim());
      return r.code;
    }
    // Quote-escape the version (filenames are safe but be defensive anyway).
    const safeVersion = version.replace(/'/g, "''");
    const ledger = psqlExec(
      bundleDir,
      `insert into public.schema_migrations (version) values ('${safeVersion}') on conflict do nothing;`,
    );
    if (ledger.code !== 0) {
      warn(`Migration ${file} applied but ledger update failed. You may see it re-applied next run.`);
    }
    appliedCount++;
  }

  if (appliedCount === 0) {
    info('Schema already up to date.');
  } else {
    success(`Applied ${appliedCount} migration${appliedCount === 1 ? '' : 's'}.`);
    // PostgREST caches the schema at startup; without this NOTIFY, new tables
    // remain invisible (400/404) until the rest container is restarted.
    // PostgREST 12+ listens on the "pgrst" channel.
    const reload = psqlExec(bundleDir, `notify pgrst, 'reload schema';`);
    if (reload.code !== 0) {
      warn('Migrations applied but PostgREST schema-cache reload notify failed; you may need to `docker compose restart rest`.');
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Help + dispatch
// ---------------------------------------------------------------------------

function homehubHelp(): number {
  info(`${c.bold('dashterm homehub')} — self-hostable backend bundle`);
  info('');
  info(c.bold('Commands:'));
  info('  init [--force]       generate .env with random secrets');
  info('  up   [--dev]         docker compose up -d (--dev also brings up Studio)');
  info('  down                 docker compose down (data volumes persist)');
  info('  logs [SERVICE...]    tail logs (default: all services)');
  info('  status               docker compose ps');
  info('  migrate              apply any unrun SQL files in migrations/');
  info('  add-user EMAIL [PW]  create a user account (random pw printed if omitted)');
  info('');
  info(c.gray('Override bundle location with DASHTERM_HOMEHUB_DIR.'));
  return 0;
}

export async function homehubCommand(args: string[]): Promise<number> {
  const sub = (args[0] || '').toLowerCase();
  const rest = args.slice(1);

  if (!sub || sub === 'help' || sub === '-h' || sub === '--help') {
    return homehubHelp();
  }

  const bundleDir = findBundleDir();
  if (!bundleDir) {
    error(
      'Cannot find services/homehub/. Run from the monorepo, or set ' +
        'DASHTERM_HOMEHUB_DIR to the bundle directory.',
    );
    return 1;
  }

  switch (sub) {
    case 'init':
      return initBundle(bundleDir, { force: rest.includes('--force') });
    case 'up':
      return up(bundleDir, {
        dev: rest.includes('--dev'),
        skipMigrate: rest.includes('--skip-migrate'),
      });
    case 'down':
    case 'stop':
      return down(bundleDir);
    case 'logs':
      return logs(bundleDir, rest.filter((a) => !a.startsWith('-')));
    case 'status':
    case 'ps':
      return status(bundleDir);
    case 'add-user':
      return addUser(bundleDir, rest[0] || '', rest[1]);
    case 'migrate':
      return migrate(bundleDir);
    default:
      error(`Unknown homehub subcommand: ${sub}`);
      homehubHelp();
      return 1;
  }
}
