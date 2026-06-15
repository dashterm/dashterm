/**
 * App Registry - Central configuration for all available apps
 */

export type AppType = 'ai' | 'demo' | 'workout' | 'todo' | 'countdown' | 'pomodoro' | 'habit' | 'ticker' | 'weather' | 'portfolio';

export interface AppMetadata {
  key: AppType;
  title: string;
  description: string;
  keywords: string[]; // For AI matching
  icon?: string;
  defaultHeight?: number; // For web grid layout
  minHeight?: number;
}

/**
 * Registry of all available apps in the system
 * Used by AI to add/remove apps and by UI to render them
 */
export const APP_REGISTRY: Record<AppType, AppMetadata> = {
  ai: {
    key: 'ai',
    title: 'AI ASSISTANT',
    description: 'Chat interface with cross-app integration and function calling',
    keywords: ['ai', 'assistant', 'chat', 'help', 'gemini'],
    defaultHeight: 7,
    minHeight: 5,
  },
  demo: {
    key: 'demo',
    title: 'DEMO TERMINAL',
    description: 'Original demo showcasing real-time sync capabilities',
    keywords: ['demo', 'terminal', 'test', 'example'],
    defaultHeight: 6,
    minHeight: 3,
  },
  workout: {
    key: 'workout',
    title: 'WORKOUT TRACKER',
    description: 'Track your fitness progress with exercises, sets, and timers',
    keywords: ['workout', 'fitness', 'exercise', 'gym', 'training', 'health'],
    defaultHeight: 6,
    minHeight: 5,
  },
  todo: {
    key: 'todo',
    title: 'TODO MANAGER',
    description: 'Manage tasks with priorities and filtering',
    keywords: ['todo', 'task', 'tasks', 'list', 'productivity', 'gtd'],
    defaultHeight: 5,
    minHeight: 4,
  },
  countdown: {
    key: 'countdown',
    title: 'COUNTDOWN',
    description: 'Track countdowns to important events',
    keywords: ['countdown', 'timer', 'event', 'date'],
    defaultHeight: 4,
    minHeight: 3,
  },
  pomodoro: {
    key: 'pomodoro',
    title: 'POMODORO',
    description: 'Focus timer using the Pomodoro Technique',
    keywords: ['pomodoro', 'focus', 'timer', 'productivity', 'work'],
    defaultHeight: 4,
    minHeight: 3,
  },
  habit: {
    key: 'habit',
    title: 'HABIT TRACKER',
    description: 'Track daily and weekly habits',
    keywords: ['habit', 'habits', 'routine', 'daily', 'weekly', 'streak'],
    defaultHeight: 5,
    minHeight: 4,
  },
  ticker: {
    key: 'ticker',
    title: 'TICKER',
    description: 'Track crypto and stock prices',
    keywords: ['ticker', 'stock', 'crypto', 'price', 'bitcoin', 'market'],
    defaultHeight: 4,
    minHeight: 3,
  },
  weather: {
    key: 'weather',
    title: 'WEATHER',
    description: 'Terminal-style weather dashboard with forecasts',
    keywords: ['weather', 'forecast', 'temperature', 'climate', 'rain', 'sun'],
    defaultHeight: 5,
    minHeight: 4,
  },
  portfolio: {
    key: 'portfolio',
    title: 'PORTFOLIO TRACKER',
    description: 'Track your investment portfolio with crypto and stocks',
    keywords: ['portfolio', 'investment', 'holdings', 'stocks', 'crypto', 'assets', 'trading', 'gains', 'losses'],
    defaultHeight: 6,
    minHeight: 5,
  },
};

/**
 * Get app metadata by key
 */
export function getAppMetadata(key: AppType): AppMetadata | undefined {
  return APP_REGISTRY[key];
}

/**
 * Find app by natural language description
 * Returns the best matching app key or null if no good match
 */
export function findAppByDescription(description: string): AppType | null {
  const lowerDesc = description.toLowerCase();

  // Check for exact matches first
  for (const [key, metadata] of Object.entries(APP_REGISTRY)) {
    if (lowerDesc.includes(key.toLowerCase())) {
      return key as AppType;
    }

    // Check keywords
    for (const keyword of metadata.keywords) {
      if (lowerDesc.includes(keyword.toLowerCase())) {
        return key as AppType;
      }
    }
  }

  return null;
}

/**
 * Get list of all available app types
 */
export function getAllAppTypes(): AppType[] {
  return Object.keys(APP_REGISTRY) as AppType[];
}
