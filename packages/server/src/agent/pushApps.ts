/**
 * After each claude turn, scan the workspace's apps/ dir for changed
 * apps/<slug>.tsx files, compile them, and upsert into the shared `apps`
 * table — the same shape the dashboard reads via /api/apps. Mirrors the
 * upsert in routes/apps.ts (PUT) and broadcasts the change to open tabs.
 */
import fs from 'fs';
import path from 'path';
import { getDb } from '../db';
import { broadcastApps } from '../realtime';
import { compileTypeScriptCode } from '../compilation/codeCompiler';
import { generateUniqueShareCode } from './shareCode';
import { readPushmap, writePushmap } from './workspace';

export interface PushedApp {
  shareCode: string;
  name: string;
  version: number;
}

export interface PushError {
  file: string;
  error: string;
}

export interface PushResult {
  pushed: PushedApp[];
  errors: PushError[];
}

interface ExistingApp {
  owner_id: string;
  version: number;
  created_at: number;
}

interface AppMeta {
  name: string;
  description: string;
  category: string | null;
}

// Metadata comes from an apps/<slug>.json sidecar (wins) or leading
// `// name:` / `// description:` / `// category:` comments in the .tsx.
function readMeta(appsDir: string, slug: string, code: string): AppMeta {
  const sidecar = path.join(appsDir, `${slug}.json`);
  let name = slug;
  let description = '';
  let category: string | null = null;
  try {
    const raw = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
    if (typeof raw?.name === 'string' && raw.name.trim()) name = raw.name.trim();
    if (typeof raw?.description === 'string') description = raw.description;
    if (typeof raw?.category === 'string') category = raw.category;
    return { name, description, category };
  } catch {
    /* no sidecar — fall through to comment scan */
  }
  for (const line of code.split('\n').slice(0, 12)) {
    const m = line.match(/^\s*\/\/\s*(name|description|category)\s*:\s*(.+?)\s*$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (key === 'name') name = m[2];
    else if (key === 'description') description = m[2];
    else if (key === 'category') category = m[2];
  }
  return { name, description, category };
}

export async function pushChangedApps(args: {
  uid: string;
  ownerName: string;
  dir: string;
  sinceMs: number;
}): Promise<PushResult> {
  const { uid, ownerName, dir, sinceMs } = args;
  const appsDir = path.join(dir, 'apps');
  const pushed: PushedApp[] = [];
  const errors: PushError[] = [];

  let files: string[];
  try {
    files = fs.readdirSync(appsDir).filter((f) => f.endsWith('.tsx'));
  } catch {
    return { pushed, errors };
  }

  const pushmap = readPushmap(dir);
  let pushmapDirty = false;

  for (const file of files) {
    const full = path.join(appsDir, file);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    // Small slack (1s) so a write that lands just before turnStart still pushes.
    if (stat.mtimeMs < sinceMs - 1000) continue;

    const rel = `apps/${file}`;
    const slug = file.replace(/\.tsx$/, '');
    let code: string;
    try {
      code = fs.readFileSync(full, 'utf8');
    } catch (err) {
      errors.push({ file: rel, error: (err as Error).message });
      continue;
    }
    if (!code.trim()) continue;

    const meta = readMeta(appsDir, slug, code);
    const compiled = await compileTypeScriptCode(code, meta.name);
    if (!compiled.success) {
      errors.push({
        file: rel,
        error: [compiled.error, ...(compiled.details ?? [])].filter(Boolean).join('\n'),
      });
      continue;
    }

    // Resolve a stable share code for this slug within the workspace.
    let shareCode = pushmap[slug];
    if (!shareCode) {
      shareCode = generateUniqueShareCode();
      pushmap[slug] = shareCode;
      pushmapDirty = true;
    }

    const existing = getDb()
      .prepare<[string], ExistingApp>(
        'select owner_id, version, created_at from apps where id = ?',
      )
      .get(shareCode);
    if (existing && existing.owner_id !== uid) {
      errors.push({ file: rel, error: `share code ${shareCode} is owned by another user` });
      continue;
    }

    const now = Date.now();
    const version = existing ? existing.version + 1 : 1;
    const row = {
      id: shareCode,
      name: meta.name,
      description: meta.description,
      code,
      compiled_code: compiled.compiledCode ?? null,
      functions: '[]',
      queryable_data: '[]',
      owner_id: uid,
      owner_name: ownerName,
      visibility: 'private',
      category: meta.category,
      version,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    getDb()
      .prepare(
        `insert into apps
           (id, name, description, code, compiled_code, functions, queryable_data,
            owner_id, owner_name, visibility, category, version, created_at, updated_at)
         values (@id, @name, @description, @code, @compiled_code, @functions, @queryable_data,
                 @owner_id, @owner_name, @visibility, @category, @version, @created_at, @updated_at)
         on conflict(id) do update set
           name = excluded.name,
           description = excluded.description,
           code = excluded.code,
           compiled_code = excluded.compiled_code,
           owner_name = excluded.owner_name,
           visibility = excluded.visibility,
           category = excluded.category,
           version = excluded.version,
           updated_at = excluded.updated_at`,
      )
      .run(row);
    broadcastApps({ type: 'apps:changed', op: 'put', shareCode });
    pushed.push({ shareCode, name: meta.name, version });
  }

  if (pushmapDirty) writePushmap(dir, pushmap);
  return { pushed, errors };
}
