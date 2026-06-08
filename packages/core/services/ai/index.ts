/**
 * AI Service — main entry point.
 *
 * All model calls go through the gateway's /api/ai/chat proxy. Whichever
 * provider the operator bound to the 'ai' app (or the default provider
 * if no binding) actually answers — could be Claude, GPT, Gemini, or a
 * local model. The dashboard never sees the api key.
 */

import { SystemContext, EventLink } from '../../types';
import { getAllAIFunctions, getApp, appEventBus, AppEvent, AppEventHandler, getAllEventListeners, AppContext } from '../../registry';

// Import types
import { ChatResponse, ConversationMessage, AppActions } from './types';

// Import function declarations
import {
  appManagementFunctionDeclarations,
  customAppFunctionDeclarations,
  eventLinkFunctionDeclarations,
  queryDataFunctionDeclarations,
} from './functionDeclarations';

// Import handlers
import { handleAddApp, handleRemoveApp, handleListAvailableApps } from './appManagement';
import {
  handleDeleteCustomApp,
  handleCustomAppFunction,
} from './customApps';
import {
  handleCreateEventLink,
  handleListEventLinks,
  handleRemoveEventLink,
  handleToggleEventLink,
  executeEventLinkAction,
} from './eventLinks';
import {
  handleQueryAppData,
  handleListQueryableData,
} from './queryData';

// Import helpers
import { getAppStateFromContext, updateAppState, findAppInstanceInSpace } from './appStateHelpers';
import { buildSystemPrompt } from './systemPrompt';

// Gateway base URL — empty for the production same-origin case (the
// gateway serves the bundle and the API), the dev cross-origin port
// when EXPO_PUBLIC_GATEWAY_URL is set.
const gatewayBase = (): string => process.env.EXPO_PUBLIC_GATEWAY_URL ?? '';

interface ProxyToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface ProxyMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  toolCalls?: ProxyToolCall[];
  toolCallId?: string;
  name?: string;
}

interface ProxyResponse {
  message: ProxyMessage;
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
  servedBy?: { provider: string; kind: string; model: string };
  error?: string;
}

/**
 * AIService — orchestrates conversational AI for the AIAssistant app.
 * Maintains tool dispatch on the client side; the proxy is stateless
 * per-request.
 */
export class AIService {
  private appActions: AppActions = {};

  // Store custom app functions for dynamic function calling
  private customAppFunctions: Map<string, any[]> = new Map();

  // Store unsubscribe functions for event listeners
  private eventUnsubscribers: (() => void)[] = [];

  private getAllFunctionDeclarations(): any[] {
    const baseFunctions: any[] = [
      ...appManagementFunctionDeclarations,
      ...customAppFunctionDeclarations,
      ...eventLinkFunctionDeclarations,
      ...queryDataFunctionDeclarations
    ];

    const registeredFunctions = getAllAIFunctions();
    for (const { definition } of registeredFunctions) {
      baseFunctions.push(definition);
    }

    for (const functions of this.customAppFunctions.values()) {
      baseFunctions.push(...functions);
    }

    return baseFunctions;
  }

  /**
   * Register app action functions
   */
  registerAppActions(actions: AppActions) {
    console.log('[AIService] registerAppActions called, updateEventLinks available:', !!actions.updateEventLinks);
    this.appActions = actions;
  }

  /**
   * Initialize event listeners from all registered app plugins.
   * This should be called after apps are registered and when context is available.
   */
  initializeEventListeners(getContext: () => SystemContext): void {
    // Clean up any existing listeners
    this.eventUnsubscribers.forEach(unsub => unsub());
    this.eventUnsubscribers = [];

    // Get all registered event listeners from plugins
    const allListeners = getAllEventListeners();

    for (const { appId, listener } of allListeners) {
      console.log(`[AIService] Wiring up listener for ${appId}: ${listener.eventPattern}`);

      const unsub = appEventBus.on(listener.eventPattern, async (event: AppEvent) => {
        const context = getContext();
        const appState = getAppStateFromContext(appId, context);
        const instanceId = findAppInstanceInSpace(appId, context);

        const appContext: AppContext = {
          state: appState,
          updateState: (updates: any) => updateAppState(appId, updates, context, this.appActions),
          userProfile: context.userProfile,
          allAppStates: context.appInstances || {},
          emit: (eventName: string, data: any) => {
            appEventBus.emitFromApp(appId, eventName, data, instanceId || undefined);
          },
          subscribe: (eventPattern: string, handler: AppEventHandler) => {
            return appEventBus.subscribe(eventPattern, handler, () => appContext);
          },
        };

        try {
          await listener.handler(event, appContext);
        } catch (err) {
          console.error(`[AIService] Event listener error in ${appId}:`, err);
        }
      });

      this.eventUnsubscribers.push(unsub);
    }

    console.log(`[AIService] Initialized ${this.eventUnsubscribers.length} event listeners`);
  }

  /**
   * Chat with the AI using function calling
   */
  async chatWithFunctions(
    message: string,
    context: SystemContext,
    conversationHistory: ConversationMessage[] = []
  ): Promise<ChatResponse> {
    try {
      const systemPrompt = buildSystemPrompt(context);

      const messages: ProxyMessage[] = [
        { role: 'system', content: systemPrompt },
      ];
      for (const m of conversationHistory) {
        if (m.role === 'system') continue;
        messages.push({ role: m.role, content: m.content });
      }
      messages.push({ role: 'user', content: message });

      const tools = this.getAllFunctionDeclarations();

      const localStateUpdates: Record<string, any> = {};
      const executedCalls: Array<{ name: string; params: any; result: any }> = [];

      const getMutableContext = (): SystemContext => {
        if (Object.keys(localStateUpdates).length === 0) return context;
        const updatedInstances = { ...context.appInstances };
        for (const [instanceId, updates] of Object.entries(localStateUpdates)) {
          updatedInstances[instanceId] = {
            ...(updatedInstances[instanceId] || {}),
            ...updates,
          };
        }
        return { ...context, appInstances: updatedInstances };
      };

      const MAX_TURNS = 8;
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const r = await fetch(`${gatewayBase()}/api/ai/chat`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appId: 'ai',
            messages,
            tools,
            toolChoice: 'auto',
            maxTokens: 4096,
            temperature: 0.7,
          }),
        });
        if (!r.ok) {
          let detail = `HTTP ${r.status}`;
          try {
            const j = (await r.json()) as { error?: string };
            if (j?.error) detail = j.error;
          } catch { /* leave detail as HTTP status */ }
          return { message: `AI request failed: ${detail}` };
        }
        const data = (await r.json()) as ProxyResponse;
        if (data.error) return { message: `AI error: ${data.error}` };
        const reply = data.message;
        if (reply.toolCalls && reply.toolCalls.length > 0) {
          messages.push({
            role: 'assistant',
            content: reply.content,
            toolCalls: reply.toolCalls,
          });
          for (const tc of reply.toolCalls) {
            const result = await this.executeFunctionCallWithStateTracking(
              tc.name,
              tc.arguments,
              getMutableContext(),
              localStateUpdates,
            );
            executedCalls.push({ name: tc.name, params: tc.arguments, result });
            messages.push({
              role: 'tool',
              toolCallId: tc.id,
              name: tc.name,
              content: JSON.stringify(result),
            });
          }
          continue;
        }
        const text = reply.content || (
          executedCalls.length
            ? `Executed ${executedCalls.length} action(s).`
            : "I'm here to help! You can ask me to manage your apps or run commands."
        );
        return {
          message: text,
          functionCalls: executedCalls.length ? executedCalls : undefined,
          functionCall: executedCalls[0],
        };
      }

      return {
        message: `Hit max tool-call depth (${MAX_TURNS} turns). Executed ${executedCalls.length} action(s).`,
        functionCalls: executedCalls.length ? executedCalls : undefined,
        functionCall: executedCalls[0],
      };
    } catch (error) {
      console.error('AI chat error:', error);
      return {
        message: `I'm having trouble processing that request. Error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }


  private async executeFunctionCall(functionName: string, args: any, context: SystemContext): Promise<any> {
    switch (functionName) {
      case 'addApp':
        return handleAddApp(args, this.appActions);

      case 'removeApp':
        return handleRemoveApp(args, this.appActions);

      case 'listAvailableApps':
        return handleListAvailableApps();

      case 'deleteCustomApp':
        return handleDeleteCustomApp(args, context, this.appActions);

      case 'createEventLink':
        return handleCreateEventLink(
          args,
          context,
          this.appActions,
          (link, getContext) => this.registerDynamicEventLink(link, getContext)
        );

      case 'listEventLinks':
        return handleListEventLinks(context);

      case 'removeEventLink':
        return handleRemoveEventLink(args, context, this.appActions);

      case 'toggleEventLink':
        return handleToggleEventLink(args, context, this.appActions);

      case 'queryAppData':
        return handleQueryAppData(args, context, this.appActions);

      case 'listQueryableData':
        return handleListQueryableData();

      default:
        const registeredFunctions = getAllAIFunctions();
        const registeredFunc = registeredFunctions.find(f => f.definition.name === functionName);

        if (registeredFunc) {
          const appState = getAppStateFromContext(registeredFunc.appId, context);
          const instanceId = findAppInstanceInSpace(registeredFunc.appId, context);

          const appContext: AppContext = {
            state: appState,
            updateState: (updates: any) => updateAppState(registeredFunc.appId, updates, context, this.appActions),
            userProfile: context.userProfile,
            allAppStates: context.appInstances || {},
            // Event system methods
            emit: (eventName: string, data: any) => {
              appEventBus.emitFromApp(registeredFunc.appId, eventName, data, instanceId || undefined);
            },
            subscribe: (eventPattern: string, handler: AppEventHandler) => {
              return appEventBus.subscribe(eventPattern, handler, () => appContext);
            },
          };

          const result = await registeredFunc.handler(args, appContext);
          return { success: true, message: result };
        }

        if (functionName.includes('_')) {
          return handleCustomAppFunction(functionName, args, context, this.appActions, this.customAppFunctions);
        }
        return { success: false, message: `Unknown function: ${functionName}` };
    }
  }

  /**
   * Execute a function call while tracking state changes locally.
   * This allows multiple sequential function calls to see each other's state updates.
   */
  private async executeFunctionCallWithStateTracking(
    functionName: string,
    args: any,
    context: SystemContext,
    localStateUpdates: Record<string, any>
  ): Promise<any> {
    // For non-registered functions, just use the regular executor
    const registeredFunctions = getAllAIFunctions();
    const registeredFunc = registeredFunctions.find(f => f.definition.name === functionName);

    if (!registeredFunc) {
      // Fall back to regular execution for system functions
      return this.executeFunctionCall(functionName, args, context);
    }

    // For registered app functions, we need to intercept updateState to track changes
    const appState = getAppStateFromContext(registeredFunc.appId, context);
    const instanceId = findAppInstanceInSpace(registeredFunc.appId, context);

    const appContext: AppContext = {
      state: appState,
      updateState: (updates: any) => {
        // Call the real update
        updateAppState(registeredFunc.appId, updates, context, this.appActions);

        // Also track the update locally so subsequent calls can see it
        if (instanceId) {
          const currentLocal = localStateUpdates[instanceId] || {};
          // Merge the new updates
          localStateUpdates[instanceId] = { ...appState, ...currentLocal, ...updates };
        }
      },
      userProfile: context.userProfile,
      allAppStates: context.appInstances || {},
      emit: (eventName: string, data: any) => {
        appEventBus.emitFromApp(registeredFunc.appId, eventName, data, instanceId || undefined);
      },
      subscribe: (eventPattern: string, handler: AppEventHandler) => {
        return appEventBus.subscribe(eventPattern, handler, () => appContext);
      },
    };

    const result = await registeredFunc.handler(args, appContext);
    return { success: true, message: result };
  }

  /**
   * Register a single dynamic event link
   */
  private registerDynamicEventLink(link: EventLink, getContext: () => SystemContext): void {
    if (!link.enabled) {
      console.log(`[AIService] Skipping disabled event link: ${link.name}`);
      return;
    }

    console.log(`[AIService] Registering dynamic event link: ${link.name} (${link.sourceEvent}) -> ${link.targetAction} in ${link.targetApp}`);

    const unsub = appEventBus.on(link.sourceEvent, async (event: AppEvent) => {
      const context = getContext();
      await executeEventLinkAction(link, event, context, this.appActions);
    });

    this.eventUnsubscribers.push(unsub);
  }

  /**
   * Register all dynamic event links from context
   */
  registerDynamicEventLinks(getContext: () => SystemContext): void {
    const context = getContext();
    const links = context.eventLinks || [];

    console.log(`[AIService] registerDynamicEventLinks called with ${links.length} links:`, links.map(l => ({ name: l.name, sourceEvent: l.sourceEvent, enabled: l.enabled })));

    for (const link of links) {
      if (link.enabled) {
        this.registerDynamicEventLink(link, getContext);
      }
    }

    console.log(`[AIService] Registered ${links.filter(l => l.enabled).length} dynamic event links`);
  }

  /**
   * Legacy method for backwards compatibility
   */
  async chat(message: string, context: SystemContext): Promise<string> {
    const response = await this.chatWithFunctions(message, context);
    return response.message;
  }
}

export const aiService = new AIService();

// Re-export types for convenience
export type { ChatResponse, ConversationMessage, AppActions } from './types';
