import { describe, expect, it } from 'vitest';
import {
  createDeployment,
  currentReplicaSet,
  deleteManagedPod,
  deleteStandalone,
  deploymentCounts,
  initialControllers,
  isSettled,
  rollingLimits,
  rolloutComplete,
  scaleDeployment,
  syncControllers,
  updateImage,
  type ControllersState,
  type NodeRoom,
} from './controllers';

/** Lesson 4's rooms once my-pod is gone: worker-1 fits three 1-CPU Pods, worker-2 none. */
const ROOMS: NodeRoom[] = [
  { name: 'worker-1', freeCpuMillis: 3800 },
  { name: 'worker-2', freeCpuMillis: 800 },
];

const settle = (s: ControllersState, rooms = ROOMS, max = 60, onPass?: (s: ControllersState) => void) => {
  for (let i = 0; i < max; i++) {
    const next = syncControllers(s, rooms);
    if (next === s) return s;
    s = next;
    onPass?.(s);
  }
  throw new Error('did not settle');
};

const start = () => initialControllers({ name: 'my-pod', nodeName: 'worker-1' });
const withDeployment = () => settle(createDeployment(deleteStandalone(start()), 'web', 'kubeverse/web:1.0', 3));
const running = (s: ControllersState) => s.pods.filter((p) => p.stage === 'running');

describe('standalone Pod', () => {
  it('is deleted for good: no controller recreates it', () => {
    const s = settle(deleteStandalone(start()));
    expect(s.standalone.stage).toBe('gone');
    expect(s.pods).toEqual([]);
    expect(isSettled(s, ROOMS)).toBe(true);
  });
});

describe('Deployment creation', () => {
  it('creates one ReplicaSet, which creates the Pods, which the scheduler and kubelets bring to Running', () => {
    let s = createDeployment(deleteStandalone(start()), 'web', 'kubeverse/web:1.0', 3);
    s = syncControllers(s, ROOMS);
    // First pass: the Deployment controller creates the ReplicaSet; no Pod yet.
    expect(s.replicaSets).toHaveLength(1);
    expect(s.pods).toHaveLength(0);
    s = syncControllers(s, ROOMS);
    expect(s.pods.map((p) => p.stage)).toEqual(['pending', 'pending', 'pending']);
    s = settle(s);
    expect(running(s)).toHaveLength(3);
    expect(s.replicaSets).toHaveLength(1);
    expect(currentReplicaSet(s)?.revision).toBe(1);
    expect(s.pods.every((p) => p.replicaSet === s.replicaSets[0]!.name)).toBe(true);
  });

  it('takes several passes per Pod: pending → bound → creating → running', () => {
    let s = createDeployment(deleteStandalone(start()), 'web', 'kubeverse/web:1.0', 1);
    const seen: string[] = [];
    s = settle(s, ROOMS, 60, (x) => x.pods[0] && seen.push(x.pods[0].stage));
    expect([...new Set(seen)]).toEqual(['pending', 'bound', 'creating', 'running']);
  });

  it('is deterministic', () => {
    expect(withDeployment()).toEqual(withDeployment());
  });
});

describe('reconciliation', () => {
  it('replaces a deleted Pod with a new identity and never revives it', () => {
    const before = withDeployment();
    const victim = running(before)[0]!;
    let s = deleteManagedPod(before, victim.name);
    expect(deploymentCounts(s)).toMatchObject({ desired: 3, current: 2, terminating: 1 });
    s = syncControllers(s, ROOMS);
    const replacement = s.pods.find((p) => p.replaces === victim.name);
    expect(replacement).toBeDefined();
    expect(replacement!.name).not.toBe(victim.name);
    expect(replacement!.stage).toBe('pending');
    s = settle(s);
    expect(s.pods.some((p) => p.name === victim.name)).toBe(false);
    expect(running(s)).toHaveLength(3);
    expect(s.replicaSets).toHaveLength(1);
    expect(s.events.some((e) => e.reason === 'Scheduled' && e.object.name === replacement!.name)).toBe(true);
    expect(s.events.some((e) => e.reason === 'Started' && e.object.name === replacement!.name)).toBe(true);
  });

  it('counts Pods that exist separately from Pods that are Ready', () => {
    const s = syncControllers(deleteManagedPod(withDeployment(), running(withDeployment())[0]!.name), ROOMS);
    const counts = deploymentCounts(s)!;
    expect(counts.current).toBe(3);
    expect(counts.ready).toBe(2);
  });
});

describe('scaling', () => {
  it('changes the desired count on the same ReplicaSet, with no new revision', () => {
    const s = settle(scaleDeployment(withDeployment(), 5));
    expect(s.replicaSets).toHaveLength(1);
    expect(currentReplicaSet(s)?.revision).toBe(1);
    expect(currentReplicaSet(s)?.replicas).toBe(5);
  });

  it('leaves Pods Pending when no Node has room, and settles', () => {
    const s = settle(scaleDeployment(withDeployment(), 5));
    expect(deploymentCounts(s)).toMatchObject({ desired: 5, current: 5, ready: 3, unschedulable: 2 });
    expect(s.events.filter((e) => e.reason === 'FailedScheduling')).toHaveLength(2);
    expect(isSettled(s, ROOMS)).toBe(true);
  });

  it('removes unscheduled Pods first when scaling down', () => {
    const up = settle(scaleDeployment(withDeployment(), 5));
    const pending = up.pods.filter((p) => p.stage === 'pending').map((p) => p.name);
    const s = syncControllers(syncControllers(scaleDeployment(up, 2), ROOMS), ROOMS);
    const deleted = s.events.filter((e) => e.reason === 'SuccessfulDelete').map((e) => e.message);
    expect(deleted.slice(0, 2).every((m) => pending.some((n) => m.includes(n)))).toBe(true);
    const down = settle(s);
    expect(deploymentCounts(down)).toMatchObject({ desired: 2, current: 2, ready: 2, unschedulable: 0 });
  });
});

describe('rolling update', () => {
  const atTwo = () => settle(scaleDeployment(withDeployment(), 2));

  it('derives maxSurge and maxUnavailable from the 25% defaults', () => {
    expect(rollingLimits(2)).toEqual({ maxSurge: 1, maxUnavailable: 0 });
    expect(rollingLimits(4)).toEqual({ maxSurge: 1, maxUnavailable: 1 });
    expect(rollingLimits(5)).toEqual({ maxSurge: 2, maxUnavailable: 1 });
  });

  it('creates exactly one new ReplicaSet with the next revision', () => {
    const s = syncControllers(updateImage(atTwo(), 'kubeverse/web:2.0'), ROOMS);
    expect(s.replicaSets).toHaveLength(2);
    expect(s.replicaSets[1]!.revision).toBe(2);
    expect(s.replicaSets[1]!.name).not.toBe(s.replicaSets[0]!.name);
  });

  it('stays within maxSurge and maxUnavailable at every pass, and finishes on the new template', () => {
    const { maxSurge, maxUnavailable } = rollingLimits(2);
    let maxActive = 0;
    let minAvailable = Infinity;
    const s = settle(updateImage(atTwo(), 'kubeverse/web:2.0'), ROOMS, 80, (x) => {
      const c = deploymentCounts(x)!;
      maxActive = Math.max(maxActive, c.current);
      minAvailable = Math.min(minAvailable, c.available);
      expect(x.replicaSets.reduce((n, rs) => n + rs.replicas, 0)).toBeLessThanOrEqual(2 + maxSurge);
    });
    expect(maxActive).toBeLessThanOrEqual(2 + maxSurge);
    expect(minAvailable).toBeGreaterThanOrEqual(2 - maxUnavailable);
    expect(rolloutComplete(s)).toBe(true);
    expect(s.replicaSets[0]!.replicas).toBe(0);
    expect(s.pods.every((p) => p.replicaSet === s.replicaSets[1]!.name)).toBe(true);
  });

  it('is gradual: old and new Pods coexist during the rollout', () => {
    let coexisted = false;
    settle(updateImage(atTwo(), 'kubeverse/web:2.0'), ROOMS, 80, (x) => {
      const c = deploymentCounts(x)!;
      if (c.old > 0 && c.updated > 0) coexisted = true;
    });
    expect(coexisted).toBe(true);
  });

  it('waits for room: without capacity for the extra Pod, the rollout does not progress', () => {
    const tight: NodeRoom[] = [
      { name: 'worker-1', freeCpuMillis: 2000 },
      { name: 'worker-2', freeCpuMillis: 0 },
    ];
    const base = settle(scaleDeployment(settle(createDeployment(deleteStandalone(start()), 'web', 'kubeverse/web:1.0', 3), tight), 2), tight);
    const s = settle(updateImage(base, 'kubeverse/web:2.0'), tight);
    expect(rolloutComplete(s)).toBe(false);
    expect(deploymentCounts(s)).toMatchObject({ old: 2, available: 2, unschedulable: 1 });
  });

  it('rolls back by reusing the old ReplicaSet as a new revision', () => {
    const v2 = settle(updateImage(atTwo(), 'kubeverse/web:2.0'));
    const back = settle(updateImage(v2, 'kubeverse/web:1.0'));
    expect(back.replicaSets).toHaveLength(2);
    expect(currentReplicaSet(back)?.name).toBe(v2.replicaSets[0]!.name);
    expect(currentReplicaSet(back)?.revision).toBe(3);
    expect(rolloutComplete(back)).toBe(true);
  });
});
