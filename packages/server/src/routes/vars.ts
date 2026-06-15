/**
 * /api/vars/* — per-user variables: non-secret named config the owner can
 * read back and edit. The sibling to /api/secrets, with one deliberate
 * difference: GET returns the value.
 *
 *   GET    /api/vars            list the caller's variables WITH values
 *   PUT    /api/vars/:name      upsert a variable  { value }
 *   DELETE /api/vars/:name      delete a variable
 *
 * Use a variable for anything you want to see later (a base URL, a hostname);
 * use a secret for anything that must never leave the server. Both are
 * substituted into proxied requests by POST /api/secrets/proxy — {{var.NAME}}
 * and {{secret.NAME}} respectively.
 *
 * Auth: every route requires a signed-in user; everything is scoped to me.id,
 * so user A can never read or edit user B's variables.
 */

import type { FastifyInstance } from 'fastify';
import { requireUser } from './auth';
import type { GatewayConfig } from '../config';
import { deleteVar, listVars, upsertVar } from '../vars/registry';

/** Same grammar as secret names / the {{var.NAME}} placeholder. */
function validName(name: string): boolean {
  return /^[A-Za-z0-9_]{1,64}$/.test(name);
}

export async function registerVarsRoutes(app: FastifyInstance, config: GatewayConfig) {
  app.get('/api/vars', async (req, reply) => {
    const me = requireUser(req, reply, config);
    if (!me) return;
    return { vars: listVars(me.id) };
  });

  app.put<{ Params: { name: string }; Body: { value?: string } }>(
    '/api/vars/:name',
    async (req, reply) => {
      const me = requireUser(req, reply, config);
      if (!me) return;
      const name = req.params.name;
      if (!validName(name)) {
        return reply.code(400).send({ error: 'name must match [A-Za-z0-9_], 1-64 chars' });
      }
      const value = req.body?.value;
      if (typeof value !== 'string' || value.length === 0) {
        return reply.code(400).send({ error: 'value is required' });
      }
      return { var: upsertVar(me.id, name, value) };
    },
  );

  app.delete<{ Params: { name: string } }>('/api/vars/:name', async (req, reply) => {
    const me = requireUser(req, reply, config);
    if (!me) return;
    const removed = deleteVar(me.id, req.params.name);
    if (!removed) return reply.code(404).send({ error: 'variable not found' });
    return { ok: true };
  });
}
