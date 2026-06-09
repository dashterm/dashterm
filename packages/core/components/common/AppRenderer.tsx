/**
 * Shared AppRenderer component used by both WebDashboard and MultiAppContainer.
 * Renders the appropriate app component based on app type and platform.
 *
 * After Phase 2, the only natively registered app is AIAssistant. Everything
 * else routes through:
 *   - registry.getApp(type) for plugin-registered apps (AgenticCoder/Scheduler
 *     overlays — these are dispatched but rarely encountered as tiles), or
 *   - customApps[id] for vibe-coded apps via Dynamic/WebView renderer.
 */

import React from 'react';
import { Text, Platform } from 'react-native';
import { SpaceAppLayout, UserProfile, SystemContext, EventLink, CustomApp } from '../../types';
import { getApp } from '../../registry';

import AIAssistant from '../../apps/AIAssistant';
import DynamicAppRenderer from '../DynamicAppRenderer';
import WebViewAppRenderer from '../WebViewAppRenderer';

export type { SystemContext };

export interface AppActions {
  addApp?: (appKey: any) => void;
  removeApp?: (appKey: any) => void;
  // Custom app actions — apps are stored in shared collection at apps/{shareCode}/
  createCustomApp?: (app: any) => Promise<string | null>;
  updateCustomApp?: (appId: string, updates: any) => Promise<boolean>;
  deleteCustomApp?: (appId: string) => Promise<boolean>;
  updateEventLinks?: (links: EventLink[]) => void;
  updateAppInstance?: (instanceId: string, updates: any) => void;
  addAppToSpace?: (spaceId: string, appId: string, appType: string) => void;
  updateCustomAppState?: (appId: string, updates: any) => void;
}

export interface AppRendererProps {
  appLayout: SpaceAppLayout;
  instanceState: any;
  updateInstance: (updates: any) => void;
  userProfile: UserProfile | null;
  customApps: Record<string, CustomApp>;
  // For AI app only
  systemContext?: SystemContext;
  appActions?: AppActions;
  // For custom app state updates
  updateCustomAppState?: (appId: string, updates: any) => void;
  // Selected date from space's date picker (YYYY-MM-DD format)
  selectedDate?: string;
  // Per-user relay API base for vibe-coded custom apps (derived from
  // AgenticCoder's relayUrl). Empty when the user hasn't configured a relay.
  apiBase: string;
}

export const AppRenderer: React.FC<AppRendererProps> = ({
  appLayout,
  instanceState,
  updateInstance,
  userProfile,
  customApps,
  systemContext,
  appActions,
  selectedDate,
  apiBase,
}) => {
  const appType = appLayout.type;
  const instanceId = appLayout.id;

  if (appType === 'ai') {
    if (!systemContext || !appActions) {
      return <Text style={{ color: '#ff0000' }}>AI requires systemContext and appActions</Text>;
    }
    return (
      <AIAssistant
        aiState={instanceState}
        onUpdateAI={updateInstance}
        systemContext={systemContext}
        appActions={appActions as any}
      />
    );
  }

  // Plugin-registered apps (overlays etc.)
  const registeredApp = getApp(appType);
  if (registeredApp?.component) {
    const AppComponent = registeredApp.component;
    return (
      <AppComponent
        state={instanceState}
        updateState={updateInstance}
        userProfile={userProfile}
        selectedDate={selectedDate}
      />
    );
  }

  // Vibe-coded apps from the shared apps/{shareCode} collection
  const customAppId = customApps?.[appLayout.type] ? appLayout.type : appLayout.id;
  const customApp = customApps?.[customAppId];

  if (customApp) {
    // Key on version so when the agent re-pushes an edited app, the renderer
    // remounts and recompiles from the new code — no full page refresh needed.
    const appKey = `${customApp.id}-v${customApp.version ?? 0}`;
    if (Platform.OS === 'web') {
      return (
        <DynamicAppRenderer
          key={appKey}
          customApp={customApp}
          appState={instanceState}
          onUpdateState={updateInstance}
          userProfile={userProfile}
          apiBase={apiBase}
        />
      );
    }
    return (
      <WebViewAppRenderer
        key={appKey}
        customApp={customApp}
        instanceId={instanceId}
        instanceState={instanceState}
        updateState={updateInstance}
        userProfile={userProfile}
        apiBase={apiBase}
      />
    );
  }

  return <Text style={{ color: '#ffffff' }}>App not found: {appType}</Text>;
};

export default AppRenderer;
