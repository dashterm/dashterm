/** Tiny flag parser shared by the read-only / self-test commands.
 *  `--key value` → { key: 'value' }; a bare `--key` (no following value, or
 *  followed by another --flag) → { key: true }. Everything else is positional.
 *  Values that look like JSON or paths (e.g. `--body '{"a":1}'`, `/chat`) are
 *  fine because only a leading `--` starts a new flag. */
export function parseFlags(args: string[]): {
  positional: string[];
  flags: Record<string, string | true>;
} {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

export function fmtTimestamp(ms: number): string {
  if (!ms) return '—';
  return new Date(ms).toISOString().slice(0, 16);
}
