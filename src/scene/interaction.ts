import type { ThreeEvent } from '@react-three/fiber';
import { useAppStore } from '../state/useAppStore';

/** Pointer handlers that track hover in the store and show a pointer cursor. */
export function useHoverHandlers(id: string) {
  const setHovered = useAppStore((s) => s.setHovered);
  return {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      setHovered(id);
      document.body.style.cursor = 'pointer';
    },
    onPointerOut: () => {
      if (useAppStore.getState().hoveredId === id) setHovered(null);
      document.body.style.cursor = '';
    },
  };
}

export const useIsHovered = (id: string) => useAppStore((s) => s.hoveredId === id);
