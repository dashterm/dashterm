/**
 * Per-user WebSocket fan-out for cross-tab state sync.
 *
 * Connection lifecycle:
 *   1. browser opens ws://host/api/ws — cookie sent automatically
 *   2. routes/ws.ts verifies the session, calls register(socket, userId)
 *   3. state/apps PUT handlers call broadcastToUser/broadcastApps
 *   4. socket close (tab unload / network drop) → unregister
 *
 * Echo: the originating tab's PUT will also receive its own broadcast.
 * That's idempotent (the tab already has the new state from setState),
 * and avoiding it would require a per-tab clientId scheme that adds
 * complexity for no correctness gain. We accept the redundant push.
 */

import type { WebSocket } from '@fastify/websocket';

interface Conn {
  socket: WebSocket;
  userId: string;
}

const byUser = new Map<string, Set<Conn>>();
const all = new Set<Conn>();

export function registerSocket(socket: WebSocket, userId: string): Conn {
  const conn: Conn = { socket, userId };
  let set = byUser.get(userId);
  if (!set) {
    set = new Set();
    byUser.set(userId, set);
  }
  set.add(conn);
  all.add(conn);
  return conn;
}

export function unregisterSocket(conn: Conn): void {
  all.delete(conn);
  const set = byUser.get(conn.userId);
  if (set) {
    set.delete(conn);
    if (set.size === 0) byUser.delete(conn.userId);
  }
}

function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState !== 1) return; // 1 = OPEN
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    /* socket may have closed mid-send; the close handler will unregister */
  }
}

export function broadcastToUser(userId: string, payload: unknown): void {
  const set = byUser.get(userId);
  if (!set) return;
  for (const conn of set) send(conn.socket, payload);
}

// Apps are shared across users by share-code, so changes broadcast to
// every connected tab — RLS is enforced by /api/apps already, so what
// each tab does with the notification is its own business.
export function broadcastApps(payload: unknown): void {
  for (const conn of all) send(conn.socket, payload);
}

// Test-only escape hatch. Exposes the live count so the smoke test can
// assert that connections register/unregister cleanly.
export function _debugCounts(): { totalSockets: number; users: number } {
  return { totalSockets: all.size, users: byUser.size };
}
