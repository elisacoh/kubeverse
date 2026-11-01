import { describe, expect, it } from 'vitest';
import { buildAction, canPerform, createSession, currentObjective, isLessonComplete, step, validateLesson } from './engine';
import { conceptIds } from './concepts';
import { desiredState as lesson } from './lessons/desiredState';
import { deriveActions } from './observe';
import { replacementPodUids } from './controllerObjects';
import {
  BUSY_CLUSTER_WORLD,
  MAINTAINED_CLUSTER_WORLD,
  REQUEST_POD_UID,
  buildSandboxCluster,
  deploymentNameError,
} from './sandbox';
import { buildManifest } from '../domain/manifest';
import { controllerRef, findPod, ownerChain, podsControlledBy, workloadsControlledBy } from '../domain/selectors';
import type { Cluster, Deployment, Pod, ReplicaSet } from '../domain/types';
import type { EntityPick } from '../state/useAppStore';
import type { BuildActionKind, LearnerAction, LessonSession } from './types';

const perform = (s: LessonSession, kind: BuildActionKind) => {
  const action = buildAction(lesson, s, kind);
  if (!action) throw new Error(`${kind} is not offered`);
  return step(lesson, s, action).session;
};
const act = (s: LessonSession, action: LearnerAction) => step(lesson, s, action).session;
/** Lets the control loops run until every one of them is satisfied. */
const settle = (s: LessonSession) => {
  for (let i = 0; i < 100 && canPerform(lesson, s, 'run-controllers'); i++) s = perform(s, 'run-controllers');
  expect(canPerform(lesson, s, 'run-controllers')).toBe(false);
  return s;
};
const cluster = (s: LessonSession) => buildSandboxCluster(s.world);
let seq = 0;
/** What clicking an entity produces, as the connector would derive it. */
const pick = (s: LessonSession, kind: EntityPick['kind'], id: string) => {
  const p = { kind, id, seq: ++seq } as EntityPick;
  return deriveActions(cluster(s), null, p, { replacements: replacementPodUids(s.world.controllers) }).reduce(act, s);
};

const deployment = (c: Cluster) => c.workloads.find((w): w is Deployment => w.kind === 'Deployment');
const replicaSets = (c: Cluster) => c.workloads.filter((w): w is ReplicaSet => w.kind === 'ReplicaSet');
const webPods = (c: Cluster) => c.pods.filter((p) => p.origin === 'replicaset');
const runningWeb = (c: Cluster) => webPods(c).filter((p) => p.phase === 'Running' && !p.terminating);
const CREATE: LearnerAction = { type: 'DEPLOYMENT_CREATED', name: 'web', replicas: 3, image: 'kubeverse/web:1.0' };

const toDeployment = () => {
  let s = createSession(lesson);
  s = settle(perform(s, 'delete-standalone-pod'));
  s = pick(s, 'component', 'sandbox-cpc-kube-controller-manager');
  return settle(act(s, CREATE));
};

describe('Lesson 4 — authoring', () => {
  it('is valid', () => {
    expect(validateLesson(lesson, conceptIds)).toEqual([]);
  });

  it('starts from Lesson 3’s cluster with the standalone Pod running', () => {
    const c = buildSandboxCluster(MAINTAINED_CLUSTER_WORLD);
    const pod = findPod(c, REQUEST_POD_UID)!;
    expect(pod.metadata.name).toBe('my-pod');
    expect(pod.phase).toBe('Running');
    expect(pod.nodeName).toBe('worker-1');
    expect(pod.metadata.ownerReferences).toEqual([]);
    expect(c.workloads).toEqual([]);
  });

  it('leaves earlier lessons’ worlds without controllers', () => {
    expect(BUSY_CLUSTER_WORLD.controllers).toBeNull();
    expect(buildSandboxCluster(BUSY_CLUSTER_WORLD).workloads).toEqual([]);
  });
});

describe('Lesson 4 — the standalone Pod', () => {
  it('is deleted for good', () => {
    let s = perform(createSession(lesson), 'delete-standalone-pod');
    expect(findPod(cluster(s), REQUEST_POD_UID)?.terminating).toBe(true);
    s = settle(s);
    expect(findPod(cluster(s), REQUEST_POD_UID)).toBeUndefined();
    expect(cluster(s).pods.some((p) => p.metadata.name === 'my-pod')).toBe(false);
    expect(s.progress.completed).toEqual(['delete-standalone']);
  });

  it('offers the Deployment only once the learner has looked for a controller', () => {
    let s = settle(perform(createSession(lesson), 'delete-standalone-pod'));
    expect(canPerform(lesson, s, 'create-deployment')).toBe(false);
    s = pick(s, 'component', 'sandbox-cpc-kube-controller-manager');
    expect(s.progress.completed).toContain('inspect-controller-manager');
    expect(canPerform(lesson, s, 'create-deployment')).toBe(true);
  });
});

describe('Lesson 4 — Deployment → ReplicaSet → Pods', () => {
  it('builds distinct objects linked by ownerReferences', () => {
    const c = cluster(toDeployment());
    const dep = deployment(c)!;
    const [rs] = replicaSets(c);
    expect(dep.replicas).toBe(3);
    expect(controllerRef(rs!)).toMatchObject({ kind: 'Deployment', uid: dep.metadata.uid, controller: true });
    expect(workloadsControlledBy(c, dep.metadata.uid)).toEqual([rs]);
    const pods = podsControlledBy(c, rs!.metadata.uid);
    expect(pods).toHaveLength(3);
    for (const p of pods) {
      expect(p.origin).toBe('replicaset');
      expect(ownerChain(c, p).map((r) => r.kind)).toEqual(['ReplicaSet', 'Deployment']);
      expect(p.metadata.labels).toMatchObject({ app: 'web', 'pod-template-hash': rs!.podTemplateHash });
    }
    expect(runningWeb(c)).toHaveLength(3);
  });

  it('rejects an invalid Deployment', () => {
    let s = settle(perform(createSession(lesson), 'delete-standalone-pod'));
    s = pick(s, 'component', 'sandbox-cpc-kube-controller-manager');
    expect(deploymentNameError('Web_App')).not.toBeNull();
    const rejected = step(lesson, s, { ...CREATE, name: 'Web_App' });
    expect(rejected.session).toBe(s);
    expect(step(lesson, s, { ...CREATE, replicas: 0 }).session).toBe(s);
  });

  it('serializes the Deployment and ReplicaSet as apps/v1 objects', () => {
    const c = cluster(toDeployment());
    const dep = buildManifest(c, { kind: 'workload', uid: deployment(c)!.metadata.uid })!;
    expect(dep.yaml).toContain('apiVersion: apps/v1');
    expect(dep.yaml).toContain('kind: Deployment');
    expect(dep.yaml).toContain('replicas: 3');
    expect(dep.yaml).toContain('matchLabels:');
    const rs = buildManifest(c, { kind: 'workload', uid: replicaSets(c)[0]!.metadata.uid })!;
    expect(rs.yaml).toContain('kind: ReplicaSet');
    expect(rs.yaml).toContain('ownerReferences:');
  });
});

describe('Lesson 4 — full journey', () => {
  it('completes through meaningful actions only', () => {
    let s = toDeployment();
    expect(s.progress.completed).toEqual(['delete-standalone', 'inspect-controller-manager', 'create-deployment']);

    s = pick(s, 'workload', replicaSets(cluster(s))[0]!.metadata.uid);
    const [first] = runningWeb(cluster(s));
    s = act(s, { type: 'POD_OWNER_CHAIN_EXPLORED', podId: first!.metadata.uid, replicaSetId: controllerRef(first!)!.uid });
    expect(currentObjective(lesson, s.progress)?.id).toBe('delete-managed-pod');

    // Deleting a Pod: desired stays 3, the replacement is a new Pod.
    const victim = first!;
    s = act(s, { type: 'REPLICASET_POD_DELETED', podId: victim.metadata.uid, replicaSetId: controllerRef(victim)!.uid });
    expect(deployment(cluster(s))!.replicas).toBe(3);
    expect(deployment(cluster(s))!.status!.replicas).toBe(2);
    // An existing Pod is not the replacement.
    const other = runningWeb(cluster(s))[0]!;
    const fb = step(lesson, s, { type: 'POD_RUNNING_OBSERVED', podId: other.metadata.uid });
    expect(fb.feedback).toMatch(/already there/);
    s = settle(s);
    const replacement = webPods(cluster(s)).find((p) => replacementPodUids(s.world.controllers).has(p.metadata.uid))!;
    expect(replacement.metadata.uid).not.toBe(victim.metadata.uid);
    expect(replacement.metadata.name).not.toBe(victim.metadata.name);
    expect(findPod(cluster(s), victim.metadata.uid)).toBeUndefined();
    s = pick(s, 'pod', replacement.metadata.uid);
    expect(s.progress.completed).toContain('observe-reconciliation');

    // Scaling: same ReplicaSet; capacity limits what runs.
    s = settle(act(s, { type: 'DEPLOYMENT_SCALED', name: 'web', replicas: 5 }));
    expect(replicaSets(cluster(s))).toHaveLength(1);
    expect(deployment(cluster(s))!.status).toMatchObject({ replicas: 5, readyReplicas: 3 });
    const pending = webPods(cluster(s)).find((p) => !p.nodeName)!;
    s = pick(s, 'pod', pending.metadata.uid);
    expect(s.progress.completed).toContain('inspect-pending');
    s = settle(act(s, { type: 'DEPLOYMENT_SCALED', name: 'web', replicas: 2 }));
    expect(runningWeb(cluster(s))).toHaveLength(2);
    expect(webPods(cluster(s)).every((p) => p.nodeName)).toBe(true);

    // Template change: a second ReplicaSet, a gradual rollout.
    s = perform(s, 'update-pod-template');
    s = perform(s, 'run-controllers');
    expect(replicaSets(cluster(s))).toHaveLength(2);
    // Too early: the old ReplicaSet still has Pods.
    const oldUid = replicaSets(cluster(s))[0]!.metadata.uid;
    expect(step(lesson, s, { type: 'REPLICASET_INSPECTED', replicaSetId: oldUid, revision: 1 }).feedback).toMatch(/Wait/);
    s = settle(s);
    const [oldRs, newRs] = replicaSets(cluster(s));
    expect(oldRs!.replicas).toBe(0);
    expect(newRs!.revision).toBe(2);
    expect(runningWeb(cluster(s)).every((p: Pod) => p.containers[0]!.image === 'kubeverse/web:2.0')).toBe(true);
    s = pick(s, 'workload', oldRs!.metadata.uid);
    expect(isLessonComplete(lesson, s.progress)).toBe(true);
  });

  it('resets to the initial world', () => {
    const s = toDeployment();
    const reset = step(lesson, s, { type: 'LESSON_RESET' }).session;
    expect(reset.world).toBe(MAINTAINED_CLUSTER_WORLD);
    expect(reset.progress.completed).toEqual([]);
  });
});
