import { create } from 'zustand';
import type { FlowHop } from '../learning/creationFlow';

/**
 * Short, purely visual animations of messages between components (Lesson 3).
 * Never changes lesson state: what happened is decided by the engine.
 */
interface FlowState {
  /** Hops to animate, in order; `seq` restarts the animation even for the same hops. */
  cue: { hops: readonly FlowHop[]; seq: number } | null;
  play: (hops: readonly FlowHop[]) => void;
  clear: () => void;
}

let seq = 0;

export const useFlowStore = create<FlowState>()((set) => ({
  cue: null,
  play: (hops) => set({ cue: hops.length ? { hops, seq: ++seq } : null }),
  clear: () => set({ cue: null }),
}));
