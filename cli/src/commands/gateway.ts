/**
 * `dashterm start [--dev]` — boot the local gateway (the native non-Docker
 * install path).
 *
 * Implementation lives in packages/server/. The CLI knows two things:
 *   1. How to find the server's compiled entry on disk (resolves the
 *      monorepo path in dev, the bundled module in a global npm install).
 *   2. The flag layout we want to expose to users.
 *
 * Sibling commands (`add-user`, `list-users`, `delete-user`, `set-admin`)
 * skip the server entirely and write directly to the sqlite file. That
 * means the operator can manage accounts without the gateway running.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { c, error, info } from '../lib/log';

interface StartFlags {
  port?: string;
  bind?: string;
  dev: boolean;
  dataDir?: string;
  webBundle?: string;
  devCorsOrigin?: string;
}

function parseStart(args: string[]): StartFlags {
  const out: StartFlags = { dev: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = args[i + 1];
    switch (a) {
      case '--dev':
        out.dev = true;
        break;
      case '--port':
        out.port = next;
        i++;
        break;
      case '--bind':
        out.bind = next;
        i++;
        break;
      case '--data-dir':
        out.dataDir = next;
        i++;
        break;
      case '--web-bundle':
        out.webBundle = next;
        i++;
        break;
      case '--dev-cors-origin':
        out.devCorsOrigin = next;
        i++;
        break;
    }
  }
  return out;
}

// Resolve the server entry on disk. In the monorepo, packages/server is a
// sibling of cli/. In a global npm install, server ships inside the same
// package tree at node_modules/@dashterm/server.
function resolveServerEntry(opts: { dev: boolean }): string | null {
  const candidates: string[] = [];
  // __dirname is cli/dist/commands → up 3 to monorepo root.
  const monorepoRoot = path.resolve(__dirname, '../../..');
  if (opts.dev) {
    // Source via tsx in dev — avoids needing the dist build to be current.
    candidates.push(path.join(monorepoRoot, 'packages/server/src/cli.ts'));
  }
  candidates.push(path.join(monorepoRoot, 'packages/server/dist/cli.js'));
  candidates.push(path.join(__dirname, '../../../server/dist/cli.js'));
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

export async function startCommand(args: string[]): Promise<number> {
  const flags = parseStart(args);
  const entry = resolveServerEntry({ dev: flags.dev });
  if (!entry) {
    error('Could not locate the gateway entry. Try `npm install` in packages/server/.');
    return 1;
  }

  const childArgs: string[] = ['start'];
  if (flags.port) childArgs.push('--port', flags.port);
  if (flags.bind) childArgs.push('--bind', flags.bind);
  if (flags.dataDir) childArgs.push('--data-dir', flags.dataDir);
  if (flags.webBundle) childArgs.push('--web-bundle', flags.webBundle);
  if (flags.devCorsOrigin) childArgs.push('--dev-cors-origin', flags.devCorsOrigin);

  // Use process.execPath (the Node binary running this CLI) so the child
  // inherits the exact same runtime. Resolving `node` via PATH would let a
  // mismatched Node version through (the user might have brew node 25 ahead
  // of their nvm node 22 in PATH), and the better-sqlite3 native binding
  // would then refuse to load with a NODE_MODULE_VERSION error. Most
  // visible when the daemon runs: launchd's PATH is hand-set in the plist
  // and rarely matches the install-time shell.
  const command = entry.endsWith('.ts') ? 'npx' : process.execPath;
  const fullArgs = entry.endsWith('.ts') ? ['tsx', entry, ...childArgs] : [entry, ...childArgs];

  info(c.gray(`→ ${command} ${fullArgs.join(' ')}`));
  const child = spawn(command, fullArgs, { stdio: 'inherit' });

  return new Promise<number>((resolve) => {
    child.on('exit', (code) => resolve(code ?? 0));
    for (const sig of ['SIGINT', 'SIGTERM'] as const) {
      process.on(sig, () => child.kill(sig));
    }
  });
}
