/**
 * Per-user SSH hosts for the agent. DashTerm generates an ed25519 keypair per
 * host; the user installs the public key on the target. Claude reaches a host
 * from its Bash tool as `ssh <alias> 'command'`.
 *
 * To make `ssh <alias>` resolve without touching the user's real ~/.ssh, we
 * keep everything under the data dir and put tiny `ssh`/`scp` wrapper scripts
 * on the claude child's PATH that force `-F <managed ssh_config>`:
 *
 *   <dataDir>/agent-ssh/<uid>/
 *     hosts.json        # { "<alias>": { host, port, user, keyType, createdAt } }
 *     ssh_config        # generated from hosts.json
 *     known_hosts       # accept-new lands host keys here, not the user's file
 *     keys/<alias>(.pub)
 *     bin/ssh, bin/scp  # exec the real ssh/scp with -F ssh_config
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { GatewayConfig } from '../config';

export interface HostRecord {
  host: string;
  port: number;
  user: string | null;
  keyType: string;
  createdAt: number;
}

export interface HostSummary {
  alias: string;
  host: string;
  port: number;
  user: string | null;
  keyType: string;
  hasKey: boolean;
  createdAt: number | null;
}

// Mirrors the client's validation (AgenticCoder/index.tsx). All of these get
// written into ssh_config, so the regexes also serve as config-injection
// guards (no newlines / shell metacharacters reach the file).
const ALIAS_RE = /^[a-z0-9][a-z0-9_.-]{0,31}$/;
const HOST_RE = /^[A-Za-z0-9_.\-:[\]]{1,255}$/;
const USER_RE = /^[A-Za-z0-9_.\-]{1,64}$/;

function realBin(name: string): string {
  for (const dir of ['/usr/bin', '/bin', '/usr/local/bin', '/opt/homebrew/bin']) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return `/usr/bin/${name}`;
}

export function sshUserDir(config: GatewayConfig, uid: string): string {
  if (uid.includes('/') || uid.includes('..')) throw new Error('invalid uid');
  return path.join(config.dataDir, 'agent-ssh', uid);
}

export function sshBinDir(config: GatewayConfig, uid: string): string {
  return path.join(sshUserDir(config, uid), 'bin');
}

function hostsFile(dir: string): string {
  return path.join(dir, 'hosts.json');
}

function readHosts(dir: string): Record<string, HostRecord> {
  try {
    return JSON.parse(fs.readFileSync(hostsFile(dir), 'utf8')) as Record<string, HostRecord>;
  } catch {
    return {};
  }
}

function writeHosts(dir: string, hosts: Record<string, HostRecord>): void {
  const tmp = `${hostsFile(dir)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(hosts, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, hostsFile(dir));
}

function keyPath(dir: string, alias: string): string {
  return path.join(dir, 'keys', alias);
}

function regenerateSshConfig(dir: string, hosts: Record<string, HostRecord>): void {
  const knownHosts = path.join(dir, 'known_hosts');
  const blocks = Object.entries(hosts).map(([alias, h]) => {
    const lines = [
      `Host ${alias}`,
      `    HostName ${h.host}`,
      `    Port ${h.port}`,
    ];
    if (h.user) lines.push(`    User ${h.user}`);
    lines.push(
      `    IdentityFile ${keyPath(dir, alias)}`,
      `    IdentitiesOnly yes`,
      `    StrictHostKeyChecking accept-new`,
      `    UserKnownHostsFile ${knownHosts}`,
      // Non-interactive: never prompt for a password — fail fast instead of
      // hanging claude's Bash call when key auth isn't set up on the target.
      `    BatchMode yes`,
      `    ConnectTimeout 10`,
    );
    return lines.join('\n');
  });
  const header = '# Managed by DashTerm — do not edit by hand.\n';
  fs.writeFileSync(path.join(dir, 'ssh_config'), header + blocks.join('\n\n') + '\n', { mode: 0o600 });
}

function writeWrappers(dir: string): void {
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const cfg = path.join(dir, 'ssh_config');
  for (const name of ['ssh', 'scp']) {
    const wrapper = `#!/bin/sh\nexec ${realBin(name)} -F ${JSON.stringify(cfg)} "$@"\n`;
    const p = path.join(binDir, name);
    fs.writeFileSync(p, wrapper, { mode: 0o755 });
  }
}

/** Idempotent: ensure the dir, wrappers, and a config matching hosts.json. */
export function ensureSshScaffold(config: GatewayConfig, uid: string): void {
  const dir = sshUserDir(config, uid);
  fs.mkdirSync(path.join(dir, 'keys'), { recursive: true, mode: 0o700 });
  const hosts = readHosts(dir);
  regenerateSshConfig(dir, hosts);
  writeWrappers(dir);
}

export function listHosts(config: GatewayConfig, uid: string): HostSummary[] {
  const dir = sshUserDir(config, uid);
  const hosts = readHosts(dir);
  return Object.entries(hosts)
    .map(([alias, h]) => ({
      alias,
      host: h.host,
      port: h.port,
      user: h.user ?? null,
      keyType: h.keyType || 'ed25519',
      hasKey: fs.existsSync(keyPath(dir, alias)) && fs.existsSync(`${keyPath(dir, alias)}.pub`),
      createdAt: h.createdAt ?? null,
    }))
    .sort((a, b) => a.alias.localeCompare(b.alias));
}

export function addHost(
  config: GatewayConfig,
  uid: string,
  input: { alias: string; host: string; port?: number; user?: string | null },
): { alias: string; pubkey: string } {
  const alias = (input.alias || '').trim();
  const host = (input.host || '').trim();
  const port = input.port ?? 22;
  const user = input.user ? String(input.user).trim() : null;

  if (!ALIAS_RE.test(alias)) throw new Error('alias must be lowercase [a-z0-9_.-], start alphanumeric, max 32 chars');
  if (!HOST_RE.test(host)) throw new Error('invalid host');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid port');
  if (user !== null && !USER_RE.test(user)) throw new Error('invalid user');

  const dir = sshUserDir(config, uid);
  fs.mkdirSync(path.join(dir, 'keys'), { recursive: true, mode: 0o700 });
  const hosts = readHosts(dir);
  if (hosts[alias]) throw new Error(`host "${alias}" already exists — remove it first`);

  const kp = keyPath(dir, alias);
  // Fresh key only — refuse to clobber an orphaned key file.
  for (const f of [kp, `${kp}.pub`]) if (fs.existsSync(f)) fs.rmSync(f);
  execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-f', kp, '-C', `dashterm:${uid}:${alias}`, '-q'], {
    stdio: 'ignore',
  });
  fs.chmodSync(kp, 0o600);

  hosts[alias] = { host, port, user, keyType: 'ed25519', createdAt: Date.now() };
  writeHosts(dir, hosts);
  regenerateSshConfig(dir, hosts);
  writeWrappers(dir);

  const pubkey = fs.readFileSync(`${kp}.pub`, 'utf8').trim();
  return { alias, pubkey };
}

export function removeHost(config: GatewayConfig, uid: string, alias: string): void {
  const dir = sshUserDir(config, uid);
  const hosts = readHosts(dir);
  if (!hosts[alias]) throw new Error(`unknown host "${alias}"`);
  delete hosts[alias];
  const kp = keyPath(dir, alias);
  for (const f of [kp, `${kp}.pub`]) if (fs.existsSync(f)) fs.rmSync(f);
  writeHosts(dir, hosts);
  regenerateSshConfig(dir, hosts);
}

export function getHostPubkey(config: GatewayConfig, uid: string, alias: string): string {
  const dir = sshUserDir(config, uid);
  const pub = `${keyPath(dir, alias)}.pub`;
  if (!fs.existsSync(pub)) throw new Error(`no key for host "${alias}"`);
  return fs.readFileSync(pub, 'utf8').trim();
}
