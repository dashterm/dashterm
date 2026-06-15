/**
 * `dashterm app <list|invoke>` — inspect and HEADLESSLY exercise vibe-coded
 * apps' backends, so an agent can self-verify the app it just wrote without
 * hand-rolling curl + auth.
 *
 *   dashterm app list
 *   dashterm app invoke <app> [METHOD] <path> [--body JSON] [--query JSON]
 *       e.g. dashterm app invoke K7XM2 POST /chat --body '{"text":"how many shows?"}'
 *
 * `invoke` loads the app's compiled backend from the db and runs the matching
 * route handler through the gateway's real dispatch path, with a genuine
 * owner-scoped ctx (ctx.ai / ctx.ssh / ctx.fetch / ctx.db all live). So a
 * ctx.ai.run app actually drives the configured provider end-to-end — the
 * intended way to confirm native tool-calling works before handing back.
 * <app> is the 5-char share code (preferred) or the app name.
 */
import { c, error, info } from '../lib/log';
import { parseFlags } from '../lib/flags';
import { loadServerApi, type ServerApi } from '../lib/server';

function listApps(): number {
  const api = loadServerApi();
  const rows = api.apps();
  if (!rows.length) {
    info('No apps pushed yet. Push one from the Agentic Coder first.');
    return 0;
  }
  const idW = Math.max(...rows.map((r) => r.id.length), 4);
  const nameW = Math.max(...rows.map((r) => r.name.length), 4);
  info(c.bold('CODE'.padEnd(idW + 2) + 'NAME'.padEnd(nameW + 2) + 'BACKEND  OWNER'));
  for (const r of rows) {
    info(
      r.id.padEnd(idW + 2) +
        r.name.padEnd(nameW + 2) +
        (r.backend_compiled ? 'yes      ' : 'no       ') +
        r.owner_name,
    );
  }
  return 0;
}

function providerNote(api: ServerApi, shareCode: string): string {
  try {
    const p = api.resolveProvider(shareCode);
    return c.gray(` · provider ${p.name} (${p.kind}/${p.default_model})`);
  } catch {
    return c.gray(' · no provider configured');
  }
}

async function invokeApp(args: string[]): Promise<number> {
  const { positional, flags } = parseFlags(args);
  const appRef = positional[0];
  if (!appRef) {
    error("Usage: dashterm app invoke <app> [METHOD] <path> [--body JSON] [--query JSON]");
    return 1;
  }

  // <app> [METHOD] <path>: a positional that begins with '/' is the path
  // (method defaults to GET); otherwise it's the METHOD and the next is path.
  let method = 'GET';
  let subpath = '';
  if (positional[1]?.startsWith('/')) {
    subpath = positional[1];
  } else if (positional[1]) {
    method = positional[1].toUpperCase();
    subpath = positional[2] ?? '/';
  }
  if (!subpath) {
    error("A path is required, e.g. dashterm app invoke myapp POST /chat --body '{\"text\":\"hi\"}'");
    return 1;
  }

  const api = loadServerApi();
  let app;
  try {
    app = api.app(appRef);
  } catch (e) {
    error(e instanceof Error ? e.message : String(e));
    return 1;
  }
  if (!app) {
    error(`No app matching "${appRef}". Try: dashterm app list`);
    return 1;
  }
  if (!app.backend_compiled) {
    error(`App ${c.bold(app.name)} (${app.id}) has no backend — write an apps/${'<slug>'}.server.ts and push it first.`);
    return 1;
  }

  const loaded = api.loadBackend({
    shareCode: app.id,
    ownerId: app.owner_id,
    compiled: app.backend_compiled,
    version: app.version,
  });
  if (!loaded.ok) {
    error(`Backend failed to load: ${loaded.error}`);
    return 1;
  }

  let body: unknown;
  if (typeof flags.body === 'string') {
    try {
      body = JSON.parse(flags.body);
    } catch {
      body = flags.body; // allow a raw string body
    }
  }
  let query: Record<string, unknown> = {};
  if (typeof flags.query === 'string') {
    try {
      query = JSON.parse(flags.query) as Record<string, unknown>;
    } catch {
      error('--query must be a JSON object');
      return 1;
    }
  }

  const cleanPath = '/' + subpath.replace(/^\/+/, '');
  info(
    c.gray(`→ ${method} ${cleanPath} on `) +
      c.bold(`${app.name} (${app.id})`) +
      c.gray(` as ${app.owner_name}`) +
      providerNote(api, app.id),
  );

  const started = Date.now();
  let res;
  try {
    res = await api.dispatch({
      config: api.config,
      shareCode: app.id,
      method,
      subpath,
      query,
      body,
      headers: {},
    });
  } catch (e) {
    error(`Handler threw: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  const ms = Date.now() - started;
  if (!res) {
    error(`App ${app.id} has no loaded backend`);
    return 1;
  }

  const ok = res.status >= 200 && res.status < 300;
  info((ok ? c.green(`HTTP ${res.status}`) : c.red(`HTTP ${res.status}`)) + c.gray(`  (${ms}ms)`));
  // Body to stdout as JSON so it's easy to read/parse from a Bash agent.
  console.log(JSON.stringify(res.body, null, 2));
  return ok ? 0 : 1;
}

export async function appCommand(args: string[]): Promise<number> {
  const sub = (args[0] || '').toLowerCase();
  const rest = args.slice(1);
  switch (sub) {
    case 'list':
    case 'ls':
      return listApps();
    case 'invoke':
    case 'call':
      return invokeApp(rest);
    default:
      info('Usage: dashterm app <list|invoke>');
      info('');
      info('  list                                            pushed apps + their share codes');
      info('  invoke <app> [METHOD] <path> [--body JSON]       run a backend route headlessly (owner ctx, no auth)');
      info('');
      info(c.gray("  e.g. dashterm app invoke K7XM2 POST /chat --body '{\"text\":\"how many shows?\"}'"));
      return sub ? 1 : 0;
  }
}
