/**
 * /api/auth/* — sign-in, sign-out, current-user, change-password.
 *
 * Sign-up isn't here on purpose: account creation goes through the CLI
 * (`dashterm add-user`). Closed signup is part of the self-host model.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDb } from '../db';
import {
  SESSION_COOKIE,
  hashPassword,
  loadOrCreateJwtSecret,
  sessionCookieOptions,
  signSession,
  verifyPassword,
  verifySession,
} from '../auth';
import type { GatewayConfig } from '../config';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  is_admin: number;
  must_reset_password: number;
  metadata: string;
  created_at: number;
  last_active: number;
}

function publicUser(row: UserRow) {
  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(row.metadata) as Record<string, unknown>;
  } catch {
    // ignore — corrupt metadata blob shouldn't break sign-in
  }
  return {
    uid: row.id,
    email: row.email,
    displayName: row.display_name || row.email,
    photoURL: null,
    isAdmin: row.is_admin === 1,
    mustResetPassword: row.must_reset_password === 1,
    metadata: { ...metadata, must_reset_password: row.must_reset_password === 1 },
  };
}

export function getUserFromRequest(
  req: FastifyRequest,
  config: GatewayConfig,
): { row: UserRow; claims: ReturnType<typeof verifySession> } | null {
  const token = (req.cookies as Record<string, string | undefined>)?.[SESSION_COOKIE];
  if (!token) return null;
  const secret = loadOrCreateJwtSecret(config.jwtSecretPath);
  const claims = verifySession(secret, token);
  if (!claims) return null;
  const row = getDb()
    .prepare<[string], UserRow>('select * from users where id = ?')
    .get(claims.sub);
  if (!row) return null;
  return { row, claims };
}

export async function registerAuthRoutes(app: FastifyInstance, config: GatewayConfig) {
  // POST /api/auth/signin — body { email, password } → 200 + cookie
  app.post('/api/auth/signin', async (req, reply) => {
    const body = (req.body ?? {}) as { email?: string; password?: string };
    const email = (body.email || '').trim().toLowerCase();
    const password = body.password || '';
    if (!email || !password) {
      return reply.code(400).send({ error: 'email and password required' });
    }
    const row = getDb()
      .prepare<[string], UserRow>('select * from users where email = ?')
      .get(email);
    if (!row) {
      return reply.code(401).send({ error: 'invalid credentials' });
    }
    const ok = await verifyPassword(row.password_hash, password);
    if (!ok) {
      return reply.code(401).send({ error: 'invalid credentials' });
    }
    getDb()
      .prepare('update users set last_active = ? where id = ?')
      .run(Date.now(), row.id);

    const secret = loadOrCreateJwtSecret(config.jwtSecretPath);
    const token = signSession(secret, {
      sub: row.id,
      email: row.email,
      is_admin: row.is_admin === 1,
    });
    reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(config.bind));
    return { user: publicUser(row) };
  });

  // POST /api/auth/signout — clears cookie
  app.post('/api/auth/signout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // GET /api/auth/me — current user, or { user: null } if not signed in.
  // Always 200: this endpoint is a "who am I" query, not a protected
  // resource. Returning 401 here generates console noise in DevTools
  // on every page-load before sign-in.
  app.get('/api/auth/me', async (req) => {
    const ctx = getUserFromRequest(req, config);
    if (!ctx) return { user: null };
    return { user: publicUser(ctx.row) };
  });

  // POST /api/auth/change-password — body { newPassword }
  app.post('/api/auth/change-password', async (req, reply) => {
    const ctx = getUserFromRequest(req, config);
    if (!ctx) return reply.code(401).send({ error: 'not signed in' });
    const body = (req.body ?? {}) as { newPassword?: string };
    const newPassword = body.newPassword || '';
    if (newPassword.length < 8) {
      return reply.code(400).send({ error: 'password must be at least 8 characters' });
    }
    if (newPassword === 'changeme') {
      return reply.code(400).send({ error: 'password cannot be "changeme"' });
    }
    const hash = await hashPassword(newPassword);
    getDb()
      .prepare(
        'update users set password_hash = ?, must_reset_password = 0 where id = ?',
      )
      .run(hash, ctx.row.id);
    return { ok: true };
  });

  // POST /api/auth/update-metadata — body { patch: Record<string, unknown> }
  // Merges into users.metadata. Mostly used by the dashboard to clear
  // must_reset_password after the force-reset flow.
  app.post('/api/auth/update-metadata', async (req, reply) => {
    const ctx = getUserFromRequest(req, config);
    if (!ctx) return reply.code(401).send({ error: 'not signed in' });
    const body = (req.body ?? {}) as { patch?: Record<string, unknown> };
    const patch = body.patch || {};
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(ctx.row.metadata) as Record<string, unknown>;
    } catch {
      existing = {};
    }
    const merged = { ...existing, ...patch };
    // The force-reset flag has its own column for query efficiency. Keep
    // them in sync if the dashboard merges it through metadata.
    let mustReset = ctx.row.must_reset_password;
    if ('must_reset_password' in merged) {
      mustReset = merged.must_reset_password ? 1 : 0;
      delete merged.must_reset_password;
    }
    getDb()
      .prepare('update users set metadata = ?, must_reset_password = ? where id = ?')
      .run(JSON.stringify(merged), mustReset, ctx.row.id);
    return { ok: true };
  });
}

/**
 * Helper for routes that need the signed-in user. Returns the row + claims
 * or sends 401 and returns null.
 */
export function requireUser(
  req: FastifyRequest,
  reply: FastifyReply,
  config: GatewayConfig,
): UserRow | null {
  const ctx = getUserFromRequest(req, config);
  if (!ctx) {
    reply.code(401).send({ error: 'not signed in' });
    return null;
  }
  return ctx.row;
}
