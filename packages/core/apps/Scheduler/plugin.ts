import React from 'react';
import { AppDefinition, AppComponentProps } from '../../registry/types';
import Scheduler from './index';

interface SchedulerState {
  // Optional override of the relay URL. Falls back to EXPO_PUBLIC_DASHTERM_URL.
  relayUrl?: string;
  // Which workspace's schedules.json this instance manages. Different
  // instances can target different workspaces.
  workspace?: string;
}

const defaultState: SchedulerState = {
  relayUrl: '',
  workspace: 'default',
};

export const schedulerPlugin: AppDefinition<SchedulerState> = {
  id: 'scheduler',
  type: 'scheduler',
  title: 'SCHEDULER',
  description: 'Set, view, and run scheduled LLM jobs by chatting with the agent',
  icon: '⏰',
  component: ({ state, updateState }: AppComponentProps) =>
    React.createElement(Scheduler, { appState: state, onUpdate: updateState }),
  defaultState,
  gridDefaults: {
    height: 520,
    minHeight: 320,
    column: 1,
    order: 9,
  },
  aiFunctions: [],
  getSummary: (state) => {
    const ws = state?.workspace || 'default';
    if (!state?.relayUrl) return `${ws} · no relay configured`;
    return `${ws} · scheduled tasks`;
  },
};
