/**
 * Returns the default state for a given app type.
 * Used when creating new app instances in Spaces.
 *
 * After Phase 2 only the AI assistant and the server overlays
 * (AgenticCoder, Scheduler) have known shapes — everything else is a
 * vibe-coded app whose default state is declared in its own source.
 */
export const getDefaultStateForAppType = (appType: string): any => {
  switch (appType) {
    case 'ai':
      return {
        conversations: [],
        activeConversation: null,
        goals: [],
        insights: { workout: [], todo: [], system: [] },
        automationRules: [],
        preferences: {
          model: 'claude',
          personality: 'helpful',
          privacyLevel: 'balanced',
          enabledApps: [],
          autoGoalGeneration: true,
          reminderFrequency: 'weekly',
        },
        userContext: {
          goals: [],
          preferences: {},
          patterns: [],
          learningProfile: {
            workoutPreferences: [],
            productivityStyle: 'balanced',
            motivationTriggers: [],
            communicationStyle: 'friendly',
          },
        },
      };
    case 'agenticcoder':
      return { relayUrl: '', workspace: 'default', recentPushes: [], logsByWorkspace: {} };
    case 'scheduler':
      return { relayUrl: '', workspace: 'default' };
    default:
      return {};
  }
};
