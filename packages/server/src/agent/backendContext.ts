/**
 * The capability `ctx` injected into every agent-authored backend handler.
 * This is the whole point of "any backend without shims": instead of the
 * gateway shipping a fixed endpoint per feature, a backend module composes
 * these primitives however it needs.
 *
 * Everything is scoped to a single uid (the app owner). ssh runs over THAT
 * user's managed keys; secrets/ai resolve THAT user's vault/providers. A
 * backend can never reach another user's hosts or secrets.
 *
 * Trust model: these run in the gateway process with no hard sandbox. The
 * author already had bypassPermissions (full RCE) at build time, and dispatch
 * is owner-only, so request-time invocation grants nothing the owner couldn't
 * already do. Worker-thread isolation is a future hardening, not a v1 need on
 * a localhost-bound, single-trusted-user homelab.
 */
import { execFile } from 'child_process';
import path from 'path';
import type { GatewayConfig } from '../config';
import { listHosts, sshBinDir } from './sshHosts';
import { getAppDb, type AppDb } from './appDb';
import { getSecretsMap, listSecretNames } from '../secrets/registry';
import { getVarsMap, listVars } from '../vars/registry';
import { adapterFor, resolveProvider } from '../ai/registry';
import { runAiLoop, type AiLoopOptions, type AiLoopResult } from '../ai/loop';
import type { ChatRequest } from '../ai/types';

export interface ExecResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface BackendCtx {
  userId: string;
  /** This app's own private SQLite database (per owner + app). */
  db: AppDb;
  /** Run a command on one of the user's configured SSH hosts (by alias). */
  ssh(alias: string, command: string, opts?: { timeoutMs?: number }): Promise<ExecResult>;
  /** Run a command on the gateway host itself (same machine as the agent). */
  exec(command: string, opts?: { timeoutMs?: number }): Promise<ExecResult>;
  /** Server-side fetch — reaches LAN/private services (no SSRF guard). */
  fetch(url: string, init?: RequestInit): Promise<Response>;
  secrets: {
    get(name: string): string | undefined;
    names(): string[];
    map(): Record<string, string>;
  };
  /** Readable config (non-secret), sibling to secrets — see vars/registry.ts. */
  vars: {
    get(name: string): string | undefined;
    names(): string[];
    map(): Record<string, string>;
  };
  ai: {
    chat(messages: unknown[], opts?: { appId?: string; model?: string; [k: string]: unknown }): Promise<unknown>;
    /** Server-side tool/agent loop: supply tool handlers, get back the final
     *  reply + the steps taken. Owns the call→tool→call loop and every
     *  provider's tool round-trip quirk so the app never re-implements it. */
    run(opts: Omit<AiLoopOptions, 'appId'> & { appId?: string }): Promise<AiLoopResult>;
  };
  log(...args: unknown[]): void;
}

const DEFAULT_TIMEOUT = 20_000;
const MAX_BUFFER = 8 << 20; // 8 MiB

function run(file: string, argv: string[], timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(file, argv, { timeout: timeoutMs, maxBuffer: MAX_BUFFER }, (err, stdout, stderr) => {
      const code = err && typeof (err as NodeJS.ErrnoException & { code?: number }).code === 'number'
        ? ((err as unknown as { code: number }).code)
        : err ? 1 : 0;
      resolve({ ok: !err, code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}

export function buildBackendCtx(config: GatewayConfig, uid: string, shareCode: string): BackendCtx {
  return {
    userId: uid,
    db: getAppDb(config, uid, shareCode),

    async ssh(alias, command, opts) {
      const known = listHosts(config, uid).find((h) => h.alias === alias);
      if (!known) return { ok: false, code: null, stdout: '', stderr: `unknown host "${alias}"` };
      if (typeof command !== 'string' || !command) {
        return { ok: false, code: null, stdout: '', stderr: 'command is required' };
      }
      const ssh = path.join(sshBinDir(config, uid), 'ssh'); // wrapper: ssh -F <managed config>
      return run(ssh, [alias, command], opts?.timeoutMs ?? DEFAULT_TIMEOUT);
    },

    async exec(command, opts) {
      if (typeof command !== 'string' || !command) {
        return { ok: false, code: null, stdout: '', stderr: 'command is required' };
      }
      return run('/bin/sh', ['-c', command], opts?.timeoutMs ?? DEFAULT_TIMEOUT);
    },

    fetch(url, init) {
      return fetch(url, init);
    },

    secrets: {
      get: (name) => getSecretsMap(uid)[name],
      names: () => listSecretNames(uid).map((s) => s.name),
      map: () => getSecretsMap(uid),
    },

    vars: {
      get: (name) => getVarsMap(uid)[name],
      names: () => listVars(uid).map((v) => v.name),
      map: () => getVarsMap(uid),
    },

    ai: {
      async chat(messages, opts) {
        const appId = typeof opts?.appId === 'string' ? opts.appId : undefined;
        const providerRow = resolveProvider(appId);
        const adapter = adapterFor(providerRow);
        const req = { ...(opts ?? {}), messages } as unknown as ChatRequest;
        return adapter.chat(req, {
          model: (opts?.model as string) || providerRow.default_model,
          apiKey: providerRow.api_key,
          baseUrl: providerRow.base_url,
          providerName: providerRow.name,
        });
      },
      // Default the binding lookup to THIS app's share code, so an app that
      // never passes appId still gets its own bound provider (falling back to
      // the default). The owner can override per call.
      run(opts) {
        return runAiLoop({ ...opts, appId: opts.appId ?? shareCode });
      },
    },

    log: (...args) => console.log(`[backend ${uid.slice(0, 8)}]`, ...args),
  };
}
