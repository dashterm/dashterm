import { Space, SpaceAppLayout } from '../../types/index';

/**
 * Recursively removes undefined values from objects.
 * Some backends reject undefined values, so we need to clean objects before sending.
 */
export const removeUndefinedValues = (obj: any): any => {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) {
    return obj.map(removeUndefinedValues);
  }
  if (typeof obj === 'object') {
    const cleaned: any = {};
    for (const key of Object.keys(obj)) {
      if (obj[key] !== undefined) {
        cleaned[key] = removeUndefinedValues(obj[key]);
      }
    }
    return cleaned;
  }
  return obj;
};

/**
 * Migrates legacy web layout to the new Spaces architecture.
 * If already has spaces, returns as-is.
 */
export const migrateToSpaces = (
  webLayout: any,
  activeApps: string[]
): { spaces: Space[]; activeSpaceId: string } => {
  // If already has spaces, return as-is
  if (webLayout?.spaces && webLayout.spaces.length > 0) {
    return {
      spaces: webLayout.spaces,
      activeSpaceId: webLayout.activeSpaceId || webLayout.spaces[0].id,
    };
  }

  // Migrate from legacy layout
  const legacyApps = webLayout?.apps || [];
  const columnCount = webLayout?.columnCount || 3;

  // Convert legacy apps to SpaceAppLayout format
  const spaceApps: SpaceAppLayout[] = activeApps.map((appId, index) => {
    const legacyApp = legacyApps.find((a: any) => a.id === appId || a.type === appId);
    const column = legacyApp?.column ?? (index % columnCount);
    const row = legacyApp?.order ?? Math.floor(index / columnCount);

    return {
      id: appId,
      type: appId,
      column: column % columnCount,
      row: Math.floor(column / columnCount) + row,
      colSpan: 1,
      rowSpan: 1,
    };
  });

  const defaultSpace: Space = {
    id: 'default',
    name: 'Dashboard',
    gridColumns: columnCount,
    gridRows: 2,
    apps: spaceApps,
    createdAt: Date.now(),
    order: 0,
  };

  return {
    spaces: [defaultSpace],
    activeSpaceId: 'default',
  };
};
