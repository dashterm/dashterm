/**
 * Thin entry point used by `dashterm start` / `dashterm dev` / direct
 * `node dist/cli.js` invocation. The real CLI surface (add-user, list-users,
 * etc.) lives in /cli — this file is just the server bootstrapper.
 *
 * Args:
 *   --port <n>
 *   --bind <ip>
 *   --data-dir <path>
 *   --web-bundle <path>   (optional; serves the built SPA from here)
 *   --dev-cors-origin <url>  (allow Expo dev origin to talk to us)
 */

import { startServer } from './index';

function parseFlags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = 'true';
    }
  }
  return out;
}

async function main() {
  // Skip the optional `start` / `dev` first arg if present.
  const args = process.argv.slice(2);
  const startIdx = args[0] === 'start' || args[0] === 'dev' ? 1 : 0;
  const flags = parseFlags(args.slice(startIdx));
  const overrides: Parameters<typeof startServer>[0] = {};
  if (flags.port) overrides.port = parseInt(flags.port, 10);
  if (flags.bind) overrides.bind = flags.bind;
  if (flags['data-dir']) overrides.dataDir = flags['data-dir'];
  if (flags['web-bundle']) overrides.webBundleDir = flags['web-bundle'];
  if (flags['dev-cors-origin']) overrides.devCorsOrigin = flags['dev-cors-origin'];

  const started = await startServer(overrides);

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, async () => {
      started.app.log.info(`${sig} — shutting down`);
      await started.stop();
      process.exit(0);
    });
  }
}

main().catch((err) => {
  console.error('[dashterm-server] fatal:', err);
  process.exit(1);
});
