import { create } from 'zustand';

/** Space (px) that docked panels take from each edge; the 3D canvas fits the rest. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Where the HUD title card should sit, in one compact row, when a docked panel sits right under it. */
export interface TitleSlot {
  top: number;
  left: number;
  /** Omitted: the card keeps its natural width. */
  width?: number;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

interface ViewportInsetsState {
  insets: Insets;
  titleSlot: TitleSlot | null;
  setInsets: (insets: Insets) => void;
  setTitleSlot: (slot: TitleSlot | null) => void;
}

export const useViewportInsets = create<ViewportInsetsState>()((set, get) => ({
  insets: NO_INSETS,
  titleSlot: null,
  setInsets: (insets) => {
    const c = get().insets;
    if (c.top !== insets.top || c.right !== insets.right || c.bottom !== insets.bottom || c.left !== insets.left) set({ insets });
  },
  setTitleSlot: (slot) => {
    const c = get().titleSlot;
    if (c === slot || (c && slot && c.top === slot.top && c.left === slot.left && c.width === slot.width)) return;
    set({ titleSlot: slot });
  },
}));
