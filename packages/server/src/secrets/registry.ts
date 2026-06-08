/**
 * Per-user secrets store — CRUD + a value lookup used only by the proxy.
 *
 * Mirrors the ai/registry.ts style: thin functions over the sqlite handle
 * from db.ts. The cardinal rule is that `value` never leaves the server:
 * the only reader that touches it is getSecretsMap(), consumed by
 * /api/secrets/proxy to substitute `{{secret.NAME}}` placeholders into an
 * outbound request. Every other function returns names/metadata only.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../db';

export interface SecretSummary {
  name: string;
  createdAt: number;
  updatedAt: number;
}

interface SecretRow {
  id: string;
  user_id: string;
  name: string;
  value: string;
  created_at: number;
  updated_at: number;
}

/** Names + timestamps for a user's secrets. Never includes the value. */
export function listSecretNames(userId: string): SecretSummary[] {
  return getDb()
    .prepare<[string], { name: string; created_at: number; updated_at: number }>(
      'select name, created_at, updated_at from secrets where user_id = ? order by name asc',
    )
    .all(userId)
    .map((r) => ({ name: r.name, createdAt: r.created_at, updatedAt: r.updated_at }));
}

/** Insert or overwrite a secret's value. */
export function upsertSecret(userId: string, name: string, value: string): SecretSummary {
  const now = Date.now();
  getDb()
    .prepare(
      `insert into secrets (id, user_id, name, value, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?)
         on conflict(user_id, name) do update set value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(randomUUID(), userId, name, value, now, now);
  const row = getDb()
    .prepare<[string, string], { created_at: number; updated_at: number }>(
      'select created_at, updated_at from secrets where user_id = ? and name = ?',
    )
    .get(userId, name);
  return { name, createdAt: row?.created_at ?? now, updatedAt: row?.updated_at ?? now };
}

export function deleteSecret(userId: string, name: string): boolean {
  return (
    getDb()
      .prepare('delete from secrets where user_id = ? and name = ?')
      .run(userId, name).changes > 0
  );
}

/**
 * The full name→value map for one user. SERVER-INTERNAL ONLY — used by the
 * secrets proxy to substitute placeholders. Do not expose via any route.
 */
export function getSecretsMap(userId: string): Record<string, string> {
  const rows = getDb()
    .prepare<[string], Pick<SecretRow, 'name' | 'value'>>(
      'select name, value from secrets where user_id = ?',
    )
    .all(userId);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.name] = r.value;
  return map;
}
