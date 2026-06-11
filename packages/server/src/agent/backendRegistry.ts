/**
 * In-memory registry of agent-authored backends. Fastify can't add/remove
 * routes after listen, so instead of mounting one route per app we keep a
 * single catch-all (routes/appBackends.ts) that dispatches into this map.
 *
 * loadBackend evaluates the compiled CJS once to collect the app's route table;
 * dispatch runs the matching handler per request with a fresh, owner-scoped
 * `ctx`. On boot, reloadAllFromDb rehydrates every app that has a backend.
 */
import { getDb } from '../db';
import type { GatewayConfig } from '../config';
import { buildBackendCtx } from './backendContext';

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'ALL';

interface BackendRoute {
  method: Method;
  segments: string[]; // normalized path split on '/', supports ':param' and trailing '*'
  handler: (req: BackendRequest, ctx: ReturnType<typeof buildBackendCtx>) => unknown;
}

interface LoadedBackend {
  ownerId: string;
  version: number;
  routes: BackendRoute[];
}

export interface BackendRequest {
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, unknown>;
  body: unknown;
  headers: Record<string, unknown>;
}

export interface DispatchResult {
  status: number;
  body: unknown;
}

const registry = new Map<string, LoadedBackend>();

const HANDLER_TIMEOUT_MS = 30_000;

// Node builtins a backend may require(). Real capabilities (process spawning,
// network, fs) are intentionally absent — those go through ctx so they stay
// owner-scoped and auditable. left-pad-style npm deps aren't bundled, so a
// require for one lands here and is rejected.
const REQUIRE_ALLOWLIST = new Set([
  'crypto', 'util', 'path', 'url', 'querystring', 'buffer',
  'events', 'stream', 'string_decoder', 'zlib', 'os', 'assert',
]);

function guardedRequire(name: string): unknown {
  const bare = name.replace(/^node:/, '');
  if (REQUIRE_ALLOWLIST.has(bare)) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(bare);
  }
  throw new Error(
    `require('${name}') is not allowed in app backends — use the injected ctx ` +
    `(ctx.ssh/ctx.exec/ctx.fetch/ctx.secrets/ctx.ai) for capabilities`,
  );
}

function normalizeSegments(p: string): string[] {
  return String(p || '/').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
}

/** Evaluate compiled CJS → the register(router) fn → collected route table. */
function collectRoutes(compiled: string): BackendRoute[] {
  const moduleObj: { exports: any } = { exports: {} };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function('module', 'exports', 'require', 'console', compiled);
  fn(moduleObj, moduleObj.exports, guardedRequire, console);
  const register = (moduleObj.exports && moduleObj.exports.default) || moduleObj.exports;
  if (typeof register !== 'function') {
    throw new Error('backend must `export default function register(router) { ... }`');
  }
  const routes: BackendRoute[] = [];
  const add = (method: Method) => (path: string, handler: BackendRoute['handler']) => {
    if (typeof handler !== 'function') throw new Error(`handler for ${method} ${path} is not a function`);
    routes.push({ method, segments: normalizeSegments(path), handler });
    return router;
  };
  const router = {
    get: add('GET'),
    post: add('POST'),
    put: add('PUT'),
    delete: add('DELETE'),
    patch: add('PATCH'),
    all: add('ALL'),
  };
  register(router);
  return routes;
}

/** Load (or replace) a backend in the registry. Returns route count on success. */
export function loadBackend(args: {
  shareCode: string;
  ownerId: string;
  compiled: string;
  version: number;
}): { ok: boolean; routeCount?: number; error?: string } {
  try {
    const routes = collectRoutes(args.compiled);
    registry.set(args.shareCode, { ownerId: args.ownerId, version: args.version, routes });
    return { ok: true, routeCount: routes.length };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export function unloadBackend(shareCode: string): void {
  registry.delete(shareCode);
}

export function getBackendOwner(shareCode: string): string | null {
  return registry.get(shareCode)?.ownerId ?? null;
}

export function hasBackend(shareCode: string): boolean {
  return registry.has(shareCode);
}

function matchRoute(routes: BackendRoute[], method: string, segs: string[]): { route: BackendRoute; params: Record<string, string> } | null {
  const m = method.toUpperCase();
  for (const route of routes) {
    if (route.method !== 'ALL' && route.method !== m) continue;
    const params: Record<string, string> = {};
    const rs = route.segments;
    let ok = true;
    for (let i = 0; i < rs.length; i++) {
      const seg = rs[i];
      if (seg === '*') {
        params['*'] = segs.slice(i).join('/');
        return { route, params };
      }
      if (i >= segs.length) { ok = false; break; }
      if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(segs[i]);
      else if (seg !== segs[i]) { ok = false; break; }
    }
    if (ok && rs[rs.length - 1] !== '*' && segs.length !== rs.length) ok = false;
    if (ok) return { route, params };
  }
  return null;
}

/**
 * Run the handler matching (method, subpath) for an app's backend. Returns null
 * when the app has no backend at all (→ caller sends 404). Throws on no route
 * match (→ caller sends 404) and on handler error (→ caller sends 500).
 */
export async function dispatch(args: {
  config: GatewayConfig;
  shareCode: string;
  method: string;
  subpath: string;
  query: Record<string, unknown>;
  body: unknown;
  headers: Record<string, unknown>;
}): Promise<DispatchResult | null> {
  const loaded = registry.get(args.shareCode);
  if (!loaded) return null;

  const segs = normalizeSegments(args.subpath);
  const matched = matchRoute(loaded.routes, args.method, segs);
  if (!matched) return { status: 404, body: { error: `no backend route for ${args.method} /${segs.join('/')}` } };

  const ctx = buildBackendCtx(args.config, loaded.ownerId, args.shareCode);
  const req: BackendRequest = {
    method: args.method.toUpperCase(),
    path: '/' + segs.join('/'),
    params: matched.params,
    query: args.query,
    body: args.body,
    headers: args.headers,
  };

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('backend handler timed out')), HANDLER_TIMEOUT_MS);
  });
  try {
    const value = await Promise.race([Promise.resolve(matched.route.handler(req, ctx)), timeout]);
    return { status: 200, body: value === undefined ? null : value };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** On boot, rehydrate every app that carries a compiled backend. */
export function reloadAllFromDb(): { loaded: number; failed: number } {
  let loaded = 0;
  let failed = 0;
  const rows = getDb()
    .prepare<[], { id: string; owner_id: string; backend_compiled: string | null; version: number }>(
      'select id, owner_id, backend_compiled, version from apps where backend_compiled is not null',
    )
    .all();
  for (const r of rows) {
    if (!r.backend_compiled) continue;
    const res = loadBackend({ shareCode: r.id, ownerId: r.owner_id, compiled: r.backend_compiled, version: r.version });
    if (res.ok) loaded++;
    else {
      failed++;
      console.warn(`[backend] failed to load ${r.id}: ${res.error}`);
    }
  }
  return { loaded, failed };
}
