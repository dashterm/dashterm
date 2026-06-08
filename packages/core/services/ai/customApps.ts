/**
 * Custom app handlers for the AIAssistant function-calling layer.
 *
 * Code creation + editing for vibe-coded apps now lives in the
 * AgenticCoder app (claude -p sessions on the homehub). The
 * server-side Gemini-driven /api/create-app-agent +
 * /api/edit-app-agent endpoints have been deleted; only delete and
 * per-app function dispatch survive here.
 */

import { SystemContext, CustomApp } from '../../types';
import { AppActions, FunctionResult } from './types';

/**
 * Handle deleting a custom app via AIAssistant. Purely a local action —
 * the deletion fans out to the apps table through appActions.deleteCustomApp.
 */
export async function handleDeleteCustomApp(
  args: { appName: string },
  context: SystemContext,
  appActions: AppActions,
): Promise<FunctionResult> {
  const { appName } = args;
  try {
    const customApps = (context as { customApps?: Record<string, CustomApp> }).customApps || {};
    const appEntry = Object.entries(customApps).find(
      ([, app]) => app.name.toLowerCase().includes(appName.toLowerCase()),
    );
    if (!appEntry) {
      return { success: false, message: `Could not find custom app matching "${appName}".` };
    }
    const [appId, app] = appEntry;
    appActions.deleteCustomApp?.(appId);
    // Give the apps:changed WS push a moment to land on other tabs.
    await new Promise((r) => setTimeout(r, 200));
    return { success: true, message: `🗑️ Deleted "${app.name}" successfully.` };
  } catch (error) {
    return {
      success: false,
      message: `Failed to delete custom app: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Dispatch a function declared by a vibe-coded custom app. The app's
 * declared functions live in customAppFunctions; calling one updates the
 * app instance's state.lastFunctionCall so the app component can react.
 */
export async function handleCustomAppFunction(
  functionName: string,
  args: unknown,
  context: SystemContext,
  appActions: AppActions,
  customAppFunctions: Map<string, { name: string }[]>,
): Promise<FunctionResult> {
  try {
    const [appNamePart, actualFunctionName] = functionName.split('_', 2);
    const customApps = (context as { customApps?: Record<string, CustomApp> }).customApps || {};
    const matchingAppEntry = Object.entries(customApps).find(
      ([, app]) =>
        app.name.toLowerCase().replace(/[^a-z0-9]/g, '') === appNamePart.toLowerCase(),
    );
    if (!matchingAppEntry) {
      return { success: false, message: `Custom app "${appNamePart}" not found for function ${functionName}` };
    }
    const [appId, app] = matchingAppEntry;
    const appFunctions = customAppFunctions.get(appId) || [];
    const functionDecl = appFunctions.find((f) => f.name === functionName);
    if (!functionDecl) {
      return { success: false, message: `Function "${actualFunctionName}" not found in app "${app.name}"` };
    }
    const appInstances = (context as { appInstances?: Record<string, unknown> }).appInstances || {};
    const instanceEntry = Object.entries(appInstances).find(([instanceId]) =>
      instanceId.includes(appId),
    );
    if (instanceEntry) {
      const [instanceId, instanceState] = instanceEntry;
      const currentState = (instanceState as object) || {};
      const newState = {
        ...currentState,
        lastFunctionCall: { function: actualFunctionName, args, timestamp: Date.now() },
      };
      appActions.updateAppInstance?.(instanceId, newState);
    }
    await new Promise((r) => setTimeout(r, 300));
    return { success: true, message: `Executed ${actualFunctionName} in ${app.name}` };
  } catch (error) {
    return {
      success: false,
      message: `Failed to execute custom app function: ${(error as Error).message}`,
    };
  }
}
