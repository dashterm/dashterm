import { AppState, EventLink } from '../../types';

export interface ChatResponse {
  message: string;
  functionCall?: {
    name: string;
    params: any;
    result: any;
  };
  // Multiple function calls when AI executes several actions at once
  functionCalls?: Array<{
    name: string;
    params: any;
    result: any;
  }>;
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Actions exposed to the AI assistant. After Phase 2, the AI no longer has
 * direct per-app helpers (addTodo, addWorkoutSet, etc.) — all app-specific
 * state goes through updateAppInstance.
 */
export interface AppActions {
  addApp?: (appKey: AppState['currentMobileApp']) => void;
  removeApp?: (appKey: AppState['currentMobileApp']) => void;
  // Custom app management — apps are stored at apps/{shareCode}/
  createCustomApp?: (app: any) => Promise<string | null>;
  updateCustomApp?: (appId: string, updates: any) => Promise<boolean>;
  deleteCustomApp?: (appId: string) => Promise<boolean>;
  // Instance-based state updates for Spaces architecture
  updateAppInstance?: (instanceId: string, updates: any) => void;
  // Event link management
  updateEventLinks?: (links: EventLink[]) => void;
  // Space management for custom apps
  addAppToSpace?: (spaceId: string, appId: string, appType: string) => void;
}

export interface FunctionResult {
  success: boolean;
  message: string;
}
