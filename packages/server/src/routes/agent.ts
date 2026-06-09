/**
 * /api/agent/ws — WebSocket the AgenticCoder/Scheduler apps connect to. The
 * gateway plays the role the old external "relay" did: it spawns `claude` to
 * vibe-code apps and streams its events back. Auth is the same cookie + JWT
 * path as the REST routes (no bearer token).
 *
 * Gated by config.agentEnabled: when off, the route refuses connections so the
 * dangerous bypassPermissions claude spawn is strictly opt-in. /api/agent/health
 * is always present (the client's Settings panel probes it).
 */
import type { FastifyInstance } from 'fastify';
import { getUserFromRequest } from './auth';
import type { GatewayConfig } from '../config';
import { AgentSession } from '../agent/session';

export async function registerAgentRoutes(app: FastifyInstance, config: GatewayConfig) {
  app.get('/api/agent/health', async () =>
    config.agentEnabled
      ? { ok: true, service: 'dashterm-agent' }
      : { ok: false, service: 'dashterm-agent', disabled: true },
  );

  app.get('/api/agent/ws', { websocket: true }, (socket, req) => {
    const ctx = getUserFromRequest(req, config);
    if (!ctx) {
      socket.close(4401, 'unauthorized');
      return;
    }
    if (!config.agentEnabled) {
      try {
        socket.send(JSON.stringify({ type: 'error', error: 'agent disabled by operator' }));
      } catch {
        /* ignore */
      }
      socket.close(4403, 'agent disabled');
      return;
    }

    const session = new AgentSession(
      socket,
      ctx.row.id,
      ctx.row.display_name || ctx.row.email,
      config,
    );
    socket.on('message', (raw: Buffer) => session.onMessage(raw));
    socket.on('close', () => session.dispose());
    socket.on('error', () => session.dispose());
  });
}
