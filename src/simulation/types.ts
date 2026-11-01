/**
 * Contracts for the future deterministic, event-driven simulation engine.
 *
 * Nothing here is implemented in Sprint 0. The UI and scene already consume a
 * `Cluster` snapshot from the store; once an engine exists, it will publish new
 * snapshots by applying events, and the store will subscribe via `ClusterSource`.
 */
import type { Cluster, Container, Pod, PodPhase, Uid } from '../domain/types';

/** Simulated time in milliseconds since the start of the simulation. */
export type SimTime = number;

interface EventBase<K extends string> {
  type: K;
  /** Monotonic sequence number — ordering is total and deterministic. */
  seq: number;
  at: SimTime;
  /** What caused this event (another event's seq, or a user action). */
  cause?: number | 'user';
}

export type SimulationEvent =
  | (EventBase<'PodCreated'> & { pod: Pod })
  | (EventBase<'PodScheduled'> & { podUid: Uid; nodeName: string; reason: string })
  | (EventBase<'PodPhaseChanged'> & { podUid: Uid; from: PodPhase; to: PodPhase })
  | (EventBase<'ContainerStateChanged'> & {
      podUid: Uid;
      containerName: string;
      state: Container['status'];
    })
  | (EventBase<'PodDeleted'> & { podUid: Uid; reason: string })
  | (EventBase<'NodeConditionChanged'> & { nodeName: string; ready: boolean })
  | (EventBase<'WorkloadScaled'> & { workloadUid: Uid; replicas: number });

export type SimulationEventType = SimulationEvent['type'];

/** User or lesson-driven intents. The engine translates commands into events. */
export type SimulationCommand =
  | { type: 'ScaleWorkload'; workloadUid: Uid; replicas: number }
  | { type: 'DeletePod'; podUid: Uid }
  | { type: 'CordonNode'; nodeName: string }
  | { type: 'FailNode'; nodeName: string };

/** Seeded clock so runs are reproducible. */
export interface SimulationClock {
  now(): SimTime;
  advance(ms: number): void;
}

/**
 * A controller reconciliation loop (ReplicaSet controller, scheduler, kubelet…).
 * Pure function of state → events, which keeps the engine deterministic and testable.
 */
export interface Reconciler {
  readonly name: string;
  reconcile(state: Cluster, now: SimTime): Omit<SimulationEvent, 'seq'>[];
}

export interface SimulationEngine {
  readonly seed: number;
  getState(): Cluster;
  dispatch(command: SimulationCommand): void;
  /** Advance simulated time, running reconcilers and applying the resulting events. */
  step(ms: number): SimulationEvent[];
  subscribe(listener: (state: Cluster, events: readonly SimulationEvent[]) => void): () => void;
}

/** What the app store depends on: either static demo data or an engine. */
export interface ClusterSource {
  readonly kind: 'static-demo' | 'simulation';
  snapshot(): Cluster;
  subscribe?(listener: (state: Cluster) => void): () => void;
}
