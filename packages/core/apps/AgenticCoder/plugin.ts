import React from 'react';
import { AppDefinition, AppComponentProps } from '../../registry/types';
import AgenticCoder from './index';
import AgenticCoderSettings from './Settings';

interface AgenticCoderLogLine {
  id: string;
  kind: 'system' | 'user' | 'assistant' | 'tool' | 'stderr' | 'error' | 'push' | 'turn_end';
  text: string;
  ts: number;
}

interface AgenticCoderSession {
  id: string;
  createdAt: number;
  lastActivityAt: number;
  log: AgenticCoderLogLine[];
}

interface AgenticCoderState {
  relayUrl?: string;
  agent?: string;
  workspace?: string;
  recentPushes?: Array<{
    shareCode: string;
    name: string;
    version: number;
    pushedAt: number;
  }>;
  // Multiple sessions per workspace. The first item is the "live" session
  // — the one currently receiving messages from claude. Older items are
  // archived snapshots the user can browse without paying the context cost
  // on every new turn. Persisted so logs survive refresh + replicate via the WS state push.
  sessionsByWorkspace?: { [workspace: string]: AgenticCoderSession[] };
  // Which session the user is currently viewing per workspace. Defaults to
  // the most recent (sessions[0]) when missing.
  viewingSessionByWorkspace?: { [workspace: string]: string };
  // Legacy: previously the chat log was a single array per workspace. Kept
  // for one-time migration — if a workspace has no `sessionsByWorkspace`
  // entry but has a legacy log, the legacy log is loaded as a seed session.
  logsByWorkspace?: { [workspace: string]: AgenticCoderLogLine[] };
}

const defaultState: AgenticCoderState = {
  relayUrl: '',
  agent: 'claude',
  workspace: 'default',
  recentPushes: [],
  sessionsByWorkspace: {},
  viewingSessionByWorkspace: {},
};

export const agenticCoderPlugin: AppDefinition<AgenticCoderState> = {
  id: 'agenticcoder',
  type: 'agenticcoder',
  title: 'AGENTIC CODER',
  description: 'Build custom apps by chatting with a preconfigured CLI coding agent (Claude Code, Roo Code)',
  icon: '🛠',
  component: ({ state, updateState }: AppComponentProps) =>
    React.createElement(AgenticCoder, { appState: state, onUpdate: updateState }),
  defaultState,
  gridDefaults: {
    height: 560,
    minHeight: 360,
    column: 0,
    order: 8,
  },
  aiFunctions: [],
  settings: {
    renderSettings: (ctx) => React.createElement(AgenticCoderSettings, ctx),
  },
  getSummary: (state) => {
    const ws = state?.workspace || 'default';
    const pushes = state?.recentPushes || [];
    const sessions = state?.sessionsByWorkspace?.[ws] || [];
    const legacy = state?.logsByWorkspace?.[ws] || [];
    const sessionCount = sessions.length > 0 ? sessions.length : (legacy.length > 0 ? 1 : 0);
    const sessionPart = sessionCount > 0 ? ` · ${sessionCount} session${sessionCount === 1 ? '' : 's'}` : '';
    if (!state?.relayUrl) return `${ws} · no relay configured`;
    if (pushes.length === 0) return `${ws}${sessionPart}`;
    return `${ws}${sessionPart} · ${pushes.length} push${pushes.length === 1 ? '' : 'es'}`;
  },
};
