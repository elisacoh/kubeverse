/**
 * What the terminal and the lessons need from a cluster. The Playground uses
 * the in-browser simulation; a real, isolated Kubernetes cluster behind an
 * API could implement the same contract (methods may return promises) and
 * replace it without touching the terminal, the lessons or the UI.
 */
import { applyObject, deleteObject, initialState, tick, type ApplyResult, type DeleteResult } from './cluster';
import type { DesiredObject, Kind, SimState } from './types';

type MaybePromise<T> = T | Promise<T>;
type WithoutState<T> = T extends unknown ? Omit<T, 'state'> : never;

export interface ClusterApi {
  readonly kind: 'simulated' | 'remote';
  /** The latest known state of every object. */
  snapshot(): SimState;
  apply(desired: DesiredObject): MaybePromise<WithoutState<ApplyResult>>;
  delete(kind: Kind, name: string, namespace?: string): MaybePromise<WithoutState<DeleteResult>>;
}

/** The simulation behind the `ClusterApi` contract, holding its own state. */
export class SimulatedCluster implements ClusterApi {
  readonly kind = 'simulated' as const;
  private state: SimState;
  private listeners = new Set<(s: SimState) => void>();

  constructor(state: SimState = initialState()) {
    this.state = state;
  }

  snapshot() {
    return this.state;
  }

  apply(desired: DesiredObject): WithoutState<ApplyResult> {
    const { state, ...result } = applyObject(this.state, desired);
    this.set(state);
    return result as WithoutState<ApplyResult>;
  }

  delete(kind: Kind, name: string, namespace = 'default'): WithoutState<DeleteResult> {
    const { state, ...result } = deleteObject(this.state, kind, name, namespace);
    this.set(state);
    return result as WithoutState<DeleteResult>;
  }

  /** One simulated second of control loops. */
  tick() {
    this.set(tick(this.state));
  }

  reset() {
    this.set(initialState());
  }

  /** Replaces the whole state (session restore, tests). */
  load(state: SimState) {
    this.set(state);
  }

  subscribe(listener: (s: SimState) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private set(state: SimState) {
    if (state === this.state) return;
    this.state = state;
    this.listeners.forEach((l) => l(state));
  }
}
