/**
 * `dashterm onboard` (alias `dashterm setup`) — first-boot setup for the
 * native install.
 *
 * Interactive (a TTY, no --email/--password): a clack wizard that
 *   1. creates the admin account (only if no users exist yet),
 *   2. lets you tick the AI coding agents to enable (spacebar) — Claude Code
 *      today, Codex / Grok Build shown greyed-out as "coming soon",
 *   3. checks that Claude is installed + pre-authorised and guides you if not,
 *   4. toggles "start at login" (the autostart daemon) on/off.
 * Re-running on an installed system skips account creation but still lets you
 * flip the agent / autostart toggles.
 *
 * Non-interactive (for install.sh / CI):
 *   --email <addr> --password <pw> [--data-dir <path>] [--install-daemon]
 */

import { randomUUID } from 'node:crypto';
import { homedir, networkInterfaces } from 'node:os';
import path from 'node:path';
import * as p from '@clack/prompts';
import { installDaemon, isDaemonInstalled, uninstallDaemon } from '../daemon';
import { gatewayLogPath } from '../daemon/paths';
import { type ClaudeStatus, detectClaude, summariseClaude } from '../lib/claude-auth';
import { c, error, info, success, warn } from '../lib/log';

interface OnboardFlags {
  email?: string;
  password?: string;
  dataDir?: string;
  installDaemon: boolean;
  yes: boolean;
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
type Db = ReturnType<ServerModule['openDb']>;

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
// Used by the non-interactive fallback only — the wizard uses clack.
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

function validateEmail(email: string | undefined): string | undefined {
  const e = (email ?? '').trim();
  if (!e || !e.includes('@') || e.length > 254) return 'enter a valid email address';
  return undefined;
}

function validatePassword(pw: string | undefined): string | undefined {
  const v = pw ?? '';
  if (v.length < 8) return 'password must be at least 8 characters';
  if (v === 'changeme') return 'pick something other than the placeholder "changeme"';
  return undefined;
}

async function createAdmin(
  mod: ServerModule,
  db: Db,
  email: string,
  password: string,
): Promise<void> {
  const hash = await mod.hashPassword(password);
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `insert into users (id, email, password_hash, display_name, is_admin, must_reset_password, metadata, created_at, last_active)
       values (?, ?, ?, ?, 1, 0, '{}', ?, ?)`,
  ).run(id, email, hash, email.split('@')[0], now, now);
}

function userCount(db: Db): number {
  return (db.prepare('select count(*) as n from users').get() as { n: number } | undefined)?.n ?? 0;
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

  // Interactive wizard whenever we have a TTY and weren't handed full
  // non-interactive credentials. Otherwise fall back to the flag-driven flow.
  const useWizard = !!process.stdin.isTTY && !(flags.email && flags.password);
  if (useWizard) {
    return runWizard(mod, db, dir);
  }
  return runNonInteractive(mod, db, dir, flags);
}

// ---------------------------------------------------------------------------
// Interactive wizard (clack)
// ---------------------------------------------------------------------------

function onCancel(): never {
  p.cancel('Setup cancelled.');
  process.exit(130);
}

// First non-internal IPv4 address, for the "reachable on your LAN" hint.
function firstLanIPv4(): string | null {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const ni of addrs ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return null;
}

async function runWizard(mod: ServerModule, db: Db, dir: string): Promise<number> {
  p.intro(c.cyan(c.bold(' DashTerm setup ')));

  // 1. Admin account — only when the install has no users yet.
  if (userCount(db) === 0) {
    const emailIn = await p.text({
      message: 'Admin email',
      placeholder: 'admin@localhost',
      defaultValue: 'admin@localhost',
      validate: validateEmail,
    });
    if (p.isCancel(emailIn)) onCancel();
    const email = (emailIn.trim() || 'admin@localhost').toLowerCase();

    let password = '';
    while (true) {
      const pw1 = await p.password({ message: 'Password (min 8 chars)', validate: validatePassword });
      if (p.isCancel(pw1)) onCancel();
      const pw2 = await p.password({
        message: 'Confirm password',
        validate: (v) => (v ? undefined : 'enter the password again'),
      });
      if (p.isCancel(pw2)) onCancel();
      if (pw1 !== pw2) {
        p.log.warn("Passwords didn't match — try again.");
        continue;
      }
      password = pw1;
      break;
    }

    const sp = p.spinner();
    sp.start('Creating admin account');
    await createAdmin(mod, db, email, password);
    sp.stop(`Admin account created: ${email}`);
  } else {
    p.log.info(`${userCount(db)} user(s) already exist — leaving accounts as-is.`);
  }

  // 2. AI coding agents — Codex / Grok Build are visibly greyed out + unselectable.
  const claude = detectClaude();
  const agents = await p.multiselect<string>({
    message: 'AI coding agents  (↑/↓ move · space toggle · enter confirm)',
    options: [
      { value: 'claude', label: 'Claude Code', hint: summariseClaude(claude) },
      { value: 'codex', label: 'Codex', hint: 'coming soon', disabled: true },
      { value: 'grok', label: 'Grok Build', hint: 'coming soon', disabled: true },
    ],
    initialValues: ['claude'],
    required: false,
  });
  if (p.isCancel(agents)) onCancel();
  const wantClaude = agents.includes('claude');

  // 3. Claude auth gate — detect + guide (we can't run Claude's OAuth login).
  if (wantClaude) await ensureClaudeAuth(claude);

  // 3b. Root + agent: Claude Code refuses bypassed-permissions as root, and
  // overriding it lets the agent run any command as root — so make it an
  // explicit opt-in with a clear warning.
  let agentAllowRoot = false;
  const runningAsRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  if (wantClaude && runningAsRoot) {
    p.log.warn(
      'DashTerm is running as root. Claude Code refuses to run agent sessions ' +
        'with bypassed permissions as root, and overriding it lets the agent run ' +
        'ANY command as root. Running DashTerm as a non-root user is strongly recommended.',
    );
    const allow = await p.confirm({
      message: 'Allow the agent to run as root anyway? (only on a disposable/sandboxed host)',
      initialValue: false,
    });
    if (p.isCancel(allow)) onCancel();
    agentAllowRoot = allow === true;
    if (!agentAllowRoot) {
      p.log.info('Agent sessions stay blocked while running as root — re-run DashTerm as a non-root user.');
    }
  }

  // 4. Options — the autostart daemon toggle. Pre-checked to reflect reality.
  const daemonOn = isDaemonInstalled();
  const options = await p.multiselect<string>({
    message: 'Options',
    options: [
      {
        value: 'autostart',
        label: 'Start DashTerm at login',
        hint: daemonOn ? 'currently on' : 'currently off',
      },
    ],
    initialValues: ['autostart'],
    required: false,
  });
  if (p.isCancel(options)) onCancel();
  const wantAutostart = options.includes('autostart');

  // 4b. Network access — which address the gateway binds to.
  const port = process.env.DASHTERM_PORT ?? '8765';
  const bindChoice = await p.select<string>({
    message: 'Network access',
    options: [
      {
        value: '127.0.0.1',
        label: 'This machine only (127.0.0.1)',
        hint: 'most secure · reach it remotely via an SSH tunnel',
      },
      {
        value: '0.0.0.0',
        label: 'Anyone on this network (0.0.0.0)',
        hint: `reachable at http://<this-host>:${port}`,
      },
    ],
    initialValue: process.env.DASHTERM_BIND === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1',
  });
  if (p.isCancel(bindChoice)) onCancel();
  const bind = bindChoice;
  if (bind === '0.0.0.0') {
    p.log.warn(
      'Anyone on your network will be able to reach DashTerm — keep the admin password strong' +
        (wantClaude ? ', and note the coding agent can run commands on this host.' : '.'),
    );
  }

  // 5. Apply.
  const summary: string[] = [];

  // The daemon bakes these into its unit, but a foreground `dashterm start`
  // reads them from the environment — so surface them in the manual command.
  const startEnv =
    (bind !== '127.0.0.1' ? `DASHTERM_BIND=${bind} ` : '') +
    (wantClaude ? 'DASHTERM_AGENT_ENABLED=1 ' : '') +
    (agentAllowRoot ? 'DASHTERM_AGENT_ALLOW_ROOT=1 ' : '');
  const manualStart = `${startEnv}dashterm start`;

  if (wantAutostart) {
    const sp = p.spinner();
    sp.start(daemonOn ? 'Updating autostart service' : 'Installing autostart service');
    try {
      const unit = installDaemon({
        port,
        bind,
        dataDir: dir,
        agentEnabled: wantClaude,
        agentAllowRoot,
      });
      sp.stop(`Autostart on → ${unit}`);
      summary.push('Gateway is running now and relaunches on login.');
      summary.push(c.gray(`Logs: ${gatewayLogPath()}`));
    } catch (e) {
      sp.error('Autostart install failed');
      p.log.warn(e instanceof Error ? e.message : String(e));
      summary.push(`Autostart failed — start it manually:  ${c.bold(manualStart)}`);
    }
  } else if (daemonOn) {
    const sp = p.spinner();
    sp.start('Removing autostart service');
    uninstallDaemon();
    sp.stop('Autostart off');
    summary.push(`Start the gateway yourself:  ${c.bold(manualStart)}`);
  } else {
    summary.push(`Start the gateway:  ${c.bold(manualStart)}`);
  }

  summary.push('');
  summary.push(`Dashboard: ${c.bold(`http://localhost:${port}`)}`);
  if (bind === '0.0.0.0') {
    const ip = firstLanIPv4();
    summary.push(c.gray(`On your network: http://${ip ?? '<this-host-ip>'}:${port}`));
  }
  p.note(summary.join('\n'), 'Done');
  p.outro(c.green('DashTerm is ready.'));
  return 0;
}

async function ensureClaudeAuth(initial: ClaudeStatus): Promise<void> {
  let s = initial;
  while (true) {
    if (s.installed && s.credsPresent) {
      p.log.success('Claude Code is installed and authorised.');
      return;
    }
    if (!s.installed) {
      p.note(
        [
          "The Claude Code CLI isn't on your PATH.",
          '',
          'Install it:',
          '  npm install -g @anthropic-ai/claude-code',
          '  (or set DASHTERM_CLAUDE_BIN to its location)',
          '',
          'Then sign in:  run  claude  →  /login',
        ].join('\n'),
        'Claude not found',
      );
    } else {
      p.note(
        [
          'Claude Code is installed but not signed in yet.',
          '',
          'Sign in:  run  claude  then type  /login',
          'and finish in your browser.',
        ].join('\n'),
        'Claude not authorised',
      );
    }
    const choice = await p.select<string>({
      message: 'Re-check now, or continue and sort it out later?',
      options: [
        { value: 'recheck', label: 'Re-check' },
        { value: 'continue', label: 'Continue anyway' },
      ],
      initialValue: 'recheck',
    });
    if (p.isCancel(choice) || choice === 'continue') return;
    s = detectClaude();
  }
}

// ---------------------------------------------------------------------------
// Non-interactive flow (install.sh / CI)
// ---------------------------------------------------------------------------

async function runNonInteractive(
  mod: ServerModule,
  db: Db,
  dir: string,
  flags: OnboardFlags,
): Promise<number> {
  if (userCount(db) > 0) {
    info(`${userCount(db)} user(s) already exist in ${dir}/state.db.`);
    info('Nothing to do. Use `dashterm add-user` to add more, `dashterm list-users` to see them.');
    info(c.gray('Run `dashterm start` to launch the gateway.'));
    return 0;
  }

  info(c.bold('DashTerm onboarding'));
  info('');

  let email = flags.email;
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

  let password = flags.password;
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

  await createAdmin(mod, db, email, password);
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
  info(c.gray('  $ ') + c.bold('dashterm start') + c.gray('   then open ') + c.bold('http://localhost:8765'));
  info(c.gray('Or install the autostart unit: `dashterm daemon install`.'));
  return 0;
}
