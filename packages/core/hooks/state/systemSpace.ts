/**
 * The reserved "Settings" space.
 *
 * Unlike user spaces it isn't created by hand — it's seeded for new users
 * (initialState) and healed onto existing users at load time
 * (ensureSystemSpace). It holds the three settings tiles (Users, AI
 * Providers, Secrets), is flagged `reserved` so it can't be deleted, and is
 * filtered out of the normal space tab bar / ⌘1-9 rotation — you reach it via
 * the gear button.
 */

import type { AppState, Space, SpaceAppLayout } from '../../types/index';

export const SYSTEM_SPACE_ID = 'system';

// Stable instance ids so the tiles + their (empty, server-backed) instance
// state survive reloads without piling up duplicates.
const SYSTEM_TILES: { instanceId: string; type: string; column: number }[] = [
  { instanceId: 'sys-usermgmt', type: 'usermgmt', column: 0 },
  { instanceId: 'sys-aiproviders', type: 'aiproviders', column: 1 },
  { instanceId: 'sys-secrets', type: 'secrets', column: 2 },
];

export function buildSystemSpaceApps(): SpaceAppLayout[] {
  return SYSTEM_TILES.map((t) => ({
    id: t.instanceId,
    type: t.type,
    column: t.column,
    row: 0,
    colSpan: 1,
    rowSpan: 2,
  }));
}

export function buildSystemSpace(createdAt: number): Space {
  return {
    id: SYSTEM_SPACE_ID,
    name: 'Settings',
    icon: '⚙️',
    gridColumns: 3,
    gridRows: 2,
    apps: buildSystemSpaceApps(),
    createdAt,
    order: 999,
    reserved: true,
  };
}

export function systemInstanceStates(): Record<string, any> {
  const out: Record<string, any> = {};
  for (const t of SYSTEM_TILES) out[t.instanceId] = {};
  return out;
}

/**
 * Idempotently guarantee the reserved Settings space exists with its tiles.
 * Returns a new AppState when it changed anything, otherwise the same ref so
 * callers can skip a redundant setState.
 */
export function ensureSystemSpace(state: AppState): AppState {
  const layout = state.webLayout;
  if (!layout) return state;
  const spaces = layout.spaces || [];
  const existing = spaces.find((s) => s.id === SYSTEM_SPACE_ID);

  let nextSpaces = spaces;
  if (!existing) {
    nextSpaces = [...spaces, buildSystemSpace(state.lastUpdated || Date.now())];
  } else {
    // Heal drift: re-add any missing tile types and re-assert `reserved`,
    // while preserving whatever positions/sizes the user has chosen.
    const haveTypes = new Set((existing.apps || []).map((a) => a.type));
    const missing = buildSystemSpaceApps().filter((a) => !haveTypes.has(a.type));
    if (missing.length > 0 || !existing.reserved) {
      nextSpaces = spaces.map((s) =>
        s.id === SYSTEM_SPACE_ID
          ? { ...s, reserved: true, apps: [...(s.apps || []), ...missing] }
          : s,
      );
    }
  }

  // Seed instance states for any tiles that don't have one yet.
  const instances = { ...(state.appInstances || {}) };
  let instancesChanged = false;
  for (const [id, def] of Object.entries(systemInstanceStates())) {
    if (!(id in instances)) {
      instances[id] = def;
      instancesChanged = true;
    }
  }

  if (nextSpaces === spaces && !instancesChanged) return state;
  return {
    ...state,
    webLayout: { ...layout, spaces: nextSpaces },
    appInstances: instancesChanged ? instances : state.appInstances,
  };
}
