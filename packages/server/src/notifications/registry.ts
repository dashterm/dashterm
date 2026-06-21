/**
 * Per-user push device tokens — thin functions over the sqlite handle, in the
 * same style as secrets/registry.ts. The native app registers its Expo push
 * token; the push sender (push.ts) reads them to deliver notifications.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../db';

/** Insert or refresh the caller's token (idempotent on (user_id, token)). */
export function upsertDeviceToken(userId: string, token: string, platform: string): void {
  const now = Date.now();
  getDb()
    .prepare(
      `insert into device_tokens (id, user_id, token, platform, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?)
         on conflict(user_id, token) do update set platform = excluded.platform, updated_at = excluded.updated_at`,
    )
    .run(randomUUID(), userId, token, platform, now, now);
}

/** Remove one of the caller's tokens (e.g. on sign-out). Returns true if a row went away. */
export function deleteDeviceToken(userId: string, token: string): boolean {
  return (
    getDb().prepare('delete from device_tokens where user_id = ? and token = ?').run(userId, token)
      .changes > 0
  );
}

/**
 * Drop a token for every user. Used when Expo reports a token as
 * DeviceNotRegistered — the device is gone, so the row is dead everywhere.
 */
export function deleteTokenEverywhere(token: string): void {
  getDb().prepare('delete from device_tokens where token = ?').run(token);
}

/** All registered tokens for a user. */
export function getDeviceTokens(userId: string): string[] {
  return getDb()
    .prepare<[string], { token: string }>('select token from device_tokens where user_id = ?')
    .all(userId)
    .map((r) => r.token);
}
