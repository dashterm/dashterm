import { ComponentType } from 'react';
import { UserProfile, AppSettings as GlobalAppSettings } from '../types';

// ============================================
// EVENT SYSTEM TYPES
// ============================================

export interface AppEvent {
  type: string;              // e.g., 'workout:set-logged', 'todo:added'
  sourceApp: string;         // App that emitted the event
  instanceId?: string;       // For Space-scoped events
  data: any;                 // Event payload
  timestamp: number;
}

export interface AppEventDefinition {
  name: string;              // e.g., 'set-logged' (auto-prefixed with appId)
  description: string;       // Human-readable for UI
  dataSchema?: {             // Describes the payload shape
    type: string;
    properties: Record<string, { type: string; description: string }>;
  };
}

export type AppEventHandler = (event: AppEvent, context: AppContext) => void | Promise<void>;

export interface AppEventListener {
  eventPattern: string;      // e.g., 'workout:set-logged' or 'workout:*'
  description: string;       // What this listener does
  handler: AppEventHandler;
}

export interface AppEvents {
  emits?: AppEventDefinition[];      // Events this app can emit
  listens?: AppEventListener[];      // Events this app reacts to
}

// ============================================
// QUERYABLE DATA TYPES
// ============================================

export interface QueryableFieldSchema {
  type: 'string' | 'number' | 'boolean' | 'date' | 'array';
  description: string;
  filterable?: boolean;    // Can filter by this field
  sortable?: boolean;      // Can sort by this field
  searchable?: boolean;    // Can text search this field
}

export interface QueryableDataSchema {
  name: string;                                    // e.g., 'workouts', 'todos'
  description: string;                             // Human-readable description
  itemName: string;                                // Singular form, e.g., 'workout', 'todo'
  fields: Record<string, QueryableFieldSchema>;   // Field definitions
  examples?: string[];                            // Example queries for AI context
}

export interface QueryOptions {
  filter?: Record<string, any>;                   // Field-value filters
  dateRange?: {                                   // Date-based filtering
    field: string;
    start?: number;                               // Unix timestamp
    end?: number;
  };
  search?: string;                                // Text search
  sort?: {
    field: string;
    direction: 'asc' | 'desc';
  };
  limit?: number;
}

export interface QueryResult {
  items: any[];
  total: number;
  filtered: number;
}

export type QueryHandler = (options: QueryOptions, context: AppContext) => QueryResult;

export interface AppQueryableData {
  schema: QueryableDataSchema;
  getData: QueryHandler;
}

// ============================================
// APP SETTINGS TYPES
// ============================================

export interface AppSettingsContext {
  state: any;
  updateState: (updates: any) => void;
  onClose: () => void;
}

export interface AppSettings {
  renderSettings: (context: AppSettingsContext) => React.ReactNode;
}

// ============================================
// AI FUNCTION TYPES
// ============================================

export interface AIFunctionDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required: string[];
  };
}

export interface AIFunctionHandler {
  (args: Record<string, any>, context: AppContext): Promise<string> | string;
}

export interface AppAIFunction {
  definition: AIFunctionDefinition;
  handler: AIFunctionHandler;
}

export interface GridDefaults {
  height: number;
  minHeight: number;
  column: number;
  order: number;
}

export interface AppContext {
  state: any;
  updateState: (updates: any) => void;
  userProfile: UserProfile | null;
  allAppStates: Record<string, any>;
  // Event system methods
  emit: (eventName: string, data: any) => void;
  subscribe: (eventPattern: string, handler: AppEventHandler) => () => void;
}

export interface AppComponentProps {
  state: any;
  updateState: (updates: any) => void;
  userProfile: UserProfile | null;
  selectedDate?: string; // YYYY-MM-DD format, from space's date picker
  // Dashboard-wide settings (date format). Threaded through for the system
  // App Settings tile, which manages global prefs rather than instance state.
  // Other apps ignore these.
  appSettings?: GlobalAppSettings;
  updateAppSettings?: (settings: Partial<GlobalAppSettings>) => void;
}

export interface AppDefinition<TState = any> {
  id: string;
  type: string;
  title: string;
  description: string;
  icon?: string;
  component: ComponentType<AppComponentProps>;
  defaultState: TState;
  aiFunctions: AppAIFunction[];
  gridDefaults: GridDefaults;
  getSummary?: (state: TState) => string;
  // Event system
  events?: AppEvents;
  // Settings - renders in modal from title bar ⚙ button
  settings?: AppSettings;
  // Queryable data - allows AI to query app data
  queryableData?: AppQueryableData[];
  // Date picker integration - app uses the space's selected date
  usesDatePicker?: boolean;
  // System apps live only in the reserved Settings space — hidden from the
  // command palette's addable-app list so users don't scatter them elsewhere.
  system?: boolean;
}

export interface AppRegistry {
  apps: Record<string, AppDefinition>;
  register: (app: AppDefinition) => void;
  unregister: (appId: string) => void;
  get: (appId: string) => AppDefinition | undefined;
  getAll: () => AppDefinition[];
  getAllAIFunctions: () => { definition: AIFunctionDefinition; appId: string; handler: AIFunctionHandler }[];
}
