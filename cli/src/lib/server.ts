/**
 * Loads the built gateway server modules (packages/server/dist) into the CLI
 * process so read-only / self-test commands can run against the SAME sqlite +
 * config the gateway uses — no HTTP, no auth cookie. This is deliberate: the
 * operator running the CLI already owns the box, and app backends dispatch
 * owner-only, so running them in-process grants nothing new (same trust model
 * as backendContext.ts). `dashterm provider` uses an equivalent loader; this
 * one exposes the wider surface the discovery + `app invoke` commands need.
 */
import path from 'node:path';

export interface UserRow {
  id: string;
  email: string;
  display_name: string;
  is_admin: number;
}

export interface AppRow {
  id: string;
  name: string;
  owner_id: string;
  owner_name: string;
  backend_compiled: string | null;
  version: number;
}

export interface VarEntry {
  name: string;
  value: string;
  createdAt: number;
  updatedAt: number;
}
export interface SecretEntry {
  name: string;
  createdAt: number;
  updatedAt: number;
}
export interface HostEntry {
  alias: string;
  host: string;
  port: number;
  user: string | null;
}

export interface DispatchArgs {
  config: unknown;
  shareCode: string;
  method: string;
  subpath: string;
  query: Record<string, unknown>;
  body: unknown;
  headers: Record<string, unknown>;
}

export interface ServerApi {
  config: { dataDir: string; [k: string]: unknown };
  getDb: () => any;
  listVars: (uid: string) => VarEntry[];
  listSecretNames: (uid: string) => SecretEntry[];
  listHosts: (config: unknown, uid: string) => HostEntry[];
  loadBackend: (a: { shareCode: string; ownerId: string; compiled: string; version: number }) => {
    ok: boolean;
    routeCount?: number;
    error?: string;
  };
  dispatch: (a: DispatchArgs) => Promise<{ status: number; body: unknown } | null>;
  resolveProvider: (appId: string | undefined) => { name: string; kind: string; default_model: string };
  users: () => UserRow[];
  app: (idOrName: string) => AppRow | undefined;
  apps: () => Array<AppRow & { updated_at: number }>;
}

function tryRequire(p: string): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(p);
  } catch {
    return null;
  }
}

function distRoots(): string[] {
  const monorepoRoot = path.resolve(__dirname, '../../..');
  return [
    path.join(monorepoRoot, 'packages/server/dist'),
    path.join(__dirname, '../../../server/dist'),
  ];
}

/**
 * Lightweight config-only loader for commands that just need the gateway's
 * resolved config + reachable URL (e.g. `dashterm qr`), without opening the DB
 * or loading the full backend surface.
 */
export function loadGatewayConfig(): { config: { bind: string; port: number; publicUrl: string | null; [k: string]: unknown }; reachableUrl: string } {
  for (const r of distRoots()) {
    const configMod = tryRequire(path.join(r, 'config.js'));
    if (configMod?.loadConfig && configMod?.reachableUrl) {
      const config = configMod.loadConfig();
      return { config, reachableUrl: configMod.reachableUrl(config) };
    }
  }
  throw new Error(
    'Server build not found. Run `npm install` at the repo root (or `npm run build` in packages/server/).',
  );
}

export function loadServerApi(): ServerApi {
  let root: string | null = null;
  let configMod: any = null;
  let dbMod: any = null;
  for (const r of distRoots()) {
    const config = tryRequire(path.join(r, 'config.js'));
    const db = tryRequire(path.join(r, 'db.js'));
    if (config?.loadConfig && db?.openDb && db?.getDb) {
      root = r;
      configMod = config;
      dbMod = db;
      break;
    }
  }
  if (!root) {
    throw new Error(
      'Server build not found. Run `npm install` at the repo root (or `npm run build` in packages/server/).',
    );
  }
  const req = (rel: string) => tryRequire(path.join(root as string, rel)) ?? {};
  const vars = req('vars/registry.js');
  const secrets = req('secrets/registry.js');
  const ssh = req('agent/sshHosts.js');
  const backend = req('agent/backendRegistry.js');
  const registry = req('ai/registry.js');

  const config = configMod.loadConfig();
  dbMod.openDb(config.dataDir);
  const getDb = dbMod.getDb as () => any;

  const appCols = 'id, name, owner_id, owner_name, backend_compiled, version';

  return {
    config,
    getDb,
    listVars: vars.listVars,
    listSecretNames: secrets.listSecretNames,
    listHosts: ssh.listHosts,
    loadBackend: backend.loadBackend,
    dispatch: backend.dispatch,
    resolveProvider: registry.resolveProvider,
    users: () =>
      getDb()
        .prepare('select id, email, display_name, is_admin from users order by created_at asc')
        .all() as UserRow[],
    apps: () =>
      getDb()
        .prepare(`select ${appCols}, updated_at from apps order by updated_at desc`)
        .all() as Array<AppRow & { updated_at: number }>,
    app: (idOrName: string) => {
      const byId = getDb().prepare(`select ${appCols} from apps where id = ?`).get(idOrName) as
        | AppRow
        | undefined;
      if (byId) return byId;
      const byName = getDb()
        .prepare(`select ${appCols} from apps where lower(name) = lower(?)`)
        .all(idOrName) as AppRow[];
      if (byName.length === 1) return byName[0];
      if (byName.length > 1) {
        throw new Error(
          `"${idOrName}" matches ${byName.length} apps by name — use the share code (dashterm app list) instead`,
        );
      }
      return undefined;
    },
  };
}

/** Pick the user whose per-user vars/secrets/hosts to read. Single-user homelab
 *  needs no flag; multi-user requires `--user <email>` to disambiguate. */
export function resolveUser(api: ServerApi, emailOrId?: string): UserRow {
  const users = api.users();
  if (users.length === 0) {
    throw new Error('No users exist yet. Run `dashterm onboard` first.');
  }
  if (emailOrId) {
    const u = users.find(
      (x) => x.email.toLowerCase() === emailOrId.toLowerCase() || x.id === emailOrId,
    );
    if (!u) throw new Error(`No user matching "${emailOrId}". Known: ${users.map((x) => x.email).join(', ')}`);
    return u;
  }
  if (users.length === 1) return users[0];
  throw new Error(`Multiple users — pass --user <email>. Known: ${users.map((x) => x.email).join(', ')}`);
}
