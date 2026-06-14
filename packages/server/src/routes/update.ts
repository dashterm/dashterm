/**
 * /api/update — self-update status + apply for native (git-checkout) installs.
 *
 *   GET  /api/update/status  any signed-in user; returns version status +
 *                            `canApply` (true only for admins on a daemon install)
 *   POST /api/update/check   admin-only; forces a fresh remote check
 *   POST /api/update/run     admin-only; spawns the detached updater, returns 202
 *
 * The heavy lifting (git compare, detached handoff) lives in ../infra/update.
 * `/run` returns immediately — the updater stops, rebuilds, and restarts the
 * gateway out-of-process, so progress is observed via the WS `update:available`
 * broadcast and polling /status, not this response.
 */

import type { FastifyInstance } from 'fastify';
import { requireUser } from './auth';
import type { GatewayConfig } from '../config';
import { getUpdateStatus, isUpdateRunning, launchUpdater } from '../infra/update';

async function withCanApply(config: GatewayConfig, isAdmin: boolean, force: boolean) {
  const status = await getUpdateStatus(config, { force });
  return { ...status, canApply: isAdmin && status.supported && status.canRestart };
}

export async function registerUpdateRoutes(app: FastifyInstance, config: GatewayConfig) {
  app.get('/api/update/status', async (req, reply) => {
    const me = requireUser(req, reply, config);
    if (!me) return;
    return withCanApply(config, me.is_admin === 1, false);
  });

  app.post('/api/update/check', async (req, reply) => {
    const me = requireUser(req, reply, config);
    if (!me) return;
    if (me.is_admin !== 1) return reply.code(403).send({ error: 'admin only' });
    return withCanApply(config, true, true);
  });

  // NOTE: getUpdateStatus is awaited below — it now also fetches GitHub release
  // notes for the latest tag.

  app.post('/api/update/run', async (req, reply) => {
    const me = requireUser(req, reply, config);
    if (!me) return;
    if (me.is_admin !== 1) return reply.code(403).send({ error: 'admin only' });

    const status = await getUpdateStatus(config, { force: false });
    if (!status.supported) {
      return reply.code(409).send({ error: 'updates not supported for this install', reason: status.reason });
    }
    if (!status.canRestart) {
      return reply.code(409).send({ error: 'no daemon installed — run `dashterm update` manually' });
    }
    if (isUpdateRunning(config)) {
      return reply.code(409).send({ error: 'an update is already in progress' });
    }
    if (!status.available) {
      return reply.code(409).send({ error: 'already up to date' });
    }

    const res = launchUpdater(config);
    if (!res.started) {
      return reply.code(500).send({ error: res.reason || 'failed to start updater' });
    }
    return reply.code(202).send({ started: true, target: status.latestVersion });
  });
}
