import React from 'react';
import { AppDefinition, AppComponentProps, AppContext } from '../../registry/types';
import { AIState } from '../../types';
import AIAssistant from './index';
import AIAssistantSettings from './Settings';

const aiDefaultState: AIState = {
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
    enabledApps: ['workout', 'todo'],
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

export const aiPlugin: AppDefinition<AIState> = {
  id: 'ai',
  type: 'ai',
  title: 'AI ASSISTANT',
  description: 'Chat interface with cross-app integration and function calling',
  icon: '🤖',
  component: AIAssistant as any,
  defaultState: aiDefaultState,
  gridDefaults: {
    height: 500,
    minHeight: 400,
    column: 0,
    order: 1,
  },
  aiFunctions: [],
  getSummary: (state: AIState): string => {
    const conversations = state?.conversations || [];
    const totalMessages = conversations.reduce(
      (sum, c) => sum + (c.messages?.length || 0),
      0
    );
    return `${conversations.length} conversations, ${totalMessages} messages`;
  },
  settings: {
    renderSettings: (ctx) => React.createElement(AIAssistantSettings, ctx),
  },
};
