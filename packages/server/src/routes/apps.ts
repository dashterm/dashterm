/**
 * /api/apps — vibe-coded custom apps stored in the shared `apps` table.
 *
 * For v0 every signed-in user can read every app (the apps collection is
 * share-code-keyed). Writes require ownership; admins can write anything.
 *
 * The dashboard expects the StorageProvider's app shape:
 *   { id, name, description, code, compiledCode, functions, queryableData,
 *     ownerId, ownerName, visibility, createdAt, updatedAt, version, category }
 */

import type { FastifyInstance } from 'fastify';
import { getDb } from '../db';
import { broadcastApps } from '../realtime';
import { requireUser } from './auth';
import type { GatewayConfig } from '../config';
import { compileTypeScriptCode } from '../compilation/codeCompiler';
import { compileBackendCode } from '../compilation/backendCompiler';
import { generateUniqueShareCode } from '../agent/shareCode';
import { loadBackend, unloadBackend } from '../agent/backendRegistry';

interface AppRow {
  id: string;
  name: string;
  description: string;
  code: string;
  compiled_code: string | null;
  backend_code: string | null;
  backend_compiled: string | null;
  functions: string;
  queryable_data: string;
  owner_id: string;
  owner_name: string;
  visibility: string;
  category: string | null;
  version: number;
  created_at: number;
  updated_at: number;
}

// Portable, self-contained app bundle (a `.dashapp.json` file). Carries the
// *source* only — never the compiled blobs or install-local fields (owner,
// visibility, version, timestamps). The importer recompiles from source so a
// hand-edited or malicious compiled blob can't be smuggled in.
const APP_EXPORT_FORMAT = 'dashterm-app/1';

interface AppExport {
  format: typeof APP_EXPORT_FORMAT;
  exportedAt: number;
  sourceId: string; // original share code — provenance only, not authoritative
  name: string;
  description: string;
  category: string | null;
  code: string;
  backendCode: string | null;
  hasBackend: boolean;
  functions: unknown;
  queryableData: unknown;
}

function parseJsonArray(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// A share code in the canonical charset (see agent/shareCode.ts). Length is
// kept loose (5 today, room for 6+ as the catalog grows) so a bundle minted by
// a newer version still validates. Used to decide whether an imported bundle's
// sourceId can be honoured verbatim.
const SHARE_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5,8}$/;

function fromRow(row: AppRow) {
  let functions: unknown = [];
  let queryableData: unknown = [];
  try {
    functions = JSON.parse(row.functions);
  } catch {
    /* empty */
  }
  try {
    queryableData = JSON.parse(row.queryable_data);
  } catch {
    /* empty */
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    code: row.code,
    compiledCode: row.compiled_code,
    functions,
    queryableData,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    visibility: row.visibility,
    category: row.category,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface AppPayload {
  id?: string;
  name?: string;
  description?: string;
  code?: string;
  compiledCode?: string | null;
  functions?: unknown;
  queryableData?: unknown;
  ownerName?: string;
  visibility?: string;
  category?: string | null;
  version?: number;
}

export async function registerAppsRoutes(app: FastifyInstance, config: GatewayConfig) {
  // GET /api/apps — list all (the dashboard filters by ownerId client-side).
  app.get('/api/apps', async (req, reply) => {
    const me = requireUser(req, reply, config);
    if (!me) return;
    const rows = getDb()
      .prepare<[], AppRow>('select * from apps order by updated_at desc')
      .all();
    return { apps: rows.map(fromRow) };
  });

  // GET /api/apps/:shareCode — single
  app.get<{ Params: { shareCode: string } }>('/api/apps/:shareCode', async (req, reply) => {
    const me = requireUser(req, reply, config);
    if (!me) return;
    const row = getDb()
      .prepare<[string], AppRow>('select * from apps where id = ?')
      .get(req.params.shareCode);
    if (!row) return reply.code(404).send({ error: 'not found' });
    return { app: fromRow(row) };
  });

  // GET /api/apps/:shareCode/export — download a portable bundle.
  // Private apps export only for the owner/admin; unlisted/public export for
  // anyone signed in (that's the point of sharing). The bundle is source-only.
  app.get<{ Params: { shareCode: string } }>(
    '/api/apps/:shareCode/export',
    async (req, reply) => {
      const me = requireUser(req, reply, config);
      if (!me) return;
      const row = getDb()
        .prepare<[string], AppRow>('select * from apps where id = ?')
        .get(req.params.shareCode);
      if (!row) return reply.code(404).send({ error: 'not found' });
      if (row.visibility === 'private' && row.owner_id !== me.id && me.is_admin !== 1) {
        return reply.code(403).send({ error: 'app is private' });
      }
      const manifest: AppExport = {
        format: APP_EXPORT_FORMAT,
        exportedAt: Date.now(),
        sourceId: row.id,
        name: row.name,
        description: row.description,
        category: row.category,
        code: row.code,
        backendCode: row.backend_code ?? null,
        hasBackend: !!(row.backend_code && row.backend_code.trim()),
        functions: parseJsonArray(row.functions),
        queryableData: parseJsonArray(row.queryable_data),
      };
      return { manifest };
    },
  );

  // POST /api/apps/import — create a new app from a bundle. The importer
  // becomes the owner, a fresh share code is minted (the source code may still
  // exist / be owned by someone else), and the app starts private. The source
  // is recompiled here — we never trust an imported compiled blob.
  //
  // `trusted` MUST be true: imported code runs in the importer's browser
  // (frontend) and, if a backend module is present, in the gateway process
  // (server). The dashboard gates this behind an explicit "Trust this app"
  // acknowledgement; we require the flag server-side too so no path imports
  // un-acknowledged code.
  app.post<{ Body: { manifest?: Partial<AppExport>; trusted?: boolean; visibility?: string } }>(
    '/api/apps/import',
    async (req, reply) => {
      const me = requireUser(req, reply, config);
      if (!me) return;
      const body = req.body || {};
      const manifest = body.manifest;
      if (body.trusted !== true) {
        return reply.code(400).send({ error: 'import requires explicit trust acknowledgement' });
      }
      if (!manifest || typeof manifest !== 'object') {
        return reply.code(400).send({ error: 'missing app bundle' });
      }
      if (manifest.format !== APP_EXPORT_FORMAT) {
        return reply
          .code(400)
          .send({ error: `unsupported bundle format (expected ${APP_EXPORT_FORMAT})` });
      }
      const code = typeof manifest.code === 'string' ? manifest.code : '';
      if (!code.trim()) {
        return reply.code(400).send({ error: 'bundle has no app code' });
      }
      const name =
        typeof manifest.name === 'string' && manifest.name.trim() ? manifest.name.trim() : 'Imported App';

      // Recompile the frontend from source. A failure here means we never
      // store an app that can't render.
      const compiled = await compileTypeScriptCode(code, name);
      if (!compiled.success) {
        return reply.code(400).send({
          error: 'app code failed to compile',
          details: [compiled.error, ...(compiled.details ?? [])].filter(Boolean),
        });
      }

      // Recompile the optional backend. A compile failure aborts the whole
      // import rather than mounting a half-broken app.
      const backendCode =
        typeof manifest.backendCode === 'string' && manifest.backendCode.trim()
          ? manifest.backendCode
          : null;
      let backendCompiled: string | null = null;
      if (backendCode) {
        const bc = await compileBackendCode(backendCode, name);
        if (!bc.success || !bc.compiled) {
          return reply.code(400).send({
            error: 'backend code failed to compile',
            details: [bc.error, ...(bc.details ?? [])].filter(Boolean),
          });
        }
        backendCompiled = bc.compiled;
      }

      // Keep the app's identity stable across installs: honour the bundle's
      // original share code so the same app has the same ID everywhere (the
      // basis for "install app K7XM2" in a future marketplace). Fall back to a
      // fresh code only if the bundle predates share codes or carries a junk id.
      const sourceId = typeof manifest.sourceId === 'string' ? manifest.sourceId : '';
      const shareCode = SHARE_CODE_RE.test(sourceId) ? sourceId : generateUniqueShareCode();

      // Does that code already live on this gateway? Three cases:
      //  - free            → insert a new row (version 1)
      //  - mine (or admin) → update in place (re-import / pull newer), bump version
      //  - someone else's  → refuse; the PK is global and we won't clobber another
      //                      user's app. (The marketplace will resolve this with a
      //                      catalog/per-user-install split; a file import can't.)
      const existing = getDb()
        .prepare<[string], { owner_id: string; version: number; created_at: number; visibility: string }>(
          'select owner_id, version, created_at, visibility from apps where id = ?',
        )
        .get(shareCode);
      if (existing && existing.owner_id !== me.id && me.is_admin !== 1) {
        return reply.code(409).send({
          error: `app ${shareCode} already exists on this gateway and is owned by someone else`,
          shareCode,
          conflict: true,
        });
      }

      const now = Date.now();
      const visibility =
        body.visibility === 'public' || body.visibility === 'unlisted'
          ? body.visibility
          : existing?.visibility ?? 'private';
      const version = existing ? existing.version + 1 : 1;
      const row = {
        id: shareCode,
        name,
        description: typeof manifest.description === 'string' ? manifest.description : '',
        code,
        compiled_code: compiled.compiledCode ?? null,
        backend_code: backendCode,
        backend_compiled: backendCompiled,
        functions: JSON.stringify(Array.isArray(manifest.functions) ? manifest.functions : []),
        queryable_data: JSON.stringify(
          Array.isArray(manifest.queryableData) ? manifest.queryableData : [],
        ),
        owner_id: me.id,
        owner_name: me.display_name ?? me.email,
        visibility,
        category: typeof manifest.category === 'string' ? manifest.category : null,
        version,
        created_at: existing?.created_at ?? now,
        updated_at: now,
      };
      getDb()
        .prepare(
          `insert into apps
             (id, name, description, code, compiled_code, backend_code, backend_compiled,
              functions, queryable_data,
              owner_id, owner_name, visibility, category, version, created_at, updated_at)
           values (@id, @name, @description, @code, @compiled_code, @backend_code, @backend_compiled,
                   @functions, @queryable_data,
                   @owner_id, @owner_name, @visibility, @category, @version, @created_at, @updated_at)
           on conflict(id) do update set
             name = excluded.name,
             description = excluded.description,
             code = excluded.code,
             compiled_code = excluded.compiled_code,
             backend_code = excluded.backend_code,
             backend_compiled = excluded.backend_compiled,
             functions = excluded.functions,
             queryable_data = excluded.queryable_data,
             owner_name = excluded.owner_name,
             visibility = excluded.visibility,
             category = excluded.category,
             version = excluded.version,
             updated_at = excluded.updated_at`,
        )
        .run(row);

      if (backendCompiled) {
        const res = loadBackend({ shareCode, ownerId: me.id, compiled: backendCompiled, version });
        if (!res.ok) {
          // The row is stored; the backend just isn't mounted. Surface it so
          // the user knows the server side won't respond.
          req.log.warn(`import: backend load failed for ${shareCode}: ${res.error}`);
        }
      } else {
        unloadBackend(shareCode);
      }

      broadcastApps({ type: 'apps:changed', op: 'put', shareCode });
      return { shareCode, name, hasBackend: !!backendCompiled, updated: !!existing };
    },
  );

  // PUT /api/apps/:shareCode — upsert. Must own (or be admin) on update.
  app.put<{ Params: { shareCode: string }; Body: AppPayload }>(
    '/api/apps/:shareCode',
    async (req, reply) => {
      const me = requireUser(req, reply, config);
      if (!me) return;
      const code = req.params.shareCode;
      const body = req.body || {};
      const existing = getDb()
        .prepare<[string], AppRow>('select * from apps where id = ?')
        .get(code);
      if (existing && existing.owner_id !== me.id && me.is_admin !== 1) {
        return reply.code(403).send({ error: 'not the owner' });
      }
      const now = Date.now();
      const row = {
        id: code,
        name: body.name ?? existing?.name ?? code,
        description: body.description ?? existing?.description ?? '',
        code: body.code ?? existing?.code ?? '',
        compiled_code: body.compiledCode ?? existing?.compiled_code ?? null,
        functions: JSON.stringify(body.functions ?? (existing ? JSON.parse(existing.functions) : [])),
        queryable_data: JSON.stringify(
          body.queryableData ?? (existing ? JSON.parse(existing.queryable_data) : []),
        ),
        owner_id: existing?.owner_id ?? me.id,
        owner_name: body.ownerName ?? existing?.owner_name ?? me.display_name ?? me.email,
        visibility: body.visibility ?? existing?.visibility ?? 'private',
        category: body.category ?? existing?.category ?? null,
        version: body.version ?? (existing?.version ?? 1),
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
             functions = excluded.functions,
             queryable_data = excluded.queryable_data,
             owner_name = excluded.owner_name,
             visibility = excluded.visibility,
             category = excluded.category,
             version = excluded.version,
             updated_at = excluded.updated_at`,
        )
        .run(row);
      // Tabs that subscribe to /api/apps re-fetch on this signal. We send
      // the share-code so a tab can choose to fetch one row instead of the
      // whole list if it prefers.
      broadcastApps({ type: 'apps:changed', op: 'put', shareCode: code });
      return { ok: true };
    },
  );

  // DELETE /api/apps/:shareCode — owner or admin.
  app.delete<{ Params: { shareCode: string } }>(
    '/api/apps/:shareCode',
    async (req, reply) => {
      const me = requireUser(req, reply, config);
      if (!me) return;
      const existing = getDb()
        .prepare<[string], AppRow>('select * from apps where id = ?')
        .get(req.params.shareCode);
      if (!existing) return reply.code(404).send({ error: 'not found' });
      if (existing.owner_id !== me.id && me.is_admin !== 1) {
        return reply.code(403).send({ error: 'not the owner' });
      }
      getDb().prepare('delete from apps where id = ?').run(req.params.shareCode);
      broadcastApps({ type: 'apps:changed', op: 'delete', shareCode: req.params.shareCode });
      return { ok: true };
    },
  );
}
