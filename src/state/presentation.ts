/**
 * How much of the cluster the scene and inspectors reveal. Explore shows
 * everything; a lesson can hold back details it has not taught yet.
 */
import type { ControlPlaneComponentType } from '../domain/types';

/** Node-level agents that are not API objects. */
export type NodeAgent = 'kubelet' | 'container-runtime';

export interface ScenePresentation {
  /** 'components': named, inspectable structures. 'area': one coordination area, details held back. */
  controlPlane: 'components' | 'area';
  /** 'essentials': role and capacity only. */
  inspector: 'full' | 'essentials';
  /** 'essentials': inside a Pod, show the Pod, its network and its containers; hold back kernel internals. */
  anatomy: 'full' | 'essentials';
  /** Moving pulses on kubelet ⇄ API server links. */
  linkPulses: boolean;
  /** Nodes rise into the world and Pods beam in when they appear. */
  animateEntries: boolean;
  /**
   * Introduced so far: control-plane components named and inspectable even in
   * 'area' mode, and Node agents that can be selected (hidden otherwise).
   */
  revealed: readonly (ControlPlaneComponentType | NodeAgent)[];
}

export const FULL_PRESENTATION: ScenePresentation = {
  controlPlane: 'components',
  inspector: 'full',
  anatomy: 'full',
  linkPulses: true,
  animateEntries: false,
  revealed: [],
};

export const isRevealed = (p: ScenePresentation, id: ControlPlaneComponentType | NodeAgent) => p.revealed.includes(id);
