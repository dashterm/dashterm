export interface CustomAppFunction {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
}

export interface CustomAppQueryableData {
  name: string; // e.g., 'items', 'tasks'
  description: string;
  itemName: string; // Singular, e.g., 'item', 'task'
  fields: Record<string, {
    type: 'string' | 'number' | 'boolean' | 'date' | 'array';
    filterable?: boolean;
    sortable?: boolean;
    searchable?: boolean;
  }>;
  examples?: string[];
}

// Visibility options for shared apps
export type AppVisibility = 'private' | 'unlisted' | 'public';

export interface CustomApp {
  id: string; // 5-character share code (e.g., "K7XM2") - also the primary key
  name: string; // Display name (e.g., "Countdown Timer")
  description: string;
  code: string; // React component code as string
  compiledCode?: string; // Pre-compiled code for faster execution
  functions?: CustomAppFunction[]; // AI-callable functions extracted from code
  queryableData?: CustomAppQueryableData[]; // Queryable data sources
  ownerId: string; // User ID of creator
  ownerName?: string; // Display name of creator (denormalized for display)
  visibility: AppVisibility; // Who can access this app
  createdAt: number;
  updatedAt: number;
  version: number; // Incremented on each edit
  category?: string; // Optional category for organization
  // Relay workspace this app was last pushed from. Set by the relay's
  // push_app handler. Used by the CMD-K overlays to default-filter the
  // workspace list to "related to current space".
  originWorkspace?: string;
  // Note: App-specific state is stored under users/{uid}/appState/appInstances/{instanceId}
}

// Dynamic event links created by the AI
export interface EventLink {
  id: string;
  name: string;                    // User-friendly name (e.g., "Auto-complete workout habit")
  sourceEvent: string;             // Event pattern to listen for (e.g., "workout:set-logged")
  targetApp: string;               // App to update (e.g., "habit")
  targetAction: string;            // AI function to call (e.g., "completeHabit")
  actionParams: Record<string, any>; // Parameters for the action
  enabled: boolean;
  createdAt: number;
}

export interface AppState {
  lastUpdated: number;
  deviceType: 'mobile' | 'web';
  // The currently-focused app on mobile. 'ai' is always available; everything
  // else is a custom-app shareCode or a registered overlay type.
  currentMobileApp: 'ai' | string;
  // Apps currently available to the user (the AI assistant plus any custom
  // apps they've added to spaces).
  activeApps: Array<'ai' | string>;
  // The AI assistant has stable per-user state (preferences, goals,
  // automation rules); it isn't per-instance like other apps.
  aiApp: AIState;
  customApps: { [appId: string]: CustomApp }; // Vibe-coded apps from apps/{shareCode}
  appInstances: { [instanceId: string]: any }; // Instance-specific state for apps in spaces
  eventLinks: EventLink[]; // Dynamic event links created by AI
  webLayout: WebLayoutState;
  // Global overlays (AgenticCoder, Scheduler) — single shared state per user,
  // opened via CMD-K leader keys, not tile-able in Spaces.
  overlays?: OverlayState;
  userId?: string;
}

export interface OverlayState {
  agenticCoder?: any;
  scheduler?: any;
  events?: any;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  createdAt: number;
  lastActive: number;
}

export interface UserData {
  profile: UserProfile;
  appState: AppState;
}



// Space settings
export interface SpaceSettings {
  showDatePicker?: boolean;
}

// Space definition for multi-dashboard support
export interface Space {
  id: string;
  name: string;
  icon?: string;
  gridColumns: number;  // 2-6 columns
  gridRows: number;     // 2-4 rows
  apps: SpaceAppLayout[];
  createdAt: number;
  order: number;  // For ordering in space selector
  settings?: SpaceSettings;
  // Reserved system space (the Settings space): can't be deleted, hidden from
  // the normal tab bar / ⌘1-9 rotation, reached via the gear button.
  reserved?: boolean;
}

// App layout within a space
export interface SpaceAppLayout {
  id: string;
  type: string;  // 'todo', 'ai', 'custom', etc.
  // Grid positioning (0-indexed)
  column: number;
  row: number;
  // Span (how many cells it occupies)
  colSpan: number;  // 1 to gridColumns
  rowSpan: number;  // 1 to gridRows
}

// App-wide settings (persisted per user)
export interface AppSettings {
  dateFormat: 'US' | 'UK' | 'ISO';  // US: MM/DD/YYYY, UK: DD/MM/YYYY, ISO: YYYY-MM-DD
}

export interface WebLayoutState {
  spaces: Space[];
  activeSpaceId: string;
  appSettings?: AppSettings;
  // Legacy fields for migration
  apps?: GridAppLayout[];
  columnCount?: number;
}

export interface GridAppLayout {
  id: string;
  type: 'demo' | 'workout' | 'todo' | 'ai' | 'countdown' | 'pomodoro' | 'habit' | 'ticker' | 'weather' | 'portfolio' | 'gmail' | 'calendar' | 'custom';
  height: number; // Height in grid units
  column: number; // Column index (0-based)
  order: number; // Order within column
}

export interface AppWindow {
  id: string;
  type: 'demo' | 'workout' | 'todo' | 'ai';
  position: { x: number; y: number };
  size: { width: number; height: number };
  zIndex: number;
}

// AI State Interfaces
export interface AIState {
  conversations: Conversation[];
  activeConversation: string | null;
  goals: Goal[];
  insights: {
    workout: WorkoutInsight[];
    todo: TodoInsight[];
    system: SystemInsight[];
  };
  automationRules: AutomationRule[];
  preferences: AIPreferences;
  userContext: UserContext;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  lastActivity: number;
  appContext?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  appContext?: string;
  actions?: AIAction[];
}

export interface Goal {
  id: string;
  title: string;
  description: string;
  category: 'fitness' | 'productivity' | 'learning' | 'custom';
  type: 'outcome' | 'process' | 'habit';
  specific: string;
  measurable: MetricTarget;
  achievable: boolean;
  relevant: string;
  timebound: {
    startDate: number;
    targetDate: number;
    checkpointDates: number[];
  };
  basedOnData: {
    sourceApp: string;
    analysisSnapshot: any;
    confidence: number;
  };
  progress: {
    currentValue: number;
    targetValue: number;
    lastUpdated: number;
    milestones: Milestone[];
  };
  supportingActions: SupportingAction[];
  status: 'active' | 'completed' | 'paused' | 'cancelled';
}

export interface MetricTarget {
  metric: string;
  current: number;
  target: number;
  unit: string;
  trackingSource: 'manual' | 'workout_app' | 'todo_app' | 'auto';
}

export interface Milestone {
  id: string;
  description: string;
  targetValue: number;
  achieved: boolean;
  achievedDate?: number;
}

export interface SupportingAction {
  id: string;
  description: string;
  type: 'reminder' | 'todo' | 'automation' | 'resource';
  completed: boolean;
  dueDate?: number;
}

export interface WorkoutInsight {
  id: string;
  type: 'progression' | 'plateau' | 'consistency' | 'preference';
  title: string;
  description: string;
  data: any;
  confidence: number;
  generatedAt: number;
  actionable: boolean;
}

export interface TodoInsight {
  id: string;
  type: 'productivity' | 'pattern' | 'priority' | 'timing';
  title: string;
  description: string;
  data: any;
  confidence: number;
  generatedAt: number;
  actionable: boolean;
}

export interface SystemInsight {
  id: string;
  type: 'usage' | 'integration' | 'optimization' | 'behavior';
  title: string;
  description: string;
  data: any;
  confidence: number;
  generatedAt: number;
  actionable: boolean;
}

export interface AutomationRule {
  id: string;
  name: string;
  description: string;
  trigger: {
    app: string;
    event: string;
    conditions: Record<string, any>;
  };
  actions: AIAction[];
  enabled: boolean;
  createdAt: number;
  lastTriggered?: number;
}

export interface AIAction {
  type: 'updateApp' | 'sendMessage' | 'createReminder' | 'generateReport' | 'createGoal';
  target: string;
  payload: any;
}

export interface AIPreferences {
  model: 'claude' | 'gpt-4' | 'local';
  personality: 'helpful' | 'motivational' | 'technical' | 'casual';
  privacyLevel: 'minimal' | 'balanced' | 'full';
  enabledApps: ('workout' | 'todo' | 'demo')[];
  autoGoalGeneration: boolean;
  reminderFrequency: 'daily' | 'weekly' | 'monthly';
}

export interface UserContext {
  goals: string[];
  preferences: Record<string, any>;
  patterns: UserPattern[];
  learningProfile: LearningProfile;
}

export interface UserPattern {
  id: string;
  type: string;
  pattern: string;
  frequency: number;
  confidence: number;
  lastObserved: number;
}

export interface LearningProfile {
  workoutPreferences: string[];
  productivityStyle: string;
  motivationTriggers: string[];
  communicationStyle: string;
}

// System Context for AI Cross-App Access.
//
// After Phase 2 the AI doesn't have direct knowledge of "workout state" or
// "todo state" — those apps now live in the apps/{shareCode} collection and
// are accessed generically via customApps + appInstances. The AI reaches a
// per-app state by looking up its instanceId in appInstances.
export interface SystemContext {
  userProfile: UserProfile;
  deviceType: 'mobile' | 'web';
  currentApp: string;
  customApps?: { [appId: string]: CustomApp };
  appInstances?: { [instanceId: string]: any };
  spaces?: Space[];
  activeSpaceId?: string;
  currentAIInstanceId?: string; // The instance ID of the AI assistant making the request
  eventLinks?: EventLink[]; // Dynamic event links created by AI
}