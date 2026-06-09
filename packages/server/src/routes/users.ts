/**
 * /api/users — admin-only user management.
 *
 * Non-admin GET returns just their own row; admin GET returns everyone.
 * DELETE is admin-only and refuses self-delete.
 */

import type { FastifyInstance } from 'fastify';
import { getDb } from '../db';
import { requireUser } from './auth';
import type { GatewayConfig } from '../config';

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  is_admin: number;
  created_at: number;
  last_active: number;
}

function summary(row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name || row.email,
    isAdmin: row.is_admin === 1,
    createdAt: row.created_at,
    lastActive: row.last_active,
  };
}

export async function registerUserRoutes(app: FastifyInstance, config: GatewayConfig) {
  // GET /api/users — list. Non-admin sees only self.
  app.get('/api/users', async (req, reply) => {
    const me = requireUser(req, reply, config);
    if (!me) return;

    if (me.is_admin !== 1) {
      return { users: [summary(me)] };
    }
    const rows = getDb()
      .prepare<[], UserRow>(
        'select id, email, display_name, is_admin, created_at, last_active from users order by created_at asc',
      )
      .all();
    return { users: rows.map(summary) };
  });

  // DELETE /api/users/:id — admin-only, refuses self-delete.
  app.delete<{ Params: { id: string } }>('/api/users/:id', async (req, reply) => {
    const me = requireUser(req, reply, config);
    if (!me) return;
    if (me.is_admin !== 1) {
      return reply.code(403).send({ error: 'admin only' });
    }
    if (req.params.id === me.id) {
      return reply.code(400).send({ error: 'cannot delete your own account' });
    }
    const result = getDb().prepare('delete from users where id = ?').run(req.params.id);
    if (result.changes === 0) {
      return reply.code(404).send({ error: 'user not found' });
    }
    return { ok: true };
  });
}
