/**
 * Read-only discovery commands for the Bash-side agent (and operators):
 *
 *   dashterm vars list      [--user EMAIL]   non-secret config readable as {{var.NAME}}
 *   dashterm secrets list   [--user EMAIL]   secret NAMES only (values never leave the server)
 *   dashterm hosts list     [--user EMAIL]   configured SSH host aliases
 *
 * These let an agent see the user's configured vars / secret names / hosts
 * BEFORE writing app code, instead of spelunking the sqlite by hand. Values of
 * secrets are never printed — only names — mirroring the API's disclosure rule.
 * `--user` is only needed on a multi-user install.
 */
import { c, error, info } from '../lib/log';
import { fmtTimestamp, parseFlags } from '../lib/flags';
import { loadServerApi, resolveUser } from '../lib/server';

function ensureList(sub: string, usage: string): boolean {
  if (sub === '' || sub === 'list' || sub === 'ls') return true;
  error(usage);
  return false;
}

export function varsCommand(args: string[]): number {
  const { positional, flags } = parseFlags(args);
  if (!ensureList((positional[0] || '').toLowerCase(), 'Usage: dashterm vars list [--user EMAIL]')) return 1;
  const api = loadServerApi();
  const user = resolveUser(api, flags.user as string | undefined);
  const rows = api.listVars(user.id);
  if (!rows.length) {
    info(`No variables for ${c.bold(user.email)}.`);
    info(c.gray('Variables are non-secret config (base URLs, hostnames) apps read as {{var.NAME}} / window.dashterm.vars.'));
    return 0;
  }
  const nameW = Math.max(...rows.map((r) => r.name.length), 4);
  info(c.bold('NAME'.padEnd(nameW + 2) + 'VALUE'));
  for (const r of rows) info(r.name.padEnd(nameW + 2) + r.value);
  return 0;
}

export function secretsCommand(args: string[]): number {
  const { positional, flags } = parseFlags(args);
  if (!ensureList((positional[0] || '').toLowerCase(), 'Usage: dashterm secrets list [--user EMAIL]')) return 1;
  const api = loadServerApi();
  const user = resolveUser(api, flags.user as string | undefined);
  const rows = api.listSecretNames(user.id);
  if (!rows.length) {
    info(`No secrets for ${c.bold(user.email)}.`);
    return 0;
  }
  const nameW = Math.max(...rows.map((r) => r.name.length), 4);
  info(c.bold('NAME'.padEnd(nameW + 2) + 'UPDATED'));
  for (const r of rows) info(r.name.padEnd(nameW + 2) + fmtTimestamp(r.updatedAt));
  info('');
  info(c.gray('Names only — secret values never leave the server. Use {{secret.NAME}} in ctx.fetch / window.dashterm.secrets.fetch.'));
  return 0;
}

export function hostsCommand(args: string[]): number {
  const { positional, flags } = parseFlags(args);
  if (!ensureList((positional[0] || '').toLowerCase(), 'Usage: dashterm hosts list [--user EMAIL]')) return 1;
  const api = loadServerApi();
  const user = resolveUser(api, flags.user as string | undefined);
  const rows = api.listHosts(api.config, user.id);
  if (!rows.length) {
    info(`No SSH hosts for ${c.bold(user.email)}.`);
    info(c.gray('Hosts are reachable from app backends via ctx.ssh("<alias>", "cmd").'));
    return 0;
  }
  const aliasW = Math.max(...rows.map((r) => r.alias.length), 5);
  info(c.bold('ALIAS'.padEnd(aliasW + 2) + 'TARGET'));
  for (const r of rows) {
    info(r.alias.padEnd(aliasW + 2) + `${r.user ? r.user + '@' : ''}${r.host}:${r.port}`);
  }
  return 0;
}
