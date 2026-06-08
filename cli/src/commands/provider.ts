/**
 * `dashterm provider <add|list|remove|set-default|bind|unbind>` —
 * manage the AI provider registry directly against the sqlite file.
 *
 * Subcommands:
 *   add NAME --kind <anthropic|openai|gemini|ollama> --model MODEL
 *       [--api-key KEY] [--base-url URL] [--default]
 *   list
 *   remove NAME
 *   set-default NAME
 *   bind APP_ID PROVIDER_NAME      e.g. ai claude-haiku
 *   unbind APP_ID
 *   binding APP_ID                 print the resolved provider for an app
 *
 * NAME is the friendly handle, not the uuid. The CLI looks up the row by
 * name; the dashboard's settings UI uses uuids over the wire.
 */

import { homedir } from 'node:os';
import path from 'node:path';
import { c, error, info, success, warn } from '../lib/log';

interface ServerModule {
  openDb: (dataDir: string) => unknown;
  registry: {
    listProviders: () => ProviderRow[];
    getProviderByName: (name: string) => ProviderRow | undefined;
    addProvider: (input: AddProviderInput) => ProviderRow;
    removeProvider: (id: string) => boolean;
    setDefaultProvider: (id: string) => boolean;
    bindApp: (appId: string, providerId: string) => void;
    unbindApp: (appId: string) => boolean;
    getBinding: (appId: string) => { providerId: string } | undefined;
    resolveProvider: (appId: string | undefined) => ProviderRow;
  };
}

interface ProviderRow {
  id: string;
  name: string;
  kind: string;
  default_model: string;
  api_key: string | null;
  base_url: string | null;
  is_default: number;
  created_at: number;
}

interface AddProviderInput {
  name: string;
  kind: 'anthropic' | 'openai' | 'gemini' | 'ollama';
  defaultModel: string;
  apiKey?: string | null;
  baseUrl?: string | null;
  asDefault?: boolean;
}

function loadServer(): ServerModule | null {
  const tryRequire = (p: string) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require(p);
    } catch {
      return null;
    }
  };
  const monorepoRoot = path.resolve(__dirname, '../../..');
  const candidates = [
    path.join(monorepoRoot, 'packages/server/dist'),
    path.join(__dirname, '../../../server/dist'),
  ];
  for (const root of candidates) {
    const db = tryRequire(path.join(root, 'db.js')) as { openDb?: (d: string) => unknown } | null;
    const reg = tryRequire(path.join(root, 'ai/registry.js')) as ServerModule['registry'] | null;
    if (db?.openDb && reg?.listProviders) {
      return { openDb: db.openDb, registry: reg };
    }
  }
  return null;
}

function dataDir(): string {
  return process.env.DASHTERM_DATA_DIR || path.join(homedir(), '.dashterm');
}

function withServer(): ServerModule {
  const mod = loadServer();
  if (!mod) {
    error('Server module not found. Run `npm install` + `npm run build` in packages/server/.');
    process.exit(2);
  }
  mod.openDb(dataDir());
  return mod;
}

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string | true> } {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function fmtTimestamp(ms: number): string {
  if (!ms) return '—';
  return new Date(ms).toISOString().slice(0, 16);
}

function addCommand(args: string[]): number {
  const { positional, flags } = parseFlags(args);
  const name = positional[0];
  if (!name) {
    error('Usage: dashterm provider add <name> --kind <…> --model <…> [--api-key KEY] [--base-url URL] [--default]');
    return 1;
  }
  const kind = flags.kind as string | undefined;
  const model = (flags.model || flags['default-model']) as string | undefined;
  if (!kind || !['anthropic', 'openai', 'gemini', 'ollama'].includes(kind)) {
    error('--kind must be one of: anthropic | openai | gemini | ollama');
    return 1;
  }
  if (!model) {
    error('--model is required (e.g. claude-haiku-4-5, gpt-4o-mini, gemini-3-flash-preview, llama3.2)');
    return 1;
  }
  const { registry } = withServer();
  if (registry.getProviderByName(name)) {
    error(`A provider named "${name}" already exists. Remove or rename it first.`);
    return 1;
  }
  const apiKey = (flags['api-key'] as string | undefined) ?? null;
  const baseUrl = (flags['base-url'] as string | undefined) ?? null;
  const asDefault = !!flags.default;
  if (kind !== 'ollama' && !apiKey) {
    warn(`No --api-key given. Provider "${name}" can be added now and the key set later (delete + re-add).`);
  }
  const row = registry.addProvider({
    name,
    kind: kind as AddProviderInput['kind'],
    defaultModel: model,
    apiKey,
    baseUrl,
    asDefault,
  });
  success(`Added provider ${c.bold(row.name)} (${row.kind}, model ${row.default_model})${asDefault ? ' — set as default' : ''}`);
  return 0;
}

function listCommand(): number {
  const { registry } = withServer();
  const rows = registry.listProviders();
  if (rows.length === 0) {
    info('No providers configured yet.');
    info(c.gray('Try: dashterm provider add my-claude --kind anthropic --model claude-haiku-4-5 --api-key sk-… --default'));
    return 0;
  }
  const nameW = Math.max(...rows.map((r) => r.name.length), 4);
  const kindW = Math.max(...rows.map((r) => r.kind.length), 4);
  const modelW = Math.max(...rows.map((r) => r.default_model.length), 5);
  info(
    c.bold(
      'NAME'.padEnd(nameW + 2) +
        'KIND'.padEnd(kindW + 2) +
        'MODEL'.padEnd(modelW + 2) +
        'KEY  DEFAULT  CREATED',
    ),
  );
  for (const r of rows) {
    info(
      r.name.padEnd(nameW + 2) +
        r.kind.padEnd(kindW + 2) +
        r.default_model.padEnd(modelW + 2) +
        (r.api_key ? 'yes' : 'no ').padEnd(5) +
        (r.is_default ? 'yes' : 'no ').padEnd(9) +
        fmtTimestamp(r.created_at),
    );
  }
  return 0;
}

function removeCommand(args: string[]): number {
  const name = args[0];
  if (!name) {
    error('Usage: dashterm provider remove <name>');
    return 1;
  }
  const { registry } = withServer();
  const row = registry.getProviderByName(name);
  if (!row) {
    error(`No such provider: ${name}`);
    return 1;
  }
  if (registry.removeProvider(row.id)) {
    success(`Removed ${name}`);
    return 0;
  }
  error('Remove failed');
  return 1;
}

function setDefaultCommand(args: string[]): number {
  const name = args[0];
  if (!name) {
    error('Usage: dashterm provider set-default <name>');
    return 1;
  }
  const { registry } = withServer();
  const row = registry.getProviderByName(name);
  if (!row) {
    error(`No such provider: ${name}`);
    return 1;
  }
  if (registry.setDefaultProvider(row.id)) {
    success(`${name} is now the default provider`);
    return 0;
  }
  error('Set-default failed');
  return 1;
}

function bindCommand(args: string[]): number {
  const [appId, providerName] = args;
  if (!appId || !providerName) {
    error('Usage: dashterm provider bind <appId> <providerName>');
    return 1;
  }
  const { registry } = withServer();
  const row = registry.getProviderByName(providerName);
  if (!row) {
    error(`No such provider: ${providerName}`);
    return 1;
  }
  registry.bindApp(appId, row.id);
  success(`${appId} → ${providerName}`);
  return 0;
}

function unbindCommand(args: string[]): number {
  const appId = args[0];
  if (!appId) {
    error('Usage: dashterm provider unbind <appId>');
    return 1;
  }
  const { registry } = withServer();
  if (registry.unbindApp(appId)) {
    success(`Unbound ${appId}`);
    return 0;
  }
  info(`No binding for ${appId} (already unbound).`);
  return 0;
}

function bindingCommand(args: string[]): number {
  const appId = args[0];
  const { registry } = withServer();
  try {
    const row = registry.resolveProvider(appId);
    if (appId) {
      const explicit = registry.getBinding(appId);
      const via = explicit ? 'explicit binding' : 'default provider';
      info(`${appId || '(no app id)'} resolves via ${c.bold(via)} → ${c.bold(row.name)} (${row.kind} / ${row.default_model})`);
    } else {
      info(`default provider: ${c.bold(row.name)} (${row.kind} / ${row.default_model})`);
    }
    return 0;
  } catch (e) {
    error(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

export async function providerCommand(args: string[]): Promise<number> {
  const sub = (args[0] || '').toLowerCase();
  const rest = args.slice(1);
  switch (sub) {
    case 'add':
      return addCommand(rest);
    case 'list':
    case 'ls':
      return listCommand();
    case 'remove':
    case 'rm':
      return removeCommand(rest);
    case 'set-default':
    case 'default':
      return setDefaultCommand(rest);
    case 'bind':
      return bindCommand(rest);
    case 'unbind':
      return unbindCommand(rest);
    case 'binding':
    case 'resolve':
      return bindingCommand(rest);
    default:
      info('Usage: dashterm provider <add|list|remove|set-default|bind|unbind|binding>');
      info('');
      info('  add NAME --kind <…> --model <…> [--api-key KEY] [--base-url URL] [--default]');
      info('  list                                  print all configured providers');
      info('  remove NAME                           drop a provider');
      info('  set-default NAME                      mark a provider as the fallback');
      info('  bind APP_ID PROVIDER_NAME             route an app to a specific provider');
      info('  unbind APP_ID                         drop the binding (falls back to default)');
      info('  binding [APP_ID]                      print which provider resolves for an app');
      return sub ? 1 : 0;
  }
}
