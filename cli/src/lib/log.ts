const supportsColor = process.stdout.isTTY && process.env.TERM !== 'dumb' && !process.env.NO_COLOR;

const ansi = (code: string) => (text: string) =>
  supportsColor ? `\x1b[${code}m${text}\x1b[0m` : text;

export const c = {
  cyan: ansi('36'),
  green: ansi('32'),
  yellow: ansi('33'),
  red: ansi('31'),
  gray: ansi('90'),
  bold: ansi('1'),
  dim: ansi('2'),
};

export function info(...parts: unknown[]): void {
  console.log(...parts);
}

export function success(message: string): void {
  console.log(`${c.green('✓')} ${message}`);
}

export function warn(message: string): void {
  console.warn(`${c.yellow('!')} ${message}`);
}

export function error(message: string): void {
  console.error(`${c.red('✗')} ${message}`);
}

export function step(message: string): void {
  console.log(`${c.cyan('›')} ${message}`);
}

export function box(lines: string[]): void {
  const width = Math.max(...lines.map((l) => stripAnsi(l).length));
  const top = `┌${'─'.repeat(width + 2)}┐`;
  const bot = `└${'─'.repeat(width + 2)}┘`;
  console.log(c.cyan(top));
  for (const line of lines) {
    const padding = ' '.repeat(width - stripAnsi(line).length);
    console.log(`${c.cyan('│')} ${line}${padding} ${c.cyan('│')}`);
  }
  console.log(c.cyan(bot));
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}
