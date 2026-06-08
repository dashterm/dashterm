/**
 * /api/state — per-user app state blob.
 *
 * The dashboard treats this as one big JSON document; we don't shred it
 * server-side. PUT replaces the whole blob (idempotent, the dashboard
 * already manages partial updates client-side before calling).
 */

import type { FastifyInstance } from 'fastify';
import { getDb } from '../db';
import { broadcastToUser } from '../realtime';
import { requireUser } from './auth';
import type { GatewayConfig } from '../config';

interface ProfileShape {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string | null;
  createdAt: number;
  lastActive: number;
  // operator-set bits
  metadata: Record<string, unknown>;
}

export async function registerStateRoutes(app: FastifyInstance, config: GatewayConfig) {
  // GET /api/state — { profile, appState } for the signed-in user.
  app.get('/api/state', async (req, reply) => {
    const user = requireUser(req, reply, config);
    if (!user) return;

    const stateRow = getDb()
      .prepare<[string], { state: string; last_updated: number } | undefined>(
        'select state, last_updated from app_state where user_id = ?',
      )
      .get(user.id);

    let appState: Record<string, unknown> = {};
    try {
      appState = stateRow ? (JSON.parse(stateRow.state) as Record<string, unknown>) : {};
    } catch {
      appState = {};
    }

    let metadata: Record<string, unknown> = {};
    try {
      metadata = JSON.parse(user.metadata) as Record<string, unknown>;
    } catch {
      metadata = {};
    }

    const profile: ProfileShape = {
      uid: user.id,
      email: user.email,
      displayName: user.display_name || user.email,
      photoURL: null,
      createdAt: user.created_at,
      lastActive: user.last_active,
      metadata,
    };

    return {
      profile,
      appState,
      lastUpdated: stateRow?.last_updated ?? 0,
    };
  });

  // PUT /api/state — body { profile?, appState }. profile is accepted but
  // only display_name is honoured; everything else stays where it lives
  // (users table rows are owned by the admin path).
  app.put('/api/state', async (req, reply) => {
    const user = requireUser(req, reply, config);
    if (!user) return;
    const body = (req.body ?? {}) as {
      profile?: Partial<ProfileShape>;
      appState?: Record<string, unknown>;
    };
    const now = Date.now();

    if (body.profile?.displayName !== undefined && body.profile.displayName !== user.display_name) {
      getDb()
        .prepare('update users set display_name = ?, last_active = ? where id = ?')
        .run(body.profile.displayName, now, user.id);
    } else {
      getDb().prepare('update users set last_active = ? where id = ?').run(now, user.id);
    }

    if (body.appState !== undefined) {
      const json = JSON.stringify(body.appState);
      getDb()
        .prepare(
          `insert into app_state (user_id, state, last_updated)
             values (?, ?, ?)
             on conflict(user_id) do update set state = excluded.state, last_updated = excluded.last_updated`,
        )
        .run(user.id, json, now);

      // Fan out to this user's other tabs. The originating tab will also
      // receive its own broadcast (it's already at this state via local
      // setState; reapplying is a no-op).
      broadcastToUser(user.id, {
        type: 'state:changed',
        appState: body.appState,
        lastUpdated: now,
      });
    }

    return { ok: true, lastUpdated: now };
  });
}
