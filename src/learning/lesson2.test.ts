import { describe, expect, it } from 'vitest';
import { buildAction, canPerform, createSession, currentObjective, isLessonComplete, step, validateLesson } from './engine';
import { conceptIds } from './concepts';
import { meetYourFirstPod as lesson } from './lessons/meetYourFirstPod';
import { FIRST_CLUSTER_WORLD, buildSandboxCluster, sandboxPodUid } from './sandbox';
import type { BuildActionKind, LearnerAction, LessonSession } from './types';

const HELLO = sandboxPodUid('hello-web');
const MULTI = sandboxPodUid('web-and-logger');
const REPORT = sandboxPodUid('report-once');
const BROKEN = sandboxPodUid('broken-once');

const select = (podId: string): LearnerAction => ({ type: 'ENTITY_SELECTED', entityId: podId, entityKind: 'pod' });
const enter = (podId: string): LearnerAction => ({ type: 'POD_ANATOMY_ENTERED', podId });
const inspect = (
  podId: string,
  containerName: string,
  containerRole: 'app' | 'sidecar' = 'app',
  containerState: 'running' | 'terminated' = 'running',
): LearnerAction => ({ type: 'CONTAINER_INSPECTED', podId, containerName, containerRole, containerState });

/** Performs a build intent through the engine, as the UI does. */
const perform = (s: LessonSession, kind: BuildActionKind) => {
  const action = buildAction(lesson, s, kind);
  if (!action) throw new Error(`${kind} is not offered`);
  return step(lesson, s, action).session;
};

const run = (s: LessonSession, ...steps: (LearnerAction | BuildActionKind)[]) =>
  steps.reduce((acc, x) => (typeof x === 'string' ? perform(acc, x) : step(lesson, acc, x).session), s);

const UP_TO_INSIDE: (LearnerAction | BuildActionKind)[] = ['open-container', 'create-pod', select(HELLO), enter(HELLO)];
const UP_TO_LAB: (LearnerAction | BuildActionKind)[] = [
  ...UP_TO_INSIDE,
  inspect(HELLO, 'hello-web'),
  'open-multi-container-example',
  enter(MULTI),
  inspect(MULTI, 'web'),
  inspect(MULTI, 'log-shipper', 'sidecar'),
];

describe('Lesson 2 state machine', () => {
  it('is well-formed', () => {
    expect(validateLesson(lesson, conceptIds)).toEqual([]);
  });

  it('starts from the cluster Lesson 1 builds, with no Pods', () => {
    const s = createSession(lesson);
    expect(s.world).toEqual(FIRST_CLUSTER_WORLD);
    const cluster = buildSandboxCluster(s.world);
    expect(cluster.nodes.map((n) => n.metadata.name)).toEqual(['control-plane-1', 'worker-1', 'worker-2']);
    expect(cluster.pods).toEqual([]);
    expect(canPerform(lesson, s, 'open-container')).toBe(true);
    expect(canPerform(lesson, s, 'create-pod')).toBe(false);
    expect(canPerform(lesson, s, 'add-worker-node')).toBe(false);
  });

  it('creates the first Pod only after the container is opened, on a worker Node', () => {
    const s = createSession(lesson);
    const forged: LearnerAction = { type: 'POD_CREATED', podId: HELLO, nodeId: 'worker-2' };
    expect(step(lesson, s, forged).session).toBe(s);

    const opened = perform(s, 'open-container');
    expect(buildAction(lesson, opened, 'create-pod')).toEqual(forged);
    // A Pod placed on the control plane is not what the lesson offers.
    expect(step(lesson, opened, { ...forged, nodeId: 'control-plane-1' }).session).toBe(opened);

    const created = perform(opened, 'create-pod');
    const pod = buildSandboxCluster(created.world).pods[0]!;
    expect(pod).toMatchObject({ metadata: { uid: HELLO, name: 'hello-web', namespace: 'default' }, nodeName: 'worker-2' });
    expect(pod.phase).toBe('Running');
    expect(pod.containers.map((c) => c.name)).toEqual(['hello-web']);
    expect(created.progress.completed).toEqual(['open-container', 'create-pod']);
  });

  it('requires the learner’s own Pod for selection and anatomy, and corrects a Node pick', () => {
    const s = run(createSession(lesson), 'open-container', 'create-pod');
    const node = step(lesson, s, { type: 'ENTITY_SELECTED', entityId: 'worker-2', entityKind: 'worker-node' });
    expect(node.feedback).toMatch(/Click the Pod itself/);
    expect(step(lesson, s, enter(HELLO)).completed).toEqual([]);
    const after = run(s, select(HELLO), enter(HELLO));
    expect(currentObjective(lesson, after.progress)?.id).toBe('inspect-app-container');
  });

  it('offers the two-container example only after the application container was inspected', () => {
    const inside = run(createSession(lesson), ...UP_TO_INSIDE);
    expect(canPerform(lesson, inside, 'open-multi-container-example')).toBe(false);
    const s = run(inside, inspect(HELLO, 'hello-web'), 'open-multi-container-example');
    const multi = buildSandboxCluster(s.world).pods.find((p) => p.metadata.uid === MULTI)!;
    expect(multi.containers.map((c) => [c.name, c.role])).toEqual([
      ['web', 'app'],
      ['log-shipper', 'sidecar'],
    ]);
    expect(multi.volumes).toEqual([{ name: 'logs', source: 'emptyDir' }]);
    expect(multi.containers.every((c) => c.volumeMounts?.some((m) => m.name === 'logs'))).toBe(true);
  });

  it('needs both containers of the example, counted once each', () => {
    const s = run(createSession(lesson), ...UP_TO_LAB.slice(0, -1));
    const again = run(s, inspect(MULTI, 'web'));
    expect(again.progress.completed).not.toContain('inspect-both-containers');
    expect(run(again, inspect(MULTI, 'log-shipper', 'sidecar')).progress.completed).toContain('inspect-both-containers');
  });

  it('steps a lab Pod through its phases in order, never skipping one', () => {
    const s = run(createSession(lesson), ...UP_TO_LAB);
    const skip: LearnerAction = { type: 'POD_LIFECYCLE_OBSERVED', podId: REPORT, phase: 'Succeeded' };
    expect(step(lesson, s, skip).session).toBe(s);

    const pending = perform(s, 'advance-lab-success');
    let pod = buildSandboxCluster(pending.world).pods.find((p) => p.metadata.uid === REPORT)!;
    expect(pod.phase).toBe('Pending');
    expect(pod.containers[0]!.status).toEqual({ state: 'waiting', reason: 'ContainerCreating' });
    expect(pod.restartPolicy).toBe('Never');

    const running = perform(pending, 'advance-lab-success');
    expect(running.progress.completed).toContain('lab-running');
    const done = perform(running, 'advance-lab-success');
    pod = buildSandboxCluster(done.world).pods.find((p) => p.metadata.uid === REPORT)!;
    expect(pod.phase).toBe('Succeeded');
    expect(pod.containers[0]!.status).toMatchObject({ state: 'terminated', exitCode: 0 });
    expect(canPerform(lesson, done, 'advance-lab-success')).toBe(false);
  });

  it('shows Failed with a separate prepared Pod, then compares phase and container state', () => {
    const lab = run(createSession(lesson), ...UP_TO_LAB, 'advance-lab-success', 'advance-lab-success');
    expect(canPerform(lesson, lab, 'advance-lab-failure')).toBe(false);
    const succeeded = perform(lab, 'advance-lab-success');
    const failed = run(succeeded, 'advance-lab-failure', 'advance-lab-failure', 'advance-lab-failure');
    const broken = buildSandboxCluster(failed.world).pods.find((p) => p.metadata.uid === BROKEN)!;
    expect(broken.phase).toBe('Failed');
    expect(broken.containers[0]!.status).toMatchObject({ state: 'terminated', reason: 'Error', exitCode: 1 });
    expect(isLessonComplete(lesson, failed.progress)).toBe(false);

    const end = run(failed, enter(BROKEN), inspect(BROKEN, 'task', 'app', 'terminated'));
    expect(isLessonComplete(lesson, end.progress)).toBe(true);
  });

  it('LESSON_RESET restores the starting cluster', () => {
    const s = run(createSession(lesson), ...UP_TO_LAB);
    expect(step(lesson, s, { type: 'LESSON_RESET' }).session).toEqual(createSession(lesson));
  });
});
