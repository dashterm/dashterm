/**
 * `dashterm onboard` — first-boot setup for the native install.
 *
 * Run once after `curl install.sh | bash`. Walks the operator through
 * creating the admin account, then prints how to start the gateway.
 * Idempotent: re-running on an installed system tells you that and
 * exits cleanly.
 *
 * Non-interactive mode (for install.sh / CI):
 *   --email <addr> --password <pw>  [--data-dir <path>]
 *
 * Daemon install is intentionally NOT part of this command yet —
 * `--install-daemon` lands in a future chunk alongside the launchd /
 * systemd-user units.
 */

import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { installDaemon } from '../daemon';
import { gatewayLogPath } from '../daemon/paths';
import { c, error, info, success, warn } from '../lib/log';

interface OnboardFlags {
  email?: string;
  password?: string;
  dataDir?: string;
  installDaemon: boolean;
  yes: boolean; // future: non-interactive mode
}

function parseFlags(args: string[]): OnboardFlags {
  const out: OnboardFlags = { installDaemon: false, yes: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = args[i + 1];
    switch (a) {
      case '--email':
        out.email = next;
        i++;
        break;
      case '--password':
        out.password = next;
        i++;
        break;
      case '--data-dir':
        out.dataDir = next;
        i++;
        break;
      case '--install-daemon':
        out.installDaemon = true;
        break;
      case '--yes':
      case '-y':
        out.yes = true;
        break;
    }
  }
  return out;
}

function dataDirFromFlags(flags: OnboardFlags): string {
  return flags.dataDir || process.env.DASHTERM_DATA_DIR || path.join(homedir(), '.dashterm');
}

interface ServerModule {
  openDb: (dataDir: string) => {
    prepare: (sql: string) => {
      get: (...p: unknown[]) => unknown;
      run: (...p: unknown[]) => { changes: number; lastInsertRowid: number | bigint };
      all: (...p: unknown[]) => unknown[];
    };
  };
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
  const monorepoRoot = path.resolve(__dirname, '../../..');
  const candidates = [
    path.join(monorepoRoot, 'packages/server/dist'),
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

// Promise-based readline prompt, with optional echo suppression for passwords.
function prompt(label: string, opts: { hidden?: boolean } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(
        new Error(
          'onboard needs an interactive TTY for the password prompt. Use --email/--password flags for non-interactive setup.',
        ),
      );
      return;
    }
    process.stdout.write(label);
    const stdin = process.stdin;
    let buf = '';

    const onData = (chunk: Buffer) => {
      const s = chunk.toString('utf8');
      for (const ch of s) {
        const code = ch.charCodeAt(0);
        if (code === 0x03) {
          // Ctrl-C
          cleanup();
          process.stdout.write('\n');
          reject(new Error('cancelled'));
          return;
        }
        if (ch === '\n' || ch === '\r') {
          cleanup();
          process.stdout.write('\n');
          resolve(buf);
          return;
        }
        if (code === 0x7f || code === 0x08) {
          // backspace / delete
          if (buf.length > 0) {
            buf = buf.slice(0, -1);
            if (!opts.hidden) process.stdout.write('\b \b');
          }
          continue;
        }
        buf += ch;
        if (!opts.hidden) process.stdout.write(ch);
      }
    };

    const cleanup = () => {
      stdin.removeListener('data', onData);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
    };

    stdin.resume();
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.on('data', onData);
  });
}

function validateEmail(email: string): string | null {
  if (!email || !email.includes('@') || email.length > 254) {
    return 'enter a valid email address';
  }
  return null;
}

function validatePassword(pw: string): string | null {
  if (pw.length < 8) return 'password must be at least 8 characters';
  if (pw === 'changeme') return 'pick something other than the placeholder "changeme"';
  return null;
}

export async function onboardCommand(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const mod = loadServer();
  if (!mod) {
    error('Server module not found. If you cloned the repo, run `npm install` at the root.');
    return 2;
  }
  const dir = dataDirFromFlags(flags);
  const db = mod.openDb(dir);

  const existingCount = (
    db.prepare('select count(*) as n from users').get() as { n: number } | undefined
  )?.n ?? 0;

  if (existingCount > 0) {
    info(`${existingCount} user(s) already exist in ${dir}/state.db.`);
    info('Nothing to do. Use `dashterm add-user` to add more, `dashterm list-users` to see them.');
    info(c.gray('Skipping onboarding; run `dashterm start` to launch the gateway.'));
    return 0;
  }

  info(c.bold('DashTerm onboarding'));
  info('');
  info('No users yet. Let\'s create the admin account.');
  info('');

  let email = flags.email;
  let password = flags.password;

  if (!email) {
    email = await prompt('Admin email [admin@localhost]: ');
    if (!email.trim()) email = 'admin@localhost';
  }
  email = email.trim().toLowerCase();
  const emailErr = validateEmail(email);
  if (emailErr) {
    error(emailErr);
    return 1;
  }

  if (!password) {
    while (true) {
      const pw1 = await prompt('Password (min 8 chars): ', { hidden: true });
      const pwErr = validatePassword(pw1);
      if (pwErr) {
        warn(pwErr);
        continue;
      }
      const pw2 = await prompt('Confirm password:        ', { hidden: true });
      if (pw1 !== pw2) {
        warn("passwords don't match — try again");
        continue;
      }
      password = pw1;
      break;
    }
  } else {
    const pwErr = validatePassword(password);
    if (pwErr) {
      error(pwErr);
      return 1;
    }
  }

  const hash = await mod.hashPassword(password);
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `insert into users (id, email, password_hash, display_name, is_admin, must_reset_password, metadata, created_at, last_active)
       values (?, ?, ?, ?, 1, 0, '{}', ?, ?)`,
  ).run(id, email, hash, email.split('@')[0], now, now);

  info('');
  success(`Admin account created: ${c.bold(email)}`);

  if (flags.installDaemon) {
    info('');
    info('Installing autostart unit…');
    try {
      const unitPath = installDaemon({
        port: process.env.DASHTERM_PORT ?? '8765',
        bind: process.env.DASHTERM_BIND ?? '127.0.0.1',
        dataDir: dir,
      });
      success(`Daemon installed → ${unitPath}`);
      info('');
      info(c.bold('Done.'));
      info('  Gateway is running now and will restart on login.');
      info('  Open ' + c.bold('http://localhost:' + (process.env.DASHTERM_PORT ?? '8765')) + ' in a browser.');
      info(c.gray(`  Logs: ${gatewayLogPath()}`));
      info(c.gray('  Stop: `dashterm daemon uninstall`'));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      warn(`Daemon install failed: ${msg}`);
      info(c.gray('Run `dashterm start` for now; retry `dashterm daemon install` later.'));
    }
    return 0;
  }

  info('');
  info(c.bold('Next step:'));
  info('  Start the gateway in this terminal:');
  info(c.gray('    $ ') + c.bold('dashterm start'));
  info('');
  info('  Then open the dashboard at:');
  info(c.gray('    ') + c.bold('http://localhost:8765'));
  info('');
  info(c.gray('Add more users with `dashterm add-user <email>`.'));
  info(c.gray('Or install the autostart unit: `dashterm daemon install`.'));
  return 0;
}
