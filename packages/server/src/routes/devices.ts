/**
 * /api/devices — register/unregister the native app's push token.
 *
 *   POST   /api/devices   { token, platform? }   upsert the caller's Expo push token
 *   DELETE /api/devices   { token }              remove it (e.g. on sign-out)
 *
 * Auth: requires a signed-in user; tokens are scoped to me.id. The native app
 * calls these from inside the gateway WebView (same-origin session), so no
 * bearer token is involved. The token is passed in the body (not the path) —
 * Expo tokens contain `[`, `]`, and `/`, which are awkward in a path segment.
 */
import type { FastifyInstance } from 'fastify';
import { requireUser } from './auth';
import type { GatewayConfig } from '../config';
import { deleteDeviceToken, upsertDeviceToken } from '../notifications/registry';

const VALID_PLATFORM = new Set(['ios', 'android', '']);

export async function registerDevicesRoutes(app: FastifyInstance, config: GatewayConfig) {
  app.post<{ Body: { token?: string; platform?: string } }>(
    '/api/devices',
    async (req, reply) => {
      const me = requireUser(req, reply, config);
      if (!me) return;
      const token = req.body?.token;
      if (typeof token !== 'string' || token.length === 0) {
        return reply.code(400).send({ error: 'token is required' });
      }
      const platform = typeof req.body?.platform === 'string' ? req.body.platform : '';
      if (!VALID_PLATFORM.has(platform)) {
        return reply.code(400).send({ error: "platform must be 'ios', 'android', or omitted" });
      }
      upsertDeviceToken(me.id, token, platform);
      return { ok: true };
    },
  );

  app.delete<{ Body: { token?: string } }>('/api/devices', async (req, reply) => {
    const me = requireUser(req, reply, config);
    if (!me) return;
    const token = req.body?.token;
    if (typeof token !== 'string' || token.length === 0) {
      return reply.code(400).send({ error: 'token is required' });
    }
    const removed = deleteDeviceToken(me.id, token);
    if (!removed) return reply.code(404).send({ error: 'token not found' });
    return { ok: true };
  });
}
