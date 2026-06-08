/**
 * Share Code Utilities
 * Generates and validates 5-character alphanumeric share codes for apps.
 */

// Characters that are unambiguous (no 0/O, 1/I/L confusion)
const SHARE_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * Generate a random 5-character share code
 */
export function generateShareCode(): string {
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += SHARE_CODE_CHARS.charAt(Math.floor(Math.random() * SHARE_CODE_CHARS.length));
  }
  return code;
}

/**
 * Validate a share code format
 */
export function isValidShareCode(code: string): boolean {
  if (!code || code.length !== 5) return false;
  return code.split('').every(char => SHARE_CODE_CHARS.includes(char));
}

/**
 * Format a share code for display (already uppercase, but ensures consistency)
 */
export function formatShareCode(code: string): string {
  return code.toUpperCase().slice(0, 5);
}
