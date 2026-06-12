/**
 * Event link handlers (automations between apps)
 */

import { SystemContext, EventLink, CustomApp } from '../../types';
import { getApp, getAllAIFunctions, appEventBus, AppEvent, AppEventHandler, AppContext } from '../../registry';
import { AppActions, FunctionResult } from './types';
import { getAppStateFromContext, updateAppState, findAppInstanceInSpace } from './appStateHelpers';
import { handleCustomAppFunction } from './customApps';

/**
 * Handle creating an event link (automation between apps)
 */
export async function handleCreateEventLink(
  args: {
    name: string;
    triggerApp: string;
    triggerEvent: string;
    targetApp: string;
    targetAction: string;
    actionParams?: Record<string, any>;
  },
  context: SystemContext,
  appActions: AppActions,
  registerDynamicEventLink: (link: EventLink, getContext: () => SystemContext) => void
): Promise<FunctionResult> {
  const { name, triggerApp, triggerEvent, targetApp, targetAction, actionParams = {} } = args;

  console.log('🔗 AI Service: Creating event link:', name);

  const customApps = (context as { customApps?: Record<string, CustomApp> }).customApps || {};

  try {
    // Validate trigger app + event. Built-in apps must declare the emit; custom
    // (vibe-coded) apps don't declare emits in the registry, so we trust the
    // event string for them (an unmatched pattern simply never fires).
    const sourceApp = getApp(triggerApp);
    const customSource = customApps[triggerApp];
    if (!sourceApp && !customSource) {
      return {
        success: false,
        message: `Source app "${triggerApp}" not found. Built-in apps: workout, todo, habit, countdown, pomodoro, ticker, weather — or a custom app's share code.`
      };
    }
    if (sourceApp) {
      const emitsEvent = sourceApp.events?.emits?.some(e => e.name === triggerEvent);
      if (!emitsEvent) {
        const availableEvents = sourceApp.events?.emits?.map(e => e.name).join(', ') || 'none';
        return {
          success: false,
          message: `App "${triggerApp}" doesn't emit event "${triggerEvent}". Available events: ${availableEvents}`
        };
      }
    }

    // Validate target. Built-in target → registry AI function. Custom target →
    // a function declared on the custom app; store its dispatch name
    // (`{appNameSanitized}_{fn}`) so executeEventLinkAction can route it.
    const destApp = getApp(targetApp);
    const customTarget = customApps[targetApp];
    let finalTargetAction = targetAction;
    if (destApp) {
      const targetFunc = destApp.aiFunctions?.find(f => f.definition.name === targetAction);
      if (!targetFunc) {
        const availableFuncs = destApp.aiFunctions?.map(f => f.definition.name).join(', ') || 'none';
        return {
          success: false,
          message: `Function "${targetAction}" not found in "${targetApp}". Available: ${availableFuncs}`
        };
      }
    } else if (customTarget) {
      const prefix = customTarget.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const bare = targetAction.startsWith(`${prefix}_`) ? targetAction.slice(prefix.length + 1) : targetAction;
      const fn = (customTarget.functions || []).find(f => f.name === bare);
      if (!fn) {
        const availableFuncs = (customTarget.functions || []).map(f => f.name).join(', ') || 'none';
        return {
          success: false,
          message: `Function "${bare}" not found in custom app "${customTarget.name}". Available: ${availableFuncs}`
        };
      }
      finalTargetAction = `${prefix}_${bare}`;
    } else {
      return {
        success: false,
        message: `Target app "${targetApp}" not found.`
      };
    }

    // Create the event link
    const eventLink: EventLink = {
      id: `link_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name,
      sourceEvent: `${triggerApp}:${triggerEvent}`,
      targetApp,
      targetAction: finalTargetAction,
      actionParams,
      enabled: true,
      createdAt: Date.now(),
    };

    // Get existing links and add the new one
    const existingLinks = context.eventLinks || [];
    const updatedLinks = [...existingLinks, eventLink];

    console.log(`[AIService] Saving event link. Existing: ${existingLinks.length}, New total: ${updatedLinks.length}`);
    console.log(`[AIService] updateEventLinks function available:`, !!appActions.updateEventLinks);

    // Save to state
    appActions.updateEventLinks?.(updatedLinks);

    // Register the listener immediately
    console.log(`[AIService] Registering new event link immediately`);
    registerDynamicEventLink(eventLink, () => context);

    // Give the write-through time to land
    await new Promise(resolve => setTimeout(resolve, 200));

    console.log('🔗 AI Service: Event link created successfully:', eventLink.id);

    return {
      success: true,
      message: `✅ Created automation "${name}"!\n\nWhen: ${triggerApp}:${triggerEvent}\nDo: ${targetAction} in ${targetApp}`
    };
  } catch (error) {
    console.error('Error creating event link:', error);
    return {
      success: false,
      message: `Failed to create event link: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * Handle listing all event links
 */
export function handleListEventLinks(context: SystemContext): FunctionResult {
  const links = context.eventLinks || [];

  if (links.length === 0) {
    return {
      success: true,
      message: '📭 No automations set up yet.\n\nYou can create one by saying something like:\n"When I log a workout, mark my exercise habit as complete"'
    };
  }

  let message = `🔗 **Your Automations (${links.length})**\n\n`;

  links.forEach((link, i) => {
    const status = link.enabled ? '✅' : '⏸️';
    message += `${i + 1}. ${status} **${link.name}**\n`;
    message += `   When: \`${link.sourceEvent}\`\n`;
    message += `   Do: \`${link.targetAction}\` in ${link.targetApp}\n\n`;
  });

  return {
    success: true,
    message
  };
}

/**
 * Handle removing an event link
 */
export async function handleRemoveEventLink(
  args: { linkId: string },
  context: SystemContext,
  appActions: AppActions
): Promise<FunctionResult> {
  const { linkId } = args;

  const links = context.eventLinks || [];
  const link = links.find(l => l.id === linkId || l.name.toLowerCase().includes(linkId.toLowerCase()));

  if (!link) {
    return {
      success: false,
      message: `Could not find automation matching "${linkId}".`
    };
  }

  const updatedLinks = links.filter(l => l.id !== link.id);
  appActions.updateEventLinks?.(updatedLinks);

  await new Promise(resolve => setTimeout(resolve, 200));

  return {
    success: true,
    message: `🗑️ Removed automation "${link.name}".`
  };
}

/**
 * Handle toggling an event link
 */
export async function handleToggleEventLink(
  args: { linkId: string; enabled: boolean },
  context: SystemContext,
  appActions: AppActions
): Promise<FunctionResult> {
  const { linkId, enabled } = args;

  const links = context.eventLinks || [];
  const linkIndex = links.findIndex(l => l.id === linkId || l.name.toLowerCase().includes(linkId.toLowerCase()));

  if (linkIndex === -1) {
    return {
      success: false,
      message: `Could not find automation matching "${linkId}".`
    };
  }

  const updatedLinks = [...links];
  updatedLinks[linkIndex] = { ...updatedLinks[linkIndex], enabled };
  appActions.updateEventLinks?.(updatedLinks);

  await new Promise(resolve => setTimeout(resolve, 200));

  const status = enabled ? 'enabled ✅' : 'disabled ⏸️';
  return {
    success: true,
    message: `Automation "${links[linkIndex].name}" is now ${status}.`
  };
}

/**
 * Execute an event link when triggered
 */
export async function executeEventLinkAction(
  link: EventLink,
  event: AppEvent,
  context: SystemContext,
  appActions: AppActions
): Promise<void> {
  console.log(`[AIService] Event received for link ${link.name}:`, event.type);
  console.log(`[AIService] Context eventLinks:`, context.eventLinks?.length || 0, 'links');

  // Check if the link is still enabled (might have been disabled since registration)
  const currentLinks = context.eventLinks || [];
  const currentLink = currentLinks.find(l => l.id === link.id);
  if (!currentLink || !currentLink.enabled) {
    console.log(`[AIService] Event link ${link.id} is disabled or not found, skipping`);
    return;
  }

  console.log(`[AIService] Event link triggered: ${link.name}, executing ${link.targetAction}`);

  // Resolve action params, replacing $event.X references with actual event data
  const resolvedParams: Record<string, any> = {};
  for (const [key, value] of Object.entries(link.actionParams)) {
    if (typeof value === 'string' && value.startsWith('$event.')) {
      const eventField = value.substring(7); // Remove '$event.'
      resolvedParams[key] = event.data?.[eventField];
    } else {
      resolvedParams[key] = value;
    }
  }

  // Find and execute the target function
  const registeredFunctions = getAllAIFunctions();
  console.log(`[AIService] Looking for function ${link.targetAction} among`, registeredFunctions.map(f => f.definition.name));
  const targetFunc = registeredFunctions.find(f => f.definition.name === link.targetAction);

  if (targetFunc) {
    console.log(`[AIService] Found target function, executing with params:`, resolvedParams);
    const appState = getAppStateFromContext(link.targetApp, context);
    const instanceId = findAppInstanceInSpace(link.targetApp, context);

    const appContext: AppContext = {
      state: appState,
      updateState: (updates: any) => updateAppState(link.targetApp, updates, context, appActions),
      userProfile: context.userProfile,
      allAppStates: context.appInstances || {},
      emit: (eventName: string, data: any) => {
        appEventBus.emitFromApp(link.targetApp, eventName, data, instanceId || undefined);
      },
      subscribe: (eventPattern: string, handler: AppEventHandler) => {
        return appEventBus.subscribe(eventPattern, handler, () => appContext);
      },
    };

    try {
      const result = await targetFunc.handler(resolvedParams, appContext);
      console.log(`[AIService] Event link ${link.name} executed successfully:`, result);
    } catch (err) {
      console.error(`[AIService] Event link ${link.name} failed:`, err);
    }
    return;
  }

  // Not a built-in function — fall back to a custom (vibe-coded) app target.
  // Custom-app functions are named `{appNameSanitized}_{fn}`; handleCustomAppFunction
  // resolves the app from that prefix and writes lastFunctionCall onto the app
  // instance so the component reacts. Build the lookup map from context.customApps.
  if (link.targetAction.includes('_')) {
    const customApps = (context as { customApps?: Record<string, CustomApp> }).customApps || {};
    const customAppFunctions = new Map<string, { name: string }[]>();
    for (const [appId, app] of Object.entries(customApps)) {
      const prefix = app.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const fns = (app.functions || []).map((f) => ({ name: `${prefix}_${f.name}` }));
      customAppFunctions.set(appId, fns);
    }
    try {
      const result = await handleCustomAppFunction(
        link.targetAction,
        resolvedParams,
        context,
        appActions,
        customAppFunctions,
      );
      console.log(`[AIService] Event link ${link.name} (custom app) executed:`, result);
    } catch (err) {
      console.error(`[AIService] Event link ${link.name} (custom app) failed:`, err);
    }
    return;
  }

  console.warn(`[AIService] Event link ${link.name}: target action "${link.targetAction}" not found (built-in or custom).`);
}
