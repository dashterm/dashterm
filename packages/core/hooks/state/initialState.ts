import { AppState } from '../../types/index';
import { Platform } from 'react-native';
import { buildSystemSpace, systemInstanceStates } from './systemSpace';

export const initialState: AppState = {
  lastUpdated: Date.now(),
  deviceType: Platform.OS === 'web' ? 'web' : 'mobile',
  currentMobileApp: 'ai',
  activeApps: ['ai'],
  aiApp: {
    conversations: [],
    activeConversation: null,
    goals: [],
    insights: {
      workout: [],
      todo: [],
      system: [],
    },
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
  },
  customApps: {},
  appInstances: { ...systemInstanceStates() },
  eventLinks: [],
  overlays: {
    agenticCoder: { workspace: 'default', recentPushes: [], logsByWorkspace: {} },
    scheduler: { workspace: 'default' },
  },
  webLayout: {
    spaces: [
      {
        id: 'default',
        name: 'Dashboard',
        gridColumns: 3,
        gridRows: 2,
        apps: [],
        createdAt: Date.now(),
        order: 0,
      },
      buildSystemSpace(Date.now()),
    ],
    activeSpaceId: 'default',
    // Legacy fields for migration
    apps: [],
    columnCount: 3,
  },
};
