import { useEffect } from 'react';
import { useAppStore } from '../state/useAppStore';

export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const s = useAppStore.getState();
      if (e.key === 'Escape') s.back();
      else if (e.key === 'Home') s.goToCluster();
      else if (e.key === 'Enter' && s.selection?.kind === 'pod' && s.view.kind !== 'pod') {
        s.exploreInside(s.selection.uid);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
