/**
 * 5-char share codes for vibe-coded apps. Mirrors the client-side generator
 * in packages/core/utils/shareCode.ts (packages/server can't import core).
 * Charset excludes ambiguous chars (no 0/O, 1/I/L).
 */
import { getDb } from '../db';

const SHARE_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateShareCode(): string {
  let code = '';
  for (let i = 0; i < 5; i += 1) {
    code += SHARE_CODE_CHARS.charAt(Math.floor(Math.random() * SHARE_CODE_CHARS.length));
  }
  return code;
}

/** Generate a share code not already present in the apps table. */
export function generateUniqueShareCode(): string {
  for (let i = 0; i < 50; i += 1) {
    const code = generateShareCode();
    const exists = getDb().prepare('select 1 from apps where id = ?').get(code);
    if (!exists) return code;
  }
  throw new Error('share code space exhausted');
}
