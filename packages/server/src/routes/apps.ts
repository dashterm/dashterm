/**
 * /api/apps — vibe-coded custom apps stored in the shared `apps` table.
 *
 * For v0 every signed-in user can read every app (matches the
 * Supabase-side behaviour where the apps collection is share-code-keyed).
 * Writes require ownership; admins can write anything.
 *
 * The dashboard expects the same shape as the Supabase StorageProvider:
 *   { id, name, description, code, compiledCode, functions, queryableData,
 *     ownerId, ownerName, visibility, createdAt, updatedAt, version, category }
 */

import type { FastifyInstance } from 'fastify';
import { getDb } from '../db';
import { broadcastApps } from '../realtime';
import { requireUser } from './auth';
import type { GatewayConfig } from '../config';

interface AppRow {
  id: string;
  name: string;
  description: string;
  code: string;
  compiled_code: string | null;
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
