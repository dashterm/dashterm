/**
 * The reserved "Settings" space.
 *
 * Unlike user spaces it isn't created by hand — it's seeded for new users
 * (initialState) and healed onto existing users at load time
 * (ensureSystemSpace). It holds the settings tiles (Users, AI Providers,
 * Secrets across the top row, and the dashboard-wide App Settings as a
 * full-width bar beneath them), is flagged `reserved` so it can't be deleted,
 * and is filtered out of the normal space tab bar / ⌘1-9 rotation — you reach
 * it via the MENU → APP SETTINGS item.
 */

import type { AppState, Space, SpaceAppLayout } from '../../types/index';

export const SYSTEM_SPACE_ID = 'system';

// The reserved space is a 3-column × 3-row grid: the three management tiles
// each span the top two rows, and App Settings spans all three columns of the
// bottom row.
const SYSTEM_GRID_COLUMNS = 3;
const SYSTEM_GRID_ROWS = 3;

// Stable instance ids so the tiles + their (empty, server-backed) instance
// state survive reloads without piling up duplicates.
const SYSTEM_TILES: SpaceAppLayout[] = [
  { id: 'sys-usermgmt', type: 'usermgmt', column: 0, row: 0, colSpan: 1, rowSpan: 2 },
  { id: 'sys-aiproviders', type: 'aiproviders', column: 1, row: 0, colSpan: 1, rowSpan: 2 },
  { id: 'sys-secrets', type: 'secrets', column: 2, row: 0, colSpan: 1, rowSpan: 2 },
  { id: 'sys-appsettings', type: 'appsettings', column: 0, row: 2, colSpan: 3, rowSpan: 1 },
];

export function buildSystemSpaceApps(): SpaceAppLayout[] {
  return SYSTEM_TILES.map((t) => ({ ...t }));
}

export function buildSystemSpace(createdAt: number): Space {
  return {
    id: SYSTEM_SPACE_ID,
    name: 'Settings',
    icon: '⚙️',
    gridColumns: SYSTEM_GRID_COLUMNS,
    gridRows: SYSTEM_GRID_ROWS,
    apps: buildSystemSpaceApps(),
    createdAt,
    order: 999,
    reserved: true,
  };
}

export function systemInstanceStates(): Record<string, any> {
  const out: Record<string, any> = {};
  for (const t of SYSTEM_TILES) out[t.id] = {};
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
    // Heal drift: re-add any missing tile types, re-assert `reserved`, and make
    // sure the grid is tall enough for the bottom-row App Settings bar (older
    // installs seeded a 2-row grid), while preserving whatever positions/sizes
    // the user has chosen for the existing tiles.
    const haveTypes = new Set((existing.apps || []).map((a) => a.type));
    const missing = buildSystemSpaceApps().filter((a) => !haveTypes.has(a.type));
    const needsRows = (existing.gridRows || 0) < SYSTEM_GRID_ROWS;
    if (missing.length > 0 || !existing.reserved || needsRows) {
      nextSpaces = spaces.map((s) =>
        s.id === SYSTEM_SPACE_ID
          ? {
              ...s,
              reserved: true,
              gridRows: Math.max(s.gridRows || 0, SYSTEM_GRID_ROWS),
              apps: [...(s.apps || []), ...missing],
            }
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
