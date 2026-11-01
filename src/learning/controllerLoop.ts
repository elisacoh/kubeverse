import { create } from 'zustand';

/** Time between two passes of the control loops while they run on their own. */
export const LOOP_INTERVAL_MS = 1300;

/**
 * Whether Lesson 4's control loops run on their own. Pausing freezes the
 * simulation (not the scene) so the learner can inspect a transition; each
 * pass is still an ordinary, deterministic engine action.
 */
interface ControllerLoopState {
  paused: boolean;
  setPaused: (paused: boolean) => void;
}

export const useControllerLoop = create<ControllerLoopState>()((set) => ({
  paused: false,
  setPaused: (paused) => set({ paused }),
}));
