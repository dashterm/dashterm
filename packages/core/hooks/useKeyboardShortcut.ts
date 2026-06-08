import { useEffect } from 'react';
import { Platform } from 'react-native';

interface UseKeyboardShortcutProps {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  onTrigger: () => void;
  enabled?: boolean;
}

export function useKeyboardShortcut({
  key,
  metaKey = false,
  ctrlKey = false,
  shiftKey = false,
  altKey = false,
  onTrigger,
  enabled = true
}: UseKeyboardShortcutProps) {
  useEffect(() => {
    if (Platform.OS !== 'web' || !enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const keyMatches = event.key.toLowerCase() === key.toLowerCase();
      const metaMatches = metaKey ? event.metaKey : !event.metaKey;
      const ctrlMatches = ctrlKey ? event.ctrlKey : !event.ctrlKey;
      const shiftMatches = shiftKey ? event.shiftKey : !event.shiftKey;
      const altMatches = altKey ? event.altKey : !event.altKey;

      if (keyMatches && metaMatches && ctrlMatches && shiftMatches && altMatches) {
        event.preventDefault();
        event.stopPropagation();
        onTrigger();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [key, metaKey, ctrlKey, shiftKey, altKey, onTrigger, enabled]);
}

// Helper hook for common CMD/CTRL+K pattern
export function useCommandK(onTrigger: () => void, enabled = true) {
  useKeyboardShortcut({
    key: 'k',
    metaKey: Platform.OS === 'web' && navigator.platform.indexOf('Mac') !== -1,
    ctrlKey: Platform.OS === 'web' && navigator.platform.indexOf('Mac') === -1,
    onTrigger,
    enabled
  });
}