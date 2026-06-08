/**
 * useSharedApps - Hook for managing apps in the top-level shared collection.
 *
 * Apps are stored at: apps/{shareCode}/
 * This allows any user to access apps by their share code.
 *
 * Storage access goes through the StorageProvider — this hook doesn't
 * import the backend SDK directly.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { storage } from '../storage';
import { CustomApp } from '../types';
import { useAuth } from './useAuth';
import { generateShareCode } from '../utils/shareCode';

interface UseSharedAppsReturn {
  ownedApps: CustomApp[];
  getAppByCode: (code: string) => Promise<CustomApp | null>;
  createApp: (app: Omit<CustomApp, 'id' | 'ownerId' | 'ownerName' | 'createdAt' | 'updatedAt' | 'version'>) => Promise<string | null>;
  updateApp: (code: string, updates: Partial<CustomApp>) => Promise<boolean>;
  deleteApp: (code: string) => Promise<boolean>;
  isLoading: boolean;
  subscribeToApp: (code: string, callback: (app: CustomApp | null) => void) => () => void;
}

export function useSharedApps(): UseSharedAppsReturn {
  const { user, isAuthenticated } = useAuth();
  const [ownedApps, setOwnedApps] = useState<CustomApp[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const subscriptionsRef = useRef<Map<string, () => void>>(new Map());

  // Load apps owned by current user — subscribes to all apps and filters.
  // (Phase 5 may swap for an indexed subscribeOwnedApps once RLS allows it.)
  useEffect(() => {
    if (!isAuthenticated || !user) {
      setOwnedApps([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    const unsubscribe = storage.subscribeApps((apps) => {
      const userApps = apps.filter((app) => app.ownerId === user.uid);
      setOwnedApps(userApps);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [isAuthenticated, user]);

  const getAppByCode = useCallback(async (code: string): Promise<CustomApp | null> => {
    try {
      const app = await storage.getApp(code);
      if (!app) return null;
      // Visibility check — private apps only readable by the owner
      if (app.visibility === 'private' && app.ownerId !== user?.uid) {
        console.warn('App is private and user is not owner');
        return null;
      }
      return app;
    } catch (error) {
      console.error('Error getting app by code:', error);
      return null;
    }
  }, [user]);

  const createApp = useCallback(async (
    appData: Omit<CustomApp, 'id' | 'ownerId' | 'ownerName' | 'createdAt' | 'updatedAt' | 'version'>
  ): Promise<string | null> => {
    if (!user) {
      console.error('Must be logged in to create an app');
      return null;
    }

    // Generate a unique share code (retry on collision)
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
      ...appData,
      id: shareCode,
      ownerId: user.uid,
      ownerName: user.displayName || user.email || 'Unknown',
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    try {
      await storage.setApp(shareCode, newApp);
      console.log(`✅ Created app with share code: ${shareCode}`);
      return shareCode;
    } catch (error) {
      console.error('Error creating app:', error);
      return null;
    }
  }, [user]);

  const updateApp = useCallback(async (
    code: string,
    updates: Partial<CustomApp>
  ): Promise<boolean> => {
    if (!user) {
      console.error('Must be logged in to update an app');
      return false;
    }

    try {
      const existingApp = await storage.getApp(code);
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

      await storage.setApp(code, updatedApp);
      console.log(`✅ Updated app: ${code}`);
      return true;
    } catch (error) {
      console.error('Error updating app:', error);
      return false;
    }
  }, [user]);

  const deleteApp = useCallback(async (code: string): Promise<boolean> => {
    if (!user) {
      console.error('Must be logged in to delete an app');
      return false;
    }

    try {
      const existingApp = await storage.getApp(code);
      if (!existingApp) {
        console.error('App not found');
        return false;
      }

      if (existingApp.ownerId !== user.uid) {
        console.error('Only the owner can delete this app');
        return false;
      }

      await storage.deleteApp(code);
      console.log(`🗑️ Deleted app: ${code}`);
      return true;
    } catch (error) {
      console.error('Error deleting app:', error);
      return false;
    }
  }, [user]);

  const subscribeToApp = useCallback((
    code: string,
    callback: (app: CustomApp | null) => void
  ): () => void => {
    const unsubscribe = storage.subscribeApp(code, (app) => {
      if (!app) {
        callback(null);
        return;
      }
      // Visibility check
      if (app.visibility === 'private' && app.ownerId !== user?.uid) {
        callback(null);
      } else {
        callback(app);
      }
    });

    subscriptionsRef.current.set(code, unsubscribe);
    return () => {
      unsubscribe();
      subscriptionsRef.current.delete(code);
    };
  }, [user]);

  // Cleanup all subscriptions on unmount
  useEffect(() => {
    return () => {
      subscriptionsRef.current.forEach((unsub) => unsub());
      subscriptionsRef.current.clear();
    };
  }, []);

  return {
    ownedApps,
    getAppByCode,
    createApp,
    updateApp,
    deleteApp,
    isLoading,
    subscribeToApp,
  };
}
