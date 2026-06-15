/**
 * `dashterm daemon <install|uninstall|status|logs>` — autostart the
 * gateway on login.
 *
 * macOS:   ~/Library/LaunchAgents/com.dashterm.gateway.plist (launchd)
 * Linux:   ~/.config/systemd/user/dashterm-gateway.service  (systemd-user)
 * Windows: "DashTerm Gateway" scheduled task → ~/.dashterm/gateway.cmd
 *
 * Install captures DASHTERM_DATA_DIR / DASHTERM_PORT / DASHTERM_BIND
 * at the moment it's run and bakes them into the unit so the daemon
 * starts the gateway the same way you'd start it by hand.
 *
 * Logs are tailed from DASHTERM_DATA_DIR/gateway.log + gateway.err.log
 * — the launchd plist / systemd unit / gateway.cmd redirect stdout/stderr there.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  type DaemonInstallEnv,
  daemonStatus,
  installDaemon,
  isDaemonInstalled,
  uninstallDaemon,
} from '../daemon';
import { gatewayErrLogPath, gatewayLogPath } from '../daemon/paths';
import { c, error, info, success, warn } from '../lib/log';

function resolveEnv(): DaemonInstallEnv {
  const agentEnabled = ['1', 'true', 'yes'].includes(
    (process.env.DASHTERM_AGENT_ENABLED ?? '').toLowerCase(),
  );
  return {
    port: process.env.DASHTERM_PORT ?? '8765',
    bind: process.env.DASHTERM_BIND ?? '127.0.0.1',
    dataDir:
      process.env.DASHTERM_DATA_DIR ?? path.join(homedir(), '.dashterm'),
    ...(agentEnabled ? { agentEnabled } : {}),
  };
}

export async function daemonInstallCommand(): Promise<number> {
  if (isDaemonInstalled()) {
    info('Daemon already installed. Reinstalling to pick up the current env.');
  }
  const env = resolveEnv();
  try {
    const unitPath = installDaemon(env);
    success(`Daemon installed → ${unitPath}`);
    info('');
    info(`  data dir : ${env.dataDir}`);
    info(`  port     : ${env.port}`);
    info(`  bind     : ${env.bind}`);
    info(`  logs     : ${gatewayLogPath()}`);
    info('');
    info('The gateway will start now and on every login.');
    info(c.gray('  status: `dashterm daemon status`'));
    info(c.gray('  logs:   `dashterm daemon logs`'));
    info(c.gray('  stop:   `dashterm daemon uninstall`'));
    return 0;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    error(msg);
    return 1;
  }
}

export async function daemonUninstallCommand(): Promise<number> {
  if (!isDaemonInstalled()) {
    info('Daemon is not installed. Nothing to do.');
    return 0;
  }
  const ok = uninstallDaemon();
  if (!ok) {
    error('Uninstall reported no unit file removed. State may be inconsistent.');
    return 1;
  }
  success('Daemon uninstalled.');
  info(c.gray('Gateway has been stopped. Start it manually with `dashterm start`.'));
  return 0;
}

export async function daemonStatusCommand(): Promise<number> {
  const s = daemonStatus();
  if (!s.installed) {
    warn('Daemon is not installed. Run `dashterm daemon install` to set it up.');
    return 1;
  }
  info(c.bold('DashTerm daemon'));
  info(`  unit     : ${s.unitPath}`);
  if (s.active === true) {
    success(`  active   : yes  (pid ${s.pid ?? '?'})`);
  } else if (s.active === false) {
    warn('  active   : no');
  } else {
    info('  active   : unknown');
  }
  info(`  logs     : ${gatewayLogPath()}`);
  info(`  errlog   : ${gatewayErrLogPath()}`);
  return 0;
}

export async function daemonLogsCommand(args: string[]): Promise<number> {
  const followFlag = args.includes('-f') || args.includes('--follow');
  const errFlag = args.includes('--err') || args.includes('--stderr');
  const logFile = errFlag ? gatewayErrLogPath() : gatewayLogPath();
  if (!fs.existsSync(logFile)) {
    warn(`No log file yet at ${logFile}.`);
    info(c.gray('The gateway needs to have run at least once via the daemon.'));
    return 1;
  }
  // Windows has no `tail`. Print the last 200 lines ourselves; `--follow`
  // isn't supported there (note it and fall through to a one-shot dump).
  if (process.platform === 'win32') {
    if (followFlag) {
      warn('--follow is not supported on Windows; printing the last 200 lines instead.');
    }
    const lines = fs.readFileSync(logFile, 'utf8').split(/\r?\n/);
    process.stdout.write(lines.slice(-200).join('\n') + '\n');
    return 0;
  }
  const tailArgs = followFlag ? ['-n', '200', '-F', logFile] : ['-n', '200', logFile];
  const child = spawn('tail', tailArgs, { stdio: 'inherit' });
  return new Promise<number>((resolve) => {
    child.on('exit', (code) => resolve(code ?? 0));
    for (const sig of ['SIGINT', 'SIGTERM'] as const) {
      process.on(sig, () => child.kill(sig));
    }
  });
}

export async function daemonCommand(args: string[]): Promise<number> {
  const sub = (args[0] || '').toLowerCase();
  const rest = args.slice(1);
  switch (sub) {
    case 'install':
      return daemonInstallCommand();
    case 'uninstall':
    case 'remove':
      return daemonUninstallCommand();
    case 'status':
      return daemonStatusCommand();
    case 'logs':
    case 'log':
      return daemonLogsCommand(rest);
    case 'restart':
      return daemonRestartCommand();
    default:
      info('Usage: dashterm daemon <install|uninstall|status|logs|restart>');
      info('');
      info('  install              install + start the autostart unit');
      info('  uninstall            stop + remove the autostart unit');
      info('  status               print whether the daemon is running');
      info('  logs [-f] [--err]    print recent gateway log lines');
      info('  restart              uninstall + reinstall (picks up env changes)');
      return sub ? 1 : 0;
  }
}

async function daemonRestartCommand(): Promise<number> {
  if (isDaemonInstalled()) {
    const ok = uninstallDaemon();
    if (!ok) {
      warn('Couldn\'t fully tear down the existing daemon; continuing anyway.');
    }
  }
  // Tiny pause so launchctl/systemctl/schtasks finish releasing the unit.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return daemonInstallCommand();
}
