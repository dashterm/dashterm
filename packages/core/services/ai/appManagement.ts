/**
 * App management handlers (add, remove, list apps)
 */

import { findAppByDescription, getAppMetadata, APP_REGISTRY } from '../../config/appRegistry';
import { AppActions, FunctionResult } from './types';

/**
 * Handle adding an app to the dashboard
 */
export async function handleAddApp(
  args: { appName: string },
  appActions: AppActions
): Promise<FunctionResult> {
  const { appName } = args;

  console.log('🔧 AI Service: Adding app:', appName);

  // Find matching app
  const appKey = findAppByDescription(appName);

  if (!appKey) {
    const availableApps = Object.values(APP_REGISTRY).map(app => app.title).join(', ');
    return {
      success: false,
      message: `Could not find app matching "${appName}". Available apps: ${availableApps}`
    };
  }

  const metadata = getAppMetadata(appKey);

  // Call the action
  appActions.addApp?.(appKey);

  // Give the write-through time to land
  await new Promise(resolve => setTimeout(resolve, 200));

  console.log('🔧 AI Service: App add function completed');

  return {
    success: true,
    message: `Added ${metadata?.title}! You can now use it from the dashboard.`
  };
}

/**
 * Handle removing an app from the dashboard
 */
export async function handleRemoveApp(
  args: { appName: string },
  appActions: AppActions
): Promise<FunctionResult> {
  const { appName } = args;

  console.log('🔧 AI Service: Removing app:', appName);

  // Find matching app
  const appKey = findAppByDescription(appName);

  if (!appKey) {
    return {
      success: false,
      message: `Could not find app matching "${appName}".`
    };
  }

  if (appKey === 'ai') {
    return {
      success: false,
      message: `Cannot remove the AI Assistant app - it's required to manage other apps!`
    };
  }

  const metadata = getAppMetadata(appKey);

  // Call the action
  appActions.removeApp?.(appKey);

  // Give the write-through time to land
  await new Promise(resolve => setTimeout(resolve, 200));

  console.log('🔧 AI Service: App remove function completed');

  return {
    success: true,
    message: `Removed ${metadata?.title} from your dashboard.`
  };
}

/**
 * Handle listing all available apps
 */
export function handleListAvailableApps(): FunctionResult {
  const appList = Object.values(APP_REGISTRY)
    .map(app => `• **${app.title}**: ${app.description}`)
    .join('\n');

  return {
    success: true,
    message: `📱 **Available Apps**\n\n${appList}\n\nUse "add [app name]" to add an app to your dashboard.`
  };
}
