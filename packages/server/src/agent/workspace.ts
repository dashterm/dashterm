/**
 * Per-user agent workspace storage on the filesystem. No DB table — workspace,
 * session, and push metadata live as JSON sidecars under:
 *
 *   <config.agentRoot>/<uid>/<workspace>/
 *     apps/                  # claude writes apps/<slug>.tsx (+ optional .json)
 *     .session.json          # { lastSessionId, createdAt, lastActivityAt }
 *     .pushmap.json          # { "<slug>": "<shareCode>" }
 *
 * uid always comes from the authenticated cookie, never the client. Workspace
 * names are validated before being used as a path segment.
 */
import fs from 'fs';
import path from 'path';
import type { GatewayConfig } from '../config';

export const DEFAULT_WORKSPACE = 'default';

export interface SessionMeta {
  lastSessionId?: string;
  createdAt?: number;
  lastActivityAt?: number;
}

export interface WorkspaceSummary {
  name: string;
  appCount: number;
  lastActivityAt: number | null;
  hasResumableSession: boolean;
  lastSessionId: string | null;
  createdAt: number | null;
}

// Mirrors the client's isValidWorkspaceName (AgenticCoder/index.tsx).
export function isValidWorkspaceName(name: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,31}$/.test(name);
}

export function workspaceDir(config: GatewayConfig, uid: string, workspace: string): string {
  if (!isValidWorkspaceName(workspace)) {
    throw new Error(`invalid workspace name: ${workspace}`);
  }
  // uid is a server-issued id; still guard against path escapes defensively.
  if (uid.includes('/') || uid.includes('..')) throw new Error('invalid uid');
  return path.join(config.agentRoot, uid, workspace);
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

export function ensureWorkspace(config: GatewayConfig, uid: string, workspace: string): string {
  const dir = workspaceDir(config, uid, workspace);
  fs.mkdirSync(path.join(dir, 'apps'), { recursive: true });
  const sessionFile = path.join(dir, '.session.json');
  if (!fs.existsSync(sessionFile)) {
    writeJsonAtomic(sessionFile, { createdAt: Date.now() } satisfies SessionMeta);
  }
  return dir;
}

export function readSession(dir: string): SessionMeta {
  return readJson<SessionMeta>(path.join(dir, '.session.json'), {});
}

export function writeSession(dir: string, patch: Partial<SessionMeta>): void {
  const current = readSession(dir);
  writeJsonAtomic(path.join(dir, '.session.json'), { ...current, ...patch });
}

export function readPushmap(dir: string): Record<string, string> {
  return readJson<Record<string, string>>(path.join(dir, '.pushmap.json'), {});
}

export function writePushmap(dir: string, map: Record<string, string>): void {
  writeJsonAtomic(path.join(dir, '.pushmap.json'), map);
}

function countApps(dir: string): number {
  try {
    return fs.readdirSync(path.join(dir, 'apps')).filter((f) => f.endsWith('.tsx')).length;
  } catch {
    return 0;
  }
}

export function listWorkspaces(config: GatewayConfig, uid: string): WorkspaceSummary[] {
  const root = path.join(config.agentRoot, uid);
  let names: string[];
  try {
    names = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && isValidWorkspaceName(e.name))
      .map((e) => e.name);
  } catch {
    return [];
  }
  return names
    .map((name) => {
      const dir = path.join(root, name);
      const session = readSession(dir);
      return {
        name,
        appCount: countApps(dir),
        lastActivityAt: session.lastActivityAt ?? session.createdAt ?? null,
        hasResumableSession: !!session.lastSessionId,
        lastSessionId: session.lastSessionId ?? null,
        createdAt: session.createdAt ?? null,
      };
    })
    .sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));
}

export function deleteWorkspace(config: GatewayConfig, uid: string, workspace: string): void {
  const dir = workspaceDir(config, uid, workspace);
  fs.rmSync(dir, { recursive: true, force: true });
}
