/**
 * /api/ws — WebSocket upgrade for cross-tab state sync.
 *
 * Auth: same cookie + JWT path as the REST routes. Failed auth → close
 * with code 4401 ("unauthorized" in the application-defined 4000-4999
 * range; standard WebSocket close codes don't include "auth failed").
 *
 * The server only PUSHES events; it doesn't accept incoming messages
 * beyond the JSON-encoded ping. Tabs that want to change state still
 * go through PUT /api/state — the WS is one-way (server → client) for
 * everything except keepalive.
 */

import type { FastifyInstance } from 'fastify';
import { getUserFromRequest } from './auth';
import { registerSocket, unregisterSocket } from '../realtime';
import type { GatewayConfig } from '../config';

// @fastify/websocket is registered once at app level in index.ts so multiple
// routes can be `{ websocket: true }`. This module just declares the route.
export async function registerWsRoutes(app: FastifyInstance, config: GatewayConfig) {
  app.get('/api/ws', { websocket: true }, (socket, req) => {
    const ctx = getUserFromRequest(req, config);
    if (!ctx) {
      socket.close(4401, 'unauthorized');
      return;
    }
    const conn = registerSocket(socket, ctx.row.id);
    try {
      socket.send(JSON.stringify({ type: 'hello', uid: ctx.row.id }));
    } catch {
      /* socket may have closed already */
    }

    socket.on('message', (raw: Buffer) => {
      // Tabs only send pings. Anything else is silently ignored — the
      // state-mutation path is HTTP, not WS.
      try {
        const msg = JSON.parse(raw.toString());
        if (msg?.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong', at: Date.now() }));
        }
      } catch {
        /* malformed JSON: ignore */
      }
    });

    socket.on('close', () => {
      unregisterSocket(conn);
    });
    socket.on('error', () => {
      unregisterSocket(conn);
    });
  });
}
