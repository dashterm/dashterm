/**
 * Helper functions for getting and updating app state
 */

import { SystemContext, Space } from '../../types';
import { AppActions } from './types';

/**
 * Find an app instance in the current space (or specified space) by app type
 */
export function findAppInstanceInSpace(
  appType: string,
  context: SystemContext,
  targetSpaceId?: string
): string | null {
  const spaces = context.spaces || [];
  const spaceId = targetSpaceId || context.activeSpaceId;

  if (!spaceId || spaces.length === 0) {
    return null;
  }

  // Find the space
  const space = spaces.find(s => s.id === spaceId);
  if (!space) {
    return null;
  }

  // Find the first app of this type in the space
  const appLayout = space.apps?.find(app => app.type === appType);
  if (!appLayout) {
    return null;
  }

  return appLayout.id;
}

/**
 * Find the space that contains the AI assistant instance making the request
 */
export function findCurrentAISpace(context: SystemContext): Space | null {
  const spaces = context.spaces || [];
  const aiInstanceId = context.currentAIInstanceId;

  if (!aiInstanceId) {
    // Fall back to active space
    return spaces.find(s => s.id === context.activeSpaceId) || null;
  }

  // Find which space contains this AI instance
  for (const space of spaces) {
    const hasAI = space.apps?.some(app => app.id === aiInstanceId);
    if (hasAI) {
      return space;
    }
  }

  return spaces.find(s => s.id === context.activeSpaceId) || null;
}

/**
 * Get app state from context. After Phase 2 the only lookup path is the
 * instance-based one — there's no global per-app state to fall back to.
 */
export function getAppStateFromContext(appId: string, context: SystemContext): any {
  if (!context.appInstances || !context.spaces) return {};

  const aiSpace = findCurrentAISpace(context);
  if (!aiSpace) return {};

  const instanceId = findAppInstanceInSpace(appId, context, aiSpace.id);
  if (instanceId && context.appInstances[instanceId]) {
    return context.appInstances[instanceId];
  }
  return {};
}

/**
 * Update app state via the per-instance updater.
 */
export function updateAppState(
  appId: string,
  updates: any,
  context: SystemContext,
  appActions: AppActions
): void {
  if (!context.appInstances || !context.spaces || !appActions.updateAppInstance) return;

  const aiSpace = findCurrentAISpace(context);
  if (!aiSpace) return;

  const instanceId = findAppInstanceInSpace(appId, context, aiSpace.id);
  if (instanceId) {
    appActions.updateAppInstance(instanceId, updates);
  }
}
