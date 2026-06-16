/**
 * Auth primitives: password hashing, JWT sign/verify, cookie helpers.
 *
 * Passwords: argon2id with the OWASP-recommended settings.
 *   - memoryCost: 19 MiB
 *   - timeCost: 2 iterations
 *   - parallelism: 1
 * @node-rs/argon2 picks sensible defaults; we accept them.
 *
 * Sessions: HS256 JWT signed with a secret at ~/.dashterm/jwt-secret. The
 * cookie is httpOnly + SameSite=Lax + (Secure only when the request arrived
 * over HTTPS — directly or via an x-forwarded-proto reverse proxy).
 * No refresh tokens for v0 — sessions last 14 days, browser refreshes on
 * password change by re-issuing.
 */

import { randomBytes } from 'crypto';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import path from 'path';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';

const SESSION_DAYS = 14;
export const SESSION_COOKIE = 'dashterm_session';

export async function hashPassword(pw: string): Promise<string> {
  return argonHash(pw);
}

export async function verifyPassword(hash: string, pw: string): Promise<boolean> {
  try {
    return await argonVerify(hash, pw);
  } catch {
    return false;
  }
}

export function loadOrCreateJwtSecret(jwtSecretPath: string): string {
  if (fs.existsSync(jwtSecretPath)) {
    return fs.readFileSync(jwtSecretPath, 'utf8').trim();
  }
  fs.mkdirSync(path.dirname(jwtSecretPath), { recursive: true, mode: 0o700 });
  const secret = randomBytes(32).toString('base64');
  fs.writeFileSync(jwtSecretPath, secret, { mode: 0o600 });
  return secret;
}

export interface SessionClaims {
  sub: string;     // user id
  email: string;
  is_admin: boolean;
  iat: number;
  exp: number;
}

export function signSession(secret: string, claims: Omit<SessionClaims, 'iat' | 'exp'>): string {
  return jwt.sign(claims, secret, { expiresIn: `${SESSION_DAYS}d`, algorithm: 'HS256' });
}

export function verifySession(secret: string, token: string): SessionClaims | null {
  try {
    return jwt.verify(token, secret, { algorithms: ['HS256'] }) as SessionClaims;
  } catch {
    return null;
  }
}

export function sessionCookieOptions(secure: boolean) {
  // Set Secure from the *request scheme*, not the bind address: binding to
  // 0.0.0.0 does NOT imply TLS. A Secure cookie is silently dropped by the
  // browser over plain http:// — it works on localhost (a secure context) but
  // breaks on a plain-http LAN IP. Deriving it from the request also upgrades
  // to Secure automatically behind an HTTPS reverse proxy / Tailscale serve.
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60, // seconds
  };
}
