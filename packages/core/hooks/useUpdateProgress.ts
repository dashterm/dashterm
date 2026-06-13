/**
 * Drives the full-screen "updating" modal. Once an update starts (the banner
 * calls beginUpdate, or any tab observes status.running), this:
 *   - keeps the modal up across the reloads that happen while the gateway is
 *     down for the rebuild (flag is persisted in localStorage),
 *   - polls /api/update/status: unreachable → "restarting", reachable+building
 *     → "rebuilding", reached the target version → "complete" then reloads the
 *     page (to load the freshly-built bundle),
 *   - surfaces a "failed" state if the updater exits without reaching target
 *     (e.g. it rolled back), with a manual escape.
 *
 * Crucially this is consumed at the App level ABOVE the auth gate, so a failed
 * /api/auth/me during the outage shows the modal instead of the login screen.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { storage } from '../storage';
import {
  clearUpdate,
  clearUpdateSilent,
  getUpdateInProgress,
  subscribeUpdateProgress,
} from '../services/updateProgress';

const POLL_MS = 3000;
const MAX_AGE_MS = 20 * 60 * 1000; // a flag older than this is stale — don't wedge the UI
const FAIL_GRACE_MS = 90 * 1000; // don't call it "failed" until the build has had time to run
const RELOAD_DELAY_MS = 1500;

export type UpdatePhase = 'rebuilding' | 'restarting' | 'complete' | 'failed';

export interface UpdateProgress {
  active: boolean;
  phase: UpdatePhase;
  target: string | null;
  dismiss: () => void;
}

export function useUpdateProgress(): UpdateProgress {
  const [inProgress, setInProgress] = useState(getUpdateInProgress);
  const [phase, setPhase] = useState<UpdatePhase>('rebuilding');

  // React to beginUpdate/clearUpdate fired from anywhere (e.g. the banner).
  useEffect(
    () => subscribeUpdateProgress(() => setInProgress(getUpdateInProgress())),
    [],
  );

  const dismiss = useCallback(() => {
    clearUpdate();
    setInProgress(null);
  }, []);

  useEffect(() => {
    if (!inProgress) return;

    // Stale flag (browser closed during a past update, say) — recover instead
    // of blocking forever.
    if (Date.now() - inProgress.startedAt > MAX_AGE_MS) {
      clearUpdate();
      setInProgress(null);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = () => {
      setPhase('complete');
      // Clear the flag WITHOUT emitting so this effect (and its reload timer)
      // stays alive; the post-reload mount then sees no flag.
      clearUpdateSilent();
      timer = setTimeout(() => {
        if (typeof window !== 'undefined' && window.location) window.location.reload();
        else {
          clearUpdate();
          setInProgress(null);
        }
      }, RELOAD_DELAY_MS);
    };

    const poll = async () => {
      try {
        const s = await storage.getUpdateStatus();
        if (cancelled) return;
        const reachedTarget = !!(inProgress.target && s.currentVersion === inProgress.target);
        const upToDate = !s.running && !s.available;
        if (reachedTarget || upToDate) {
          finish();
          return;
        }
        const elapsed = Date.now() - inProgress.startedAt;
        if (!s.running && s.available && elapsed > FAIL_GRACE_MS) {
          setPhase('failed'); // updater exited without reaching target → rolled back / failed
          return; // stop polling; user dismisses or reloads
        }
        setPhase('rebuilding'); // gateway up, build still running
      } catch {
        if (!cancelled) setPhase('restarting'); // gateway unreachable — down for the rebuild
      }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [inProgress]);

  return {
    active: !!inProgress,
    phase,
    target: inProgress?.target ?? null,
    dismiss,
  };
}
