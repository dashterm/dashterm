/**
 * Live AgentSession registry, keyed by (user, workspace, agent).
 *
 * A coding-agent process used to die the instant its WebSocket closed
 * (routes/agent.ts: `socket.on('close', () => session.dispose())`), so locking
 * your phone mid-turn SIGINT'd `claude`. To let a turn finish in the background
 * and let a reconnecting socket re-attach to the SAME running agent (instead of
 * spawning a duplicate), a session registers itself here once it knows its
 * workspace+agent, and removes itself on dispose. At most one session per key.
 */
import type { AgentSession } from './session';

const sessions = new Map<string, AgentSession>();

export function getSession(key: string): AgentSession | undefined {
  return sessions.get(key);
}

export function registerSession(key: string, session: AgentSession): void {
  sessions.set(key, session);
}

/** Remove only if `session` is still the registered one (don't clobber a replacement). */
export function unregisterSession(key: string, session: AgentSession): void {
  if (sessions.get(key) === session) sessions.delete(key);
}
