import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

export type OverlayTarget = 'palette' | 'coder' | 'scheduler';

interface OverlayShortcutsApi {
  /** Which overlay is currently visible (null = none). */
  open: OverlayTarget | null;
  /** Open a specific overlay. */
  openOverlay: (target: OverlayTarget) => void;
  /** Close whatever's open. */
  closeOverlay: () => void;
}

/**
 * Direct keyboard shortcuts (no leader chord, no last-opened memory):
 *
 *   CMD-K / CTRL-K  → command palette
 *   CMD-J / CTRL-J  → agentic coder    (overrides Chrome/Firefox Downloads)
 *   CMD-I / CTRL-I  → scheduler        (overrides Firefox Page Info)
 *   ESC             → close current
 *
 * Each shortcut opens the specific overlay it targets — pressing the same
 * shortcut again does nothing extra; press a different one to switch.
 */
export function useOverlayShortcuts(): OverlayShortcutsApi {
  const [open, setOpen] = useState<OverlayTarget | null>(null);
  const openRef = useRef<OverlayTarget | null>(null);
  openRef.current = open;

  const openOverlay = useCallback((target: OverlayTarget) => {
    setOpen(target);
  }, []);

  const closeOverlay = useCallback(() => {
    setOpen(null);
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const isMac = typeof navigator !== 'undefined' && navigator.platform.indexOf('Mac') !== -1;

    const handleKey = (e: KeyboardEvent) => {
      // ESC always closes any open overlay
      if (e.key === 'Escape' && openRef.current) {
        e.preventDefault();
        setOpen(null);
        return;
      }

      // Modifier check: CMD on Mac, CTRL elsewhere. No shift/alt allowed —
      // those combos belong to the browser or other tooling.
      const hasModifier = isMac
        ? e.metaKey && !e.ctrlKey
        : e.ctrlKey && !e.metaKey;
      if (!hasModifier || e.shiftKey || e.altKey) return;

      const key = e.key.toLowerCase();
      let target: OverlayTarget | null = null;
      if (key === 'k') target = 'palette';
      else if (key === 'j') target = 'coder';
      else if (key === 'i') target = 'scheduler';

      if (target) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(target);
      }
    };

    // Capture phase so we beat focused inputs inside an open overlay.
    document.addEventListener('keydown', handleKey, true);
    return () => document.removeEventListener('keydown', handleKey, true);
  }, []);

  return { open, openOverlay, closeOverlay };
}
