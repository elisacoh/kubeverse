import type { Object3D } from 'three';

/**
 * A scripted performance for one Pod creature, written each frame by a
 * director (the cinematic) and read by the creature. Creatures without an
 * entry animate on their own, as usual.
 */
export interface CreaturePose {
  /** 0 eyes shut … 1 wide open. */
  eyes: number;
  /** 0 upright … 1 head nodded forward, asleep. */
  droop: number;
  /** 0 drooping antenna … 1 perked up. */
  antenna: number;
  /** Extra slow pulse of the belly lights, 0 … 1. */
  glow: number;
  /** Body yaw relative to the creature's facing; null keeps its idle sway. */
  gaze: number | null;
  /** Set by the creature: its placement group, for cameras that follow it. */
  anchor: Object3D | null;
}

export const creaturePoses = new Map<string, CreaturePose>();

export const restingPose = (): CreaturePose => ({ eyes: 1, droop: 0, antenna: 1, glow: 0, gaze: null, anchor: null });
