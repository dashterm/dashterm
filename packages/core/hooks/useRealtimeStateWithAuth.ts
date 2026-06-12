import { useState, useEffect, useRef } from 'react';
import { storage } from '../storage';
import type { AuthUser } from '../storage';
import { AppState, UserProfile, UserData, Space, SpaceAppLayout, SpaceSettings, AppSettings, CustomApp, AppVisibility } from '../types/index';
import { Platform } from 'react-native';
import { useAuth } from './useAuth';
import { initialState, removeUndefinedValues, getDefaultStateForAppType, ensureSystemSpace } from './state';
import { generateShareCode } from '../utils/shareCode';

// Test mode check - uses local state only, no remote backend
const IS_TEST_MODE = process.env.EXPO_PUBLIC_TEST_MODE === 'true';

export const useRealtimeStateWithAuth = () => {
  const { user, isAuthenticated } = useAuth();
  const [state, setState] = useState<AppState>(initialState);
  const stateRef = useRef<AppState>(initialState);
  const [isConnected, setIsConnected] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isUpdatingFromServer, setIsUpdatingFromServer] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const hasLoadedFromServer = useRef(false);
  const lastProcessedTimestamp = useRef(0);

  // Keep ref in sync with state
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const createUserProfile = (user: AuthUser): UserProfile => ({
    uid: user.uid,
    email: user.email || '',
    displayName: user.displayName || 'Unknown User',
    photoURL: user.photoURL || undefined,
    createdAt: Date.now(),
    lastActive: Date.now(),
  });

  // TEST MODE: Initialize with local state, no remote backend
  useEffect(() => {
    if (IS_TEST_MODE) {
      console.log('🧪 TEST MODE: Using local state, no remote backend');
      const testProfile: UserProfile = {
        uid: 'test-user-123',
        email: 'testuser@example.com',
        displayName: 'Test User',
        createdAt: Date.now(),
        lastActive: Date.now(),
      };
      setUserProfile(testProfile);
      setIsConnected(true);
      setIsLoading(false);
      return;
    }
  }, []);

  useEffect(() => {
    // Skip remote sync in test mode
    if (IS_TEST_MODE) {
      return;
    }

    if (!isAuthenticated || !user) {
      setState(initialState);
      stateRef.current = initialState;
      setIsConnected(false);
      setUserProfile(null);
      setIsLoading(false);
      hasLoadedFromServer.current = false; // Reset on logout
      return;
    }

    setIsLoading(true);

    // Reset the flag when user changes (e.g., on reload or login)
    hasLoadedFromServer.current = false;

    // Create or update user profile
    const profile = createUserProfile(user);
    setUserProfile(profile);

    setIsConnected(true);

    const unsubscribe = storage.subscribeUserData(user.uid, (userData) => {
      try {
        if (userData) {
          // On first load (after auth), always load from the server. After that, only if the server copy is newer.
          const localStateTimestamp = stateRef.current?.lastUpdated || 0;
          const remoteTimestamp = userData.appState?.lastUpdated || 0;
          const isFirstLoad = !hasLoadedFromServer.current;
          const shouldLoadFromServer = isFirstLoad || remoteTimestamp > localStateTimestamp;

          // Prevent processing the same timestamp multiple times — but
          // never dedup on the first load. A brand-new user has no row
          // in app_state yet, so remoteTimestamp = 0 and
          // lastProcessedTimestamp.current = 0; without the isFirstLoad
          // bypass we'd skip the bootstrap entirely and leave
          // isUpdatingFromServer stuck at true → every updateState() call
          // silently no-ops and the dashboard appears frozen.
          if (!isFirstLoad && remoteTimestamp <= lastProcessedTimestamp.current) {
            setIsLoading(false);
            return;
          }

          setIsUpdatingFromServer(true);

          if (shouldLoadFromServer) {
            const newState: AppState = {
              ...initialState, // Ensure all defaults are present
              ...userData.appState,
              userId: user.uid,
              deviceType: (Platform.OS === 'web' ? 'web' : 'mobile') as 'web' | 'mobile',
              lastUpdated: userData.appState.lastUpdated,
              // Ensure activeApps has a value
              activeApps: userData.appState.activeApps || initialState.activeApps
            };

            // AgenticCoder and Scheduler used to be tile-able plugin apps.
            // They've since been promoted to global overlays (CMD-K opener).
            // Silently strip any leftover tile entries from spaces so users
            // who had them placed don't see broken / duplicate widgets.
            const GLOBAL_OVERLAY_TYPES = new Set(['agenticcoder', 'scheduler']);
            if (newState.webLayout?.spaces) {
              newState.webLayout = {
                ...newState.webLayout,
                spaces: newState.webLayout.spaces.map(s => ({
                  ...s,
                  apps: (s.apps || []).filter(a => !GLOBAL_OVERLAY_TYPES.has(a.type)),
                })),
              };
            }

            // Heal the reserved Settings space onto existing accounts (new
            // users already get it from initialState). Idempotent.
            const ensuredState = ensureSystemSpace(newState);

            setState(ensuredState);
            stateRef.current = ensuredState;

            if (userData.profile) {
              setUserProfile(userData.profile);
            }
            hasLoadedFromServer.current = true;
            lastProcessedTimestamp.current = remoteTimestamp;
          }
          setIsUpdatingFromServer(false);
          setIsLoading(false);
        } else {
          // First time user, initialize with default state
          const newUserData: UserData = {
            profile,
            appState: {
              ...initialState,
              userId: user.uid,
              deviceType: Platform.OS === 'web' ? 'web' : 'mobile',
              lastUpdated: Date.now()
            }
          };

          setIsUpdatingFromServer(true);
          setState(newUserData.appState);
          stateRef.current = newUserData.appState;
          setIsUpdatingFromServer(false);
          setIsLoading(false);

          storage.setUserData(user.uid, newUserData).catch(error => {
            console.error('Failed to initialize user data:', error);
            setIsConnected(false);
          });
        }
      } catch (error) {
        console.error('Error processing user data:', error);
        setIsConnected(false);
      }
    });

    return () => unsubscribe();
  }, [isAuthenticated, user]);

  // Listen for custom apps from the shared apps collection
  // Apps are stored at apps/{shareCode}/ and we filter by ownerId
  useEffect(() => {
    if (IS_TEST_MODE || !isAuthenticated || !user) {
      return;
    }

    const unsubscribe = storage.subscribeApps((allApps) => {
      try {
        const userApps = allApps.filter((app) => app.ownerId === user.uid);

        // Convert to object keyed by share code (id)
        const customAppsObj: { [appId: string]: CustomApp } = {};
        userApps.forEach((app) => {
          customAppsObj[app.id] = app;
        });

        // Update state with the user's custom apps
        const currentState = stateRef.current;
        if (JSON.stringify(currentState.customApps) !== JSON.stringify(customAppsObj)) {
          setState(prev => ({
            ...prev,
            customApps: customAppsObj,
          }));
          stateRef.current = {
            ...stateRef.current,
            customApps: customAppsObj,
          };
        }
      } catch (error) {
        console.error('Error loading custom apps from shared collection:', error);
      }
    });

    return () => unsubscribe();
  }, [isAuthenticated, user]);

  const updateState = async (updates: Partial<AppState>) => {
    // TEST MODE: Only update local state, no remote backend
    if (IS_TEST_MODE) {
      const currentState = stateRef.current;
      const newState = {
        ...currentState,
        ...updates,
        lastUpdated: Date.now(),
        deviceType: Platform.OS === 'web' ? 'web' : 'mobile' as 'web' | 'mobile',
        userId: 'test-user-123'
      };
      setState(newState);
      stateRef.current = newState;
      return;
    }

    if (!isAuthenticated || !user || !userProfile || isUpdatingFromServer) {
      return;
    }

    // Always use the latest state from ref to avoid stale closures
    const currentState = stateRef.current;

    const newState = {
      ...currentState,
      ...updates,
      lastUpdated: Date.now(),
      deviceType: Platform.OS === 'web' ? 'web' : 'mobile' as 'web' | 'mobile',
      userId: user.uid
    };


    // Update local state immediately to prevent race conditions
    setState(newState);
    stateRef.current = newState;

    const updatedUserData: UserData = {
      profile: {
        ...userProfile,
        lastActive: Date.now()
      },
      appState: newState
    };

    // Clean undefined values before sending to the backend
    const cleanedUserData = removeUndefinedValues(updatedUserData);

    try {
      await storage.setUserData(user.uid, cleanedUserData);
    } catch (error) {
      console.error('Failed to update state:', error);
      // Revert state on error
      setState(currentState);
      stateRef.current = currentState;
    }
  };

  const setCurrentMobileApp = (app: AppState['currentMobileApp']) => {
    updateState({ currentMobileApp: app });
  };

  const updateAIApp = (updates: Partial<AppState['aiApp']>) => {
    // Use current state from ref to avoid stale closures
    const currentAIApp = stateRef.current?.aiApp || {
      conversations: [],
      activeConversation: null,
      goals: [],
      insights: { workout: [], todo: [], system: [] },
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

    updateState({
      aiApp: {
        ...currentAIApp,
        ...updates
      }
    });
  };

  // Helper functions for app management
  const addApp = (appKey: AppState['currentMobileApp']) => {
    const currentApps = stateRef.current?.activeApps || ['ai'];

    // Don't add if already active
    if (currentApps.includes(appKey)) {
      return;
    }

    const updatedApps = [...currentApps, appKey];

    updateState({
      activeApps: updatedApps,
      currentMobileApp: appKey // Switch to the newly added app
    });
  };

  const removeApp = (appKey: AppState['currentMobileApp']) => {
    const currentApps = stateRef.current?.activeApps || ['ai'];

    // Don't allow removing AI app
    if (appKey === 'ai') {
      return;
    }

    // Don't remove if not active
    if (!currentApps.includes(appKey)) {
      return;
    }

    const updatedApps = currentApps.filter(app => app !== appKey);

    // If we're removing the current app, switch to AI
    const newCurrentApp = stateRef.current?.currentMobileApp === appKey
      ? 'ai'
      : stateRef.current?.currentMobileApp;

    updateState({
      activeApps: updatedApps,
      currentMobileApp: newCurrentApp
    });
  };

  // Helper functions for custom app management
  // Apps are stored in the shared collection at apps/{shareCode}/
  const createCustomApp = async (appData: Omit<CustomApp, 'id' | 'ownerId' | 'ownerName' | 'createdAt' | 'updatedAt' | 'version'>): Promise<string | null> => {
    if (!user) {
      console.error('Must be logged in to create an app');
      return null;
    }

    // Generate a unique share code
    let shareCode: string;
    let attempts = 0;
    const maxAttempts = 10;

    do {
      shareCode = generateShareCode();
      const existing = await storage.getApp(shareCode);
      if (!existing) break;
      attempts++;
    } while (attempts < maxAttempts);

    if (attempts >= maxAttempts) {
      console.error('Failed to generate unique share code');
      return null;
    }

    const now = Date.now();
    const newApp: CustomApp = {
      id: shareCode,
      name: appData.name,
      description: appData.description,
      code: appData.code,
      ownerId: user.uid,
      ownerName: userProfile?.displayName || user.email || 'Unknown',
      visibility: appData.visibility || 'private',
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    // Only add optional fields if they have values (some backends reject undefined)
    if (appData.compiledCode) newApp.compiledCode = appData.compiledCode;
    if (appData.functions && appData.functions.length > 0) newApp.functions = appData.functions;
    if (appData.queryableData && appData.queryableData.length > 0) newApp.queryableData = appData.queryableData;
    if (appData.category) newApp.category = appData.category;

    try {
      console.log(`📝 Attempting to write app to apps/${shareCode}`);
      console.log(`   User UID: ${user.uid}`);
      console.log(`   App data:`, JSON.stringify(newApp, null, 2).substring(0, 500));

      await storage.setApp(shareCode, newApp);
      console.log(`✅ Created app with share code: ${shareCode}`);

      // Update active apps to include the new custom app
      updateState({
        activeApps: [...(stateRef.current?.activeApps || ['ai']), shareCode],
        currentMobileApp: shareCode,
      });

      return shareCode;
    } catch (error: any) {
      console.error('❌ Error creating app at apps/' + shareCode);
      console.error('   Error code:', error?.code);
      console.error('   Error message:', error?.message);
      console.error('   Full error:', error);
      throw error; // Re-throw so it bubbles up properly
    }
  };

  const updateCustomApp = async (appId: string, updates: Partial<CustomApp>): Promise<boolean> => {
    if (!user) {
      console.error('Must be logged in to update an app');
      return false;
    }

    try {
      const existingApp = await storage.getApp(appId);

      if (!existingApp) {
        console.error('App not found');
        return false;
      }

      if (existingApp.ownerId !== user.uid) {
        console.error('Only the owner can update this app');
        return false;
      }

      // Don't allow changing id or ownerId
      const { id, ownerId, ...safeUpdates } = updates;

      const updatedApp: CustomApp = {
        ...existingApp,
        ...safeUpdates,
        updatedAt: Date.now(),
        version: existingApp.version + 1,
      };

      await storage.setApp(appId, updatedApp);
      console.log(`✅ Updated app: ${appId}`);
      return true;
    } catch (error) {
      console.error('Error updating app:', error);
      return false;
    }
  };

  // Note: In the new architecture, custom app state is stored in appInstances, not in the app definition
  // This function updates the instance state for a custom app
  const updateCustomAppState = (instanceId: string, stateUpdates: any) => {
    const currentInstances = stateRef.current?.appInstances || {};
    const currentInstanceState = currentInstances[instanceId] || {};

    updateState({
      appInstances: {
        ...currentInstances,
        [instanceId]: {
          ...currentInstanceState,
          ...stateUpdates,
        },
      },
    });
  };

  const deleteCustomApp = async (appId: string): Promise<boolean> => {
    console.log('[deleteCustomApp] Attempting to delete:', appId);

    if (!user) {
      console.error('[deleteCustomApp] Must be logged in to delete an app');
      return false;
    }

    try {
      const existingApp = await storage.getApp(appId);

      if (!existingApp) {
        console.error('[deleteCustomApp] App not found');
        return false;
      }

      if (existingApp.ownerId !== user.uid) {
        console.error('[deleteCustomApp] Only the owner can delete this app');
        return false;
      }

      console.log('[deleteCustomApp] All checks passed, deleting app:', appId);

      await storage.deleteApp(appId);
      console.log(`🗑️ Deleted app: ${appId}`);

      // Remove from activeApps
      const currentActiveApps = stateRef.current?.activeApps || ['ai'];
      const updatedActiveApps = currentActiveApps.filter(id => id !== appId);

      // If current app is being deleted, switch to AI
      const newCurrentApp = stateRef.current?.currentMobileApp === appId
        ? 'ai'
        : stateRef.current?.currentMobileApp;

      updateState({
        activeApps: updatedActiveApps,
        currentMobileApp: newCurrentApp,
      });

      return true;
    } catch (error) {
      console.error('[deleteCustomApp] Error deleting app:', error);
      return false;
    }
  };

  const updateWebLayout = (updates: Partial<AppState['webLayout']>) => {
    const currentLayout = stateRef.current?.webLayout || {
      spaces: [],
      activeSpaceId: 'default',
      apps: [],
      columnCount: 3,
    };

    updateState({
      webLayout: {
        ...currentLayout,
        ...updates,
      }
    });
  };

  // Space management functions
  const createSpace = (name: string, icon?: string) => {
    const currentLayout = stateRef.current?.webLayout || initialState.webLayout;
    const spaces = currentLayout.spaces || [];

    const newSpace: Space = {
      id: `space-${Date.now()}`,
      name,
      ...(icon ? { icon } : {}), // Only include icon if defined (some backends reject undefined)
      gridColumns: 3,
      gridRows: 2,
      apps: [],
      createdAt: Date.now(),
      order: spaces.length,
    };

    updateState({
      webLayout: {
        ...currentLayout,
        spaces: [...spaces, newSpace],
        activeSpaceId: newSpace.id,
      }
    });

    return newSpace.id;
  };

  const deleteSpace = (spaceId: string) => {
    const currentLayout = stateRef.current?.webLayout || initialState.webLayout;
    const spaces = currentLayout.spaces || [];

    // The reserved Settings space is permanent.
    const target = spaces.find(s => s.id === spaceId);
    if (target?.reserved) {
      console.warn('Cannot delete the reserved Settings space');
      return false;
    }

    // Don't delete if it would leave no normal (non-reserved) space.
    if (spaces.filter(s => !s.reserved).length <= 1) {
      console.warn('Cannot delete the last space');
      return false;
    }

    const filteredSpaces = spaces.filter(s => s.id !== spaceId);
    const firstNormal = filteredSpaces.find(s => !s.reserved) || filteredSpaces[0];
    const newActiveId = currentLayout.activeSpaceId === spaceId
      ? firstNormal.id
      : currentLayout.activeSpaceId;

    // Reorder remaining spaces
    const reorderedSpaces = filteredSpaces.map((s, index) => ({ ...s, order: index }));

    updateState({
      webLayout: {
        ...currentLayout,
        spaces: reorderedSpaces,
        activeSpaceId: newActiveId,
      }
    });

    return true;
  };

  const renameSpace = (spaceId: string, name: string, icon?: string) => {
    const currentLayout = stateRef.current?.webLayout || initialState.webLayout;
    const spaces = currentLayout.spaces || [];

    const updatedSpaces = spaces.map(s => {
      if (s.id !== spaceId) return s;
      const updated = { ...s, name };
      // Only set icon if provided, remove it if explicitly set to empty string
      if (icon !== undefined) {
        if (icon) {
          (updated as any).icon = icon;
        } else {
          delete (updated as any).icon;
        }
      }
      return updated;
    });

    updateState({
      webLayout: {
        ...currentLayout,
        spaces: updatedSpaces,
      }
    });
  };

  const switchSpace = (spaceId: string) => {
    const currentLayout = stateRef.current?.webLayout || initialState.webLayout;
    const spaces = currentLayout.spaces || [];

    if (spaces.some(s => s.id === spaceId)) {
      updateState({
        webLayout: {
          ...currentLayout,
          activeSpaceId: spaceId,
        }
      });
    }
  };

  const updateSpaceGrid = (spaceId: string, gridColumns: number, gridRows: number) => {
    const currentLayout = stateRef.current?.webLayout || initialState.webLayout;
    const spaces = currentLayout.spaces || [];

    const updatedSpaces = spaces.map(s =>
      s.id === spaceId ? { ...s, gridColumns, gridRows } : s
    );

    updateState({
      webLayout: {
        ...currentLayout,
        spaces: updatedSpaces,
      }
    });
  };

  const updateSpaceSettings = (spaceId: string, settings: Partial<SpaceSettings>) => {
    const currentLayout = stateRef.current?.webLayout || initialState.webLayout;
    const spaces = currentLayout.spaces || [];

    const updatedSpaces = spaces.map(s =>
      s.id === spaceId ? { ...s, settings: { ...s.settings, ...settings } } : s
    );

    updateState({
      webLayout: {
        ...currentLayout,
        spaces: updatedSpaces,
      }
    });
  };

  const updateAppSettings = (settings: Partial<AppSettings>) => {
    const currentLayout = stateRef.current?.webLayout || initialState.webLayout;
    const defaultAppSettings: AppSettings = { dateFormat: 'US' };

    updateState({
      webLayout: {
        ...currentLayout,
        appSettings: { ...defaultAppSettings, ...currentLayout.appSettings, ...settings },
      }
    });
  };

  const updateSpaceApps = (spaceId: string, apps: SpaceAppLayout[]) => {
    const currentLayout = stateRef.current?.webLayout || initialState.webLayout;
    const spaces = currentLayout.spaces || [];

    const updatedSpaces = spaces.map(s =>
      s.id === spaceId ? { ...s, apps } : s
    );

    updateState({
      webLayout: {
        ...currentLayout,
        spaces: updatedSpaces,
      }
    });
  };

  const addAppToSpace = (spaceId: string, appId: string, appType: string) => {
    const currentLayout = stateRef.current?.webLayout || initialState.webLayout;
    const spaces = currentLayout.spaces || [];
    const space = spaces.find(s => s.id === spaceId);

    if (!space) return;

    // Ensure apps array exists
    const spaceApps = space.apps || [];

    // Find first available position
    const occupiedCells = new Set<string>();
    spaceApps.forEach(app => {
      for (let c = app.column; c < app.column + app.colSpan; c++) {
        for (let r = app.row; r < app.row + app.rowSpan; r++) {
          occupiedCells.add(`${c},${r}`);
        }
      }
    });

    let newCol = 0, newRow = 0;
    outer: for (let r = 0; r < space.gridRows; r++) {
      for (let c = 0; c < space.gridColumns; c++) {
        if (!occupiedCells.has(`${c},${r}`)) {
          newCol = c;
          newRow = r;
          break outer;
        }
      }
    }

    // Generate unique instance ID
    const instanceId = `${appType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const newApp: SpaceAppLayout = {
      id: instanceId,
      type: appType,
      column: newCol,
      row: newRow,
      colSpan: 1,
      rowSpan: 1,
    };

    const updatedSpaces = spaces.map(s =>
      s.id === spaceId ? { ...s, apps: [...spaceApps, newApp] } : s
    );

    // Initialize instance state with default state for this app type
    const currentInstances = stateRef.current?.appInstances || {};
    const defaultInstanceState = getDefaultStateForAppType(appType);

    updateState({
      webLayout: {
        ...currentLayout,
        spaces: updatedSpaces,
      },
      appInstances: {
        ...currentInstances,
        [instanceId]: defaultInstanceState,
      },
    });
  };

  const removeAppFromSpace = (spaceId: string, appId: string) => {
    const currentLayout = stateRef.current?.webLayout || initialState.webLayout;
    const spaces = currentLayout.spaces || [];
    const space = spaces.find(s => s.id === spaceId);

    // Find the app to remove - check both id and type (for custom apps)
    const appToRemove = space?.apps?.find(a => a.id === appId || a.type === appId);
    const instanceIdToRemove = appToRemove?.id;

    const updatedSpaces = spaces.map(s =>
      s.id === spaceId ? { ...s, apps: (s.apps || []).filter(a => a.id !== appId && a.type !== appId) } : s
    );

    // Also remove instance state
    const currentInstances = { ...(stateRef.current?.appInstances || {}) };
    if (instanceIdToRemove) {
      delete currentInstances[instanceIdToRemove];
    }

    updateState({
      webLayout: {
        ...currentLayout,
        spaces: updatedSpaces,
      },
      appInstances: currentInstances,
    });
  };

  // Update instance-specific state
  const updateAppInstance = (instanceId: string, updates: any) => {
    const currentInstances = stateRef.current?.appInstances || {};
    const currentInstanceState = currentInstances[instanceId] || {};

    updateState({
      appInstances: {
        ...currentInstances,
        [instanceId]: {
          ...currentInstanceState,
          ...updates,
        },
      },
    });
  };

  // Get instance state
  const getAppInstanceState = (instanceId: string): any => {
    return stateRef.current?.appInstances?.[instanceId] || {};
  };

  // Update event links (for AI-created automations)
  const updateEventLinks = (links: import('../types').EventLink[]) => {
    console.log('[useRealtimeStateWithAuth] updateEventLinks called with', links.length, 'links');
    updateState({
      eventLinks: links,
    });
  };

  const updateAgenticCoderOverlay = (updates: any) => {
    const overlays = stateRef.current?.overlays || {};
    const current = overlays.agenticCoder || {};
    updateState({
      overlays: { ...overlays, agenticCoder: { ...current, ...updates } },
    });
  };

  const updateSchedulerOverlay = (updates: any) => {
    const overlays = stateRef.current?.overlays || {};
    const current = overlays.scheduler || {};
    updateState({
      overlays: { ...overlays, scheduler: { ...current, ...updates } },
    });
  };

  const updateEventsOverlay = (updates: any) => {
    const overlays = stateRef.current?.overlays || {};
    const current = overlays.events || {};
    updateState({
      overlays: { ...overlays, events: { ...current, ...updates } },
    });
  };

  const updateAppInSpace = (spaceId: string, appId: string, updates: Partial<SpaceAppLayout>) => {
    const currentLayout = stateRef.current?.webLayout || initialState.webLayout;
    const spaces = currentLayout.spaces || [];

    const updatedSpaces = spaces.map(s =>
      s.id === spaceId
        ? { ...s, apps: (s.apps || []).map(a => a.id === appId ? { ...a, ...updates } : a) }
        : s
    );

    updateState({
      webLayout: {
        ...currentLayout,
        spaces: updatedSpaces,
      }
    });
  };

  // Get current active space helper
  const getActiveSpace = (): Space | undefined => {
    const currentLayout = stateRef.current?.webLayout;
    if (!currentLayout?.spaces) return undefined;
    return currentLayout.spaces.find(s => s.id === currentLayout.activeSpaceId);
  };

  return {
    state,
    userProfile,
    isConnected: isConnected && isAuthenticated,
    isAuthenticated,
    isLoading,
    setCurrentMobileApp,
    updateAIApp,
    updateWebLayout,
    addApp,
    removeApp,
    createCustomApp,
    updateCustomApp,
    updateCustomAppState,
    deleteCustomApp,
    // Space management
    createSpace,
    deleteSpace,
    renameSpace,
    switchSpace,
    updateSpaceGrid,
    updateSpaceSettings,
    updateAppSettings,
    updateSpaceApps,
    addAppToSpace,
    removeAppFromSpace,
    updateAppInSpace,
    getActiveSpace,
    // Instance state management
    updateAppInstance,
    getAppInstanceState,
    // Event links
    updateEventLinks,
    // Global overlays (AgenticCoder, Scheduler — opened via CMD-K)
    updateAgenticCoderOverlay,
    updateSchedulerOverlay,
    updateEventsOverlay,
  };
};