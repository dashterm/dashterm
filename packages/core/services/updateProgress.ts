/**
 * Cross-component store for "an update is being applied right now".
 *
 * Persisted in localStorage because the page reloads while the gateway is down
 * mid-update (the running bundle is the OLD one until the gateway restarts on
 * the new version), and we must keep the blocking modal up across that reload.
 * A module-level subscription lets the App-level modal react the instant the
 * banner triggers an update, without threading state through the tree.
 *
 * A small in-memory mirror keeps it working in private-mode browsers where
 * localStorage throws (it just won't survive a reload there).
 */

const KEY = 'dashterm:update-in-progress';

export interface UpdateInProgress {
  target: string; // version we're updating to
  startedAt: number; // ms epoch
}

let memory: UpdateInProgress | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const cb of listeners) {
    try {
      cb();
    } catch {
      /* ignore listener errors */
    }
  }
}

export function getUpdateInProgress(): UpdateInProgress | null {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (raw) return JSON.parse(raw) as UpdateInProgress;
  } catch {
    /* fall through to memory mirror */
  }
  return memory;
}

export function beginUpdate(target: string): void {
  memory = { target, startedAt: Date.now() };
  try {
    localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    /* private mode — modal still shows this session via the memory mirror */
  }
  emit();
}

export function clearUpdate(): void {
  memory = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  emit();
}

/**
 * Clear the persisted flag WITHOUT notifying subscribers. Used right before a
 * completion reload: we want the post-reload mount to see no flag (so the modal
 * doesn't reappear), but we must not tear down the current modal/effect — that
 * would cancel the pending reload timer.
 */
export function clearUpdateSilent(): void {
  memory = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function subscribeUpdateProgress(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
