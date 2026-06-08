#!/usr/bin/env node
import { startCommand } from './commands/gateway';
import { onboardCommand } from './commands/onboard';
import { daemonCommand } from './commands/daemon';
import { providerCommand } from './commands/provider';
import { homehubCommand } from './commands/homehub';
import {
  addUserCommand,
  deleteUserCommand,
  listUsersCommand,
  setAdminCommand,
} from './commands/users';
import { c, error, info } from './lib/log';

function help(): number {
  info(`${c.bold('dashterm')} — run the local gateway, manage accounts + AI providers`);
  info('');
  info(`${c.bold('Usage:')} dashterm <command> [args]`);
  info('');
  info(c.bold('Gateway (native install — no docker):'));
  info('  onboard                        first-boot wizard: create the admin account');
  info('  onboard --install-daemon       …and install the autostart unit');
  info('  start [--port N] [--bind ADDR] run the local gateway in the foreground');
  info('  start --dev                    run via tsx (no pre-build needed)');
  info('  add-user <email> [pw]          create a user (use --admin / --force-reset)');
  info('  list-users                     list users in the local sqlite');
  info('  delete-user <email>            delete a user');
  info('  set-admin <email> <true|false> toggle is_admin flag');
  info('  daemon install                 install launchd/systemd autostart unit');
  info('  daemon uninstall               remove the autostart unit');
  info('  daemon status                  print whether the daemon is running');
  info('  daemon logs [-f] [--err]       tail ~/.dashterm/gateway.log');
  info('  daemon restart                 reinstall (picks up env changes)');
  info('');
  info(c.bold('AI providers (Claude / GPT / Gemini / Ollama):'));
  info('  provider add NAME --kind X --model M [--api-key K] [--default]');
  info('  provider list                  print configured providers');
  info('  provider remove NAME           drop a provider');
  info('  provider set-default NAME      mark a provider as the fallback');
  info('  provider bind APP_ID NAME      route an app to a specific provider');
  info('  provider unbind APP_ID         drop the binding');
  info('  provider binding [APP_ID]      see which provider resolves for an app');
  info('');
  info(c.bold('Homehub (optional Supabase Docker bundle):'));
  info('  homehub init                   write .env with fresh secrets');
  info('  homehub up [--dev]             docker compose up -d (--dev brings up Studio)');
  info('  homehub down                   docker compose down (volumes persist)');
  info('  homehub logs [SERVICE...]      tail logs');
  info('  homehub status                 docker compose ps');
  info('  homehub migrate                apply any unrun SQL migrations');
  info('  homehub add-user EMAIL [pw]    invite a user to the homehub install');
  info('');
  return 0;
}

async function main(): Promise<number> {
  const [, , raw, ...rest] = process.argv;
  const cmd = (raw || '').toLowerCase();

  switch (cmd) {
    case '':
    case 'help':
    case '-h':
    case '--help':
      return help();
    case 'start':
      return startCommand(rest);
    case 'onboard':
      return onboardCommand(rest);
    case 'add-user':
      return addUserCommand(rest);
    case 'list-users':
      return listUsersCommand();
    case 'delete-user':
      return deleteUserCommand(rest);
    case 'set-admin':
      return setAdminCommand(rest);
    case 'daemon':
      return daemonCommand(rest);
    case 'provider':
      return providerCommand(rest);
    case 'homehub':
      return homehubCommand(rest);
    default:
      error(`Unknown command: ${raw}`);
      help();
      return 1;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    error(err?.message || String(err));
    process.exit(1);
  },
);
