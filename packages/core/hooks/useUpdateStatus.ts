/**
 * Drives the dashboard update banner. Subscribes to the gateway's update
 * status (initial fetch + `update:available` WS pushes via
 * storage.subscribeUpdate), tracks a per-version dismissal in localStorage,
 * and exposes runUpdate() which POSTs /api/update/run.
 *
 * The banner only shows when the gateway reports `supported && available` and
 * the user hasn't dismissed this particular `latestVersion`.
 */

import { useCallback, useEffect, useState } from 'react';
import { storage } from '../storage';
import type { UpdateStatus } from '../storage/types';
import { beginUpdate } from '../services/updateProgress';

const DISMISS_KEY = 'dashterm:update-banner-dismissed:v1';

function loadDismissed(): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(DISMISS_KEY) : null;
  } catch {
    return null;
  }
}

export interface UseUpdateStatus {
  status: UpdateStatus | null;
  visible: boolean;
  running: boolean;
  error: string | null;
  runUpdate: () => Promise<void>;
  dismiss: () => void;
}

export function useUpdateStatus(): UseUpdateStatus {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(loadDismissed);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => storage.subscribeUpdate(setStatus), []);

  // Mirror the gateway's own `running` flag (an update started elsewhere, or
  // already in flight when this tab loaded) and raise the blocking modal so
  // observer tabs/devices don't just see the gateway vanish.
  useEffect(() => {
    if (status?.running) {
      setRunning(true);
      beginUpdate(status.latestVersion ?? status.currentVersion ?? '');
    }
  }, [status?.running, status?.latestVersion, status?.currentVersion]);

  const dismiss = useCallback(() => {
    const v = status?.latestVersion;
    if (!v) return;
    try {
      localStorage.setItem(DISMISS_KEY, v);
    } catch {
      /* private mode / no storage — dismissal just won't persist */
    }
    setDismissedVersion(v);
  }, [status?.latestVersion]);

  const runUpdate = useCallback(async () => {
    setError(null);
    setRunning(true);
    try {
      await storage.runUpdate();
      // Raise the full-screen modal immediately — the gateway is about to go
      // down for the rebuild, so this bridges the outage + page reloads.
      beginUpdate(status?.latestVersion ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRunning(false);
    }
  }, [status?.latestVersion]);

  const dismissed = !!status?.latestVersion && dismissedVersion === status.latestVersion;
  const visible = !!(status && status.supported && status.available && !dismissed);

  return { status, visible, running, error, runUpdate, dismiss };
}
