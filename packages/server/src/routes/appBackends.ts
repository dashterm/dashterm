/**
 * ALL /api/x/:shareCode/* — the single catch-all that fronts every
 * agent-authored backend. Fastify can't mount routes dynamically after listen,
 * so this one route dispatches into the in-memory backendRegistry.
 *
 * Auth: same cookie + JWT as the rest of the API. v1 is OWNER-ONLY — a backend
 * runs only when the caller owns the app, and always with the owner's keys /
 * secrets. That keeps the cross-user share-code path safe: another user can add
 * a shared app's *frontend*, but its backend won't execute for them.
 */
import type { FastifyInstance } from 'fastify';
import { requireUser } from './auth';
import type { GatewayConfig } from '../config';
import { dispatch, getBackendOwner } from '../agent/backendRegistry';

export async function registerAppBackendRoutes(app: FastifyInstance, config: GatewayConfig) {
  app.all<{ Params: { shareCode: string; '*': string } }>(
    '/api/x/:shareCode/*',
    async (req, reply) => {
      const user = requireUser(req, reply, config);
      if (!user) return;

      const shareCode = req.params.shareCode;
      const owner = getBackendOwner(shareCode);
      if (!owner) return reply.code(404).send({ error: 'no backend for this app' });
      if (owner !== user.id) return reply.code(403).send({ error: 'backend is owner-only' });

      const result = await dispatch({
        config,
        shareCode,
        method: req.method,
        subpath: req.params['*'] ?? '',
        query: (req.query as Record<string, unknown>) ?? {},
        body: req.body ?? null,
        headers: (req.headers as Record<string, unknown>) ?? {},
      }).catch((err: Error) => ({ status: 500, body: { error: err.message } }));

      if (!result) return reply.code(404).send({ error: 'no backend for this app' });
      return reply.code(result.status).send(result.body);
    },
  );
}
