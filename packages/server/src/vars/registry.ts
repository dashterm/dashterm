/**
 * Per-user variables store — CRUD + a value lookup used by the secrets proxy.
 *
 * The sibling to secrets/registry.ts, with the OPPOSITE disclosure rule. A
 * secret is write-only: its value never leaves the server. A variable is
 * non-sensitive config (a base URL, a hostname, a username) that the owner
 * WANTS to see and edit — so GET /api/vars returns the value. Use a variable
 * for anything you'd want to read back later; use a secret for anything that
 * must never reach the browser.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../db';

export interface VarRow {
  name: string;
  value: string;
  createdAt: number;
  updatedAt: number;
}

/** Names, values + timestamps for a user's variables. Values ARE included. */
export function listVars(userId: string): VarRow[] {
  return getDb()
    .prepare<[string], { name: string; value: string; created_at: number; updated_at: number }>(
      'select name, value, created_at, updated_at from variables where user_id = ? order by name asc',
    )
    .all(userId)
    .map((r) => ({ name: r.name, value: r.value, createdAt: r.created_at, updatedAt: r.updated_at }));
}

/** Insert or overwrite a variable's value. */
export function upsertVar(userId: string, name: string, value: string): VarRow {
  const now = Date.now();
  getDb()
    .prepare(
      `insert into variables (id, user_id, name, value, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?)
         on conflict(user_id, name) do update set value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(randomUUID(), userId, name, value, now, now);
  const row = getDb()
    .prepare<[string, string], { value: string; created_at: number; updated_at: number }>(
      'select value, created_at, updated_at from variables where user_id = ? and name = ?',
    )
    .get(userId, name);
  return {
    name,
    value: row?.value ?? value,
    createdAt: row?.created_at ?? now,
    updatedAt: row?.updated_at ?? now,
  };
}

export function deleteVar(userId: string, name: string): boolean {
  return (
    getDb()
      .prepare('delete from variables where user_id = ? and name = ?')
      .run(userId, name).changes > 0
  );
}

/**
 * The full name→value map for one user. Consumed by the secrets proxy to
 * substitute `{{var.NAME}}` placeholders, mirroring getSecretsMap().
 */
export function getVarsMap(userId: string): Record<string, string> {
  const rows = getDb()
    .prepare<[string], { name: string; value: string }>(
      'select name, value from variables where user_id = ?',
    )
    .all(userId);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.name] = r.value;
  return map;
}
