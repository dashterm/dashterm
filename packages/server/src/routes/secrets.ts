/**
 * /api/secrets/* — per-user secret vault + the server-side proxy that lets
 * custom apps USE a secret without ever seeing its value.
 *
 *   GET    /api/secrets          list the caller's secret names (no values)
 *   PUT    /api/secrets/:name    upsert a secret  { value }
 *   DELETE /api/secrets/:name    delete a secret
 *   POST   /api/secrets/proxy    outbound fetch with {{secret.NAME}} subbed in
 *
 * Auth: every route requires a signed-in user; everything is scoped to
 * me.id, so user A can never read or use user B's secrets.
 *
 * The proxy is the whole point of "names only": an app builds a request
 * with `{{secret.WEATHER_KEY}}` placeholders in the url / headers / body
 * and POSTs it here; the gateway substitutes the real values from the
 * caller's vault, performs the call, and returns the upstream response.
 * The raw value never reaches the browser.
 */

import type { FastifyInstance } from 'fastify';
import { requireUser } from './auth';
import type { GatewayConfig } from '../config';
import {
  deleteSecret,
  getSecretsMap,
  listSecretNames,
  upsertSecret,
} from '../secrets/registry';

const PLACEHOLDER = /\{\{\s*secret\.([A-Za-z0-9_]+)\s*\}\}/g;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MiB
const PROXY_TIMEOUT_MS = 30_000;

/** Valid secret name: uppercase-ish identifier, matches the placeholder grammar. */
function validName(name: string): boolean {
  return /^[A-Za-z0-9_]{1,64}$/.test(name);
}

/**
 * Replace every {{secret.NAME}} in `text` with the caller's value.
 * Collects any names that aren't in the vault so the caller fails loudly
 * instead of sending an empty credential upstream.
 */
function substitute(text: string, secrets: Record<string, string>, unknown: Set<string>): string {
  return text.replace(PLACEHOLDER, (_m, name: string) => {
    if (Object.prototype.hasOwnProperty.call(secrets, name)) return secrets[name];
    unknown.add(name);
    return '';
  });
}

/**
 * Best-effort SSRF guard. Blocks loopback / private / link-local targets so a
 * vibe-coded app can't turn the gateway into a confused deputy against the
 * host's own network. Not bulletproof (DNS rebinding can still resolve a
 * public name to a private IP) but it raises the bar meaningfully for a
 * homelab deployment.
 */
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '::1' || h === '::') return true; // IPv6 loopback / unspecified
  if (h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true; // link-local / ULA
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  }
  return false;
}

export async function registerSecretsRoutes(app: FastifyInstance, config: GatewayConfig) {
  app.get('/api/secrets', async (req, reply) => {
    const me = requireUser(req, reply, config);
    if (!me) return;
    return { secrets: listSecretNames(me.id) };
  });

  app.put<{ Params: { name: string }; Body: { value?: string } }>(
    '/api/secrets/:name',
    async (req, reply) => {
      const me = requireUser(req, reply, config);
      if (!me) return;
      const name = req.params.name;
      if (!validName(name)) {
        return reply.code(400).send({ error: 'name must match [A-Za-z0-9_], 1-64 chars' });
      }
      const value = req.body?.value;
      if (typeof value !== 'string' || value.length === 0) {
        return reply.code(400).send({ error: 'value is required' });
      }
      return { secret: upsertSecret(me.id, name, value) };
    },
  );

  app.delete<{ Params: { name: string } }>('/api/secrets/:name', async (req, reply) => {
    const me = requireUser(req, reply, config);
    if (!me) return;
    const removed = deleteSecret(me.id, req.params.name);
    if (!removed) return reply.code(404).send({ error: 'secret not found' });
    return { ok: true };
  });

  app.post<{
    Body: {
      url?: string;
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
    };
  }>('/api/secrets/proxy', async (req, reply) => {
    const me = requireUser(req, reply, config);
    if (!me) return;
    const b = req.body ?? {};
    if (typeof b.url !== 'string' || !b.url) {
      return reply.code(400).send({ error: 'url is required' });
    }

    const secrets = getSecretsMap(me.id);
    const unknown = new Set<string>();

    const url = substitute(b.url, secrets, unknown);
    const method = (b.method || 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(b.headers ?? {})) {
      if (typeof v === 'string') headers[k] = substitute(v, secrets, unknown);
    }
    let outBody: string | undefined;
    if (b.body !== undefined && b.body !== null && method !== 'GET' && method !== 'HEAD') {
      const raw = typeof b.body === 'string' ? b.body : JSON.stringify(b.body);
      outBody = substitute(raw, secrets, unknown);
    }

    if (unknown.size > 0) {
      return reply
        .code(400)
        .send({ error: `unknown secret(s): ${[...unknown].join(', ')}` });
    }

    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return reply.code(400).send({ error: 'invalid url after substitution' });
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      return reply.code(400).send({ error: 'only http(s) urls are allowed' });
    }
    if (isBlockedHost(target.hostname)) {
      return reply.code(403).send({ error: 'target host is not allowed' });
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PROXY_TIMEOUT_MS);
    try {
      const upstream = await fetch(target.toString(), {
        method,
        headers,
        body: outBody,
        signal: ctrl.signal,
        redirect: 'follow',
      });
      const buf = Buffer.from(await upstream.arrayBuffer());
      const text = buf.subarray(0, MAX_RESPONSE_BYTES).toString('utf8');
      const outHeaders: Record<string, string> = {};
      upstream.headers.forEach((v, k) => {
        // Drop set-cookie so we never relay a third party's cookies to the app.
        if (k.toLowerCase() !== 'set-cookie') outHeaders[k] = v;
      });
      return {
        status: upstream.status,
        ok: upstream.ok,
        headers: outHeaders,
        body: text,
        truncated: buf.length > MAX_RESPONSE_BYTES,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      req.log.warn({ err: msg, host: target.hostname }, 'secrets proxy fetch failed');
      return reply.code(502).send({ error: `upstream fetch failed: ${msg}` });
    } finally {
      clearTimeout(timer);
    }
  });
}
