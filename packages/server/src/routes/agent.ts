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
import { AgentSession, resolveSessionKey } from '../agent/session';
import { getSession } from '../agent/sessionRegistry';

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

    const uid = ctx.row.id;
    const name = ctx.row.display_name || ctx.row.email;
    let session: AgentSession | null = null;

    // On the auth handshake, re-attach to a still-running background session for
    // the same (user, workspace, agent) — so reconnecting after a phone lock
    // continues the live agent (whose turn kept running) instead of spawning a
    // duplicate. Only the first message is checked: a reconnect leads with `auth`.
    const tryAdopt = (raw: Buffer): boolean => {
      let msg: { type?: string; workspace?: unknown; agent?: unknown; resume?: unknown };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return false;
      }
      if (msg?.type !== 'auth') return false;
      const existing = getSession(resolveSessionKey(config, uid, msg.workspace, msg.agent));
      if (!existing || !existing.isAlive()) return false;
      // An explicit fresh-start request must not adopt a live session.
      if (msg.resume === false) {
        existing.dispose();
        return false;
      }
      session = existing;
      existing.attach(socket);
      existing.resendReady();
      return true;
    };

    socket.on('message', (raw: Buffer) => {
      if (!session && tryAdopt(raw)) return;
      if (!session) session = new AgentSession(socket, uid, name, config);
      session.onMessage(raw);
    });
    socket.on('close', () => session?.onDisconnect(socket));
    socket.on('error', () => session?.onDisconnect(socket));
  });
}
