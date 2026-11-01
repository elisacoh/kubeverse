import { describe, expect, it } from 'vitest';
import {
  buildAction,
  canPerform,
  createSession,
  currentObjective,
  isLessonComplete,
  presentationOf,
  step,
  validateLesson,
} from './engine';
import { conceptIds } from './concepts';
import { behindTheScenes as lesson } from './lessons/behindTheScenes';
import { newEvents, timelineEvents } from './creationFlow';
import { requestManifestYaml, storedLineMark } from './podRequest';
import {
  BUSY_CLUSTER_WORLD,
  REQUEST_POD_UID,
  buildSandboxCluster,
  podNameError,
  schedulerChoice,
} from './sandbox';
import { buildManifest } from '../domain/manifest';
import { findPod, fitsOnNode, freeCapacity, unscheduledPod } from '../domain/selectors';
import type { BuildActionKind, LearnerAction, LessonSession } from './types';

const submit = (podName = 'my-pod', image = 'nginx:1.27'): LearnerAction => ({ type: 'POD_REQUEST_SUBMITTED', podName, image });
const evaluate = (nodeId: string, eligible: boolean): LearnerAction => ({
  type: 'NODE_ELIGIBILITY_EVALUATED',
  podId: REQUEST_POD_UID,
  nodeId,
  eligible,
});
const predict = (nodeId: string, correct: boolean): LearnerAction => ({
  type: 'SCHEDULING_PREDICTED',
  podId: REQUEST_POD_UID,
  nodeId,
  correct,
});
const explore = (eventId: string): LearnerAction => ({ type: 'EVENT_TIMELINE_EXPLORED', eventId });

const perform = (s: LessonSession, kind: BuildActionKind) => {
  const action = buildAction(lesson, s, kind);
  if (!action) throw new Error(`${kind} is not offered`);
  return step(lesson, s, action).session;
};
const run = (s: LessonSession, ...steps: (LearnerAction | BuildActionKind)[]) =>
  steps.reduce((acc, x) => (typeof x === 'string' ? perform(acc, x) : step(lesson, acc, x).session), s);

const cluster = (s: LessonSession) => buildSandboxCluster(s.world);
const myPod = (s: LessonSession) => findPod(cluster(s), REQUEST_POD_UID);

const TO_STORED: (LearnerAction | BuildActionKind)[] = [submit(), { type: 'API_SERVER_INSPECTED' }, 'process-request'];
const TO_BOUND: (LearnerAction | BuildActionKind)[] = [
  ...TO_STORED,
  { type: 'ETCD_STATE_INSPECTED' },
  { type: 'SCHEDULER_INSPECTED' },
  evaluate('worker-1', true),
  evaluate('worker-2', false),
  predict('worker-1', true),
  'schedule-pod',
];
const TO_RUNNING: (LearnerAction | BuildActionKind)[] = [
  ...TO_BOUND,
  { type: 'KUBELET_INSPECTED', nodeId: 'worker-1' },
  'kubelet-prepare-pod',
  { type: 'CONTAINER_RUNTIME_INSPECTED', nodeId: 'worker-1' },
  'start-container',
];

describe('Lesson 3 state machine', () => {
  it('is well-formed', () => {
    expect(validateLesson(lesson, conceptIds)).toEqual([]);
  });

  it('starts from the Lesson 1+2 cluster, with a busy worker-2 and no request', () => {
    const s = createSession(lesson);
    expect(s.world).toEqual(BUSY_CLUSTER_WORLD);
    expect(s.world.request).toBeNull();
    const c = cluster(s);
    expect(c.nodes.map((n) => n.metadata.name)).toEqual(['control-plane-1', 'worker-1', 'worker-2']);
    expect(c.pods.map((p) => [p.metadata.name, p.nodeName])).toEqual([
      ['hello-web', 'worker-2'],
      ['data-cruncher', 'worker-2'],
    ]);
    // worker-2 is the bigger machine, but has less room left.
    expect(freeCapacity(c, 'worker-2').cpuMillis).toBeLessThan(freeCapacity(c, 'worker-1').cpuMillis);
    expect(canPerform(lesson, s, 'submit-pod-request')).toBe(true);
    expect(canPerform(lesson, s, 'process-request')).toBe(false);
    expect(presentationOf(lesson, s).revealed).toEqual([]);
  });

  it('submitting stores nothing and starts nothing: the request waits at the API server', () => {
    const s = run(createSession(lesson), submit('shop', 'httpd:2.4'));
    expect(s.world.request).toEqual({ name: 'shop', image: 'httpd:2.4', stage: 'submitted' });
    expect(myPod(s)).toBeUndefined();
    expect(s.progress.completed).toEqual(['submit-request']);
    expect(presentationOf(lesson, s).revealed).toEqual(['kube-apiserver']);
    // Processing waits until the learner has looked at the API server.
    expect(canPerform(lesson, s, 'process-request')).toBe(false);
  });

  it('only accepts the offered images and a name not already used', () => {
    const s = createSession(lesson);
    expect(step(lesson, s, submit('my-pod', 'evil:latest')).session).toBe(s);
    expect(step(lesson, s, submit('hello-web')).session).toBe(s);
    expect(step(lesson, s, submit('x'.repeat(300))).session).toBe(s);
  });

  it('rejects an invalid name at processing, stores nothing, and lets the learner resubmit', () => {
    const bad = run(createSession(lesson), submit('My_Pod'), { type: 'API_SERVER_INSPECTED' });
    const result = step(lesson, bad, buildAction(lesson, bad, 'process-request')!);
    expect(result.session.world.request?.stage).toBe('rejected');
    expect(result.feedback).toMatch(/rejected/);
    expect(result.session.progress.completed).not.toContain('process-request');
    expect(myPod(result.session)).toBeUndefined();
    expect(podNameError('My_Pod')).toMatch(/RFC 1123/);
    expect(timelineEvents(result.session.world, cluster(result.session)).map((e) => e.id)).toEqual([
      'submitted',
      'rejected',
    ]);

    expect(canPerform(lesson, result.session, 'submit-pod-request')).toBe(true);
    const fixed = run(result.session, submit('my-pod'), 'process-request');
    expect(fixed.progress.completed).toContain('process-request');
    expect(myPod(fixed)).toMatchObject({ phase: 'Pending', awaitingKubelet: true });
    expect(myPod(fixed)?.nodeName).toBeUndefined();
  });

  it('persisting reveals etcd; the stored object is Pending, with no Node and no container status', () => {
    const s = run(createSession(lesson), ...TO_STORED);
    expect(presentationOf(lesson, s).revealed).toEqual(['kube-apiserver', 'etcd']);
    const c = cluster(s);
    expect(unscheduledPod(c)?.metadata.uid).toBe(REQUEST_POD_UID);
    const yaml = buildManifest(c, { kind: 'pod', uid: REQUEST_POD_UID })!.yaml;
    expect(yaml).toContain('phase: Pending');
    expect(yaml).not.toContain('nodeName');
    expect(yaml).not.toContain('containerStatuses');

    const mark = storedLineMark(requestManifestYaml('my-pod', 'nginx:1.27'));
    const marked = yaml.split('\n').map((l) => [l.trim(), mark(l)] as const);
    expect(marked).toContainEqual(['name: my-pod', null]);
    expect(marked).toContainEqual(['image: nginx:1.27', null]);
    expect(marked.some(([l, m]) => l.startsWith('uid:') && m === 'added')).toBe(true);
    expect(marked).toContainEqual(['phase: Pending', 'status']);
  });

  it('the scheduler picks the Node with room — worker-1, not the bigger worker-2', () => {
    const s = run(createSession(lesson), ...TO_STORED);
    const c = cluster(s);
    const pod = myPod(s)!;
    expect(fitsOnNode(c, pod, 'worker-2')).toBe(false);
    expect(fitsOnNode(c, pod, 'worker-1')).toBe(true);
    expect(fitsOnNode(c, pod, 'control-plane-1')).toBe(false);
    expect(schedulerChoice(c, REQUEST_POD_UID)).toBe('worker-1');
  });

  it('binding needs both candidates weighed and a correct prediction; a wrong guess gets feedback', () => {
    const s = run(createSession(lesson), ...TO_STORED, { type: 'ETCD_STATE_INSPECTED' }, { type: 'SCHEDULER_INSPECTED' });
    expect(presentationOf(lesson, s).revealed).toContain('kube-scheduler');
    expect(canPerform(lesson, s, 'schedule-pod')).toBe(false);

    const wrong = step(lesson, s, predict('worker-2', false));
    expect(wrong.feedback).toMatch(/free CPU/);
    const once = run(wrong.session, evaluate('worker-1', true), evaluate('worker-1', true), predict('worker-1', true));
    expect(once.progress.completed).not.toContain('evaluate-nodes');
    expect(canPerform(lesson, once, 'schedule-pod')).toBe(false);

    const ready = run(once, evaluate('worker-2', false));
    expect(buildAction(lesson, ready, 'schedule-pod')).toEqual({
      type: 'POD_BOUND_TO_NODE',
      podId: REQUEST_POD_UID,
      nodeId: 'worker-1',
    });
    // A forged binding to another Node is not what happens.
    expect(step(lesson, ready, { type: 'POD_BOUND_TO_NODE', podId: REQUEST_POD_UID, nodeId: 'worker-2' }).session).toBe(ready);
  });

  it('bound is not running: the Pod waits for the kubelet, which acts only on its own Node', () => {
    const s = run(createSession(lesson), ...TO_BOUND);
    const pod = myPod(s)!;
    expect(pod).toMatchObject({ nodeName: 'worker-1', phase: 'Pending', awaitingKubelet: true });
    expect(pod.conditions).toEqual([{ type: 'PodScheduled', status: 'True' }]);
    expect(presentationOf(lesson, s).revealed).toContain('kubelet');
    expect(canPerform(lesson, s, 'kubelet-prepare-pod')).toBe(false);

    const other = step(lesson, s, { type: 'KUBELET_INSPECTED', nodeId: 'worker-2' });
    expect(other.feedback).toMatch(/another Node/);
    expect(other.session.progress.completed).not.toContain('inspect-kubelet');

    const preparing = run(s, { type: 'KUBELET_INSPECTED', nodeId: 'worker-1' }, 'kubelet-prepare-pod');
    const prepared = myPod(preparing)!;
    expect(prepared.awaitingKubelet).toBe(false);
    expect(prepared.phase).toBe('Pending');
    expect(prepared.containers[0]?.status).toEqual({ state: 'waiting', reason: 'ContainerCreating' });
    expect(presentationOf(lesson, preparing).revealed).toContain('container-runtime');
    expect(canPerform(lesson, preparing, 'start-container')).toBe(false);
  });

  it('runs to completion through user actions only, then replays the journey from the timeline', () => {
    const s = run(createSession(lesson), ...TO_RUNNING);
    const pod = myPod(s)!;
    expect(pod.phase).toBe('Running');
    expect(pod.containers[0]?.status.state).toBe('running');
    expect(pod.conditions?.every((c) => c.status === 'True')).toBe(true);
    expect(currentObjective(lesson, s.progress)?.id).toBe('observe-running');

    const events = timelineEvents(s.world, cluster(s));
    expect(events.map((e) => e.title)).toEqual([
      'Request submitted',
      'API processing completed',
      'Pod object persisted',
      'Pod awaiting scheduling',
      'Node selected',
      'Pod bound',
      'Kubelet processing Pod',
      'Container started',
      'Pod Running',
    ]);

    const observed = run(s, { type: 'POD_RUNNING_OBSERVED', podId: REQUEST_POD_UID });
    const explored = run(observed, explore('bound'), explore('bound'), explore('persisted'));
    expect(isLessonComplete(lesson, explored.progress)).toBe(false);
    const done = run(explored, explore('pod-running'));
    expect(isLessonComplete(lesson, done.progress)).toBe(true);
    expect(done.progress.completed).toEqual(lesson.objectives.map((o) => o.id));
  });

  it('ignores steps out of order', () => {
    const s = createSession(lesson);
    expect(buildAction(lesson, s, 'schedule-pod')).toBeNull();
    expect(step(lesson, s, { type: 'CONTAINER_STARTED', podId: REQUEST_POD_UID, nodeId: 'worker-1' }).session).toBe(s);
    const stored = run(s, ...TO_STORED);
    expect(step(lesson, stored, { type: 'POD_SYNC_STARTED', podId: REQUEST_POD_UID, nodeId: 'worker-1' }).session).toBe(stored);
  });

  it('is deterministic, and LESSON_RESET restores the starting world', () => {
    const a = run(createSession(lesson), ...TO_RUNNING);
    const b = run(createSession(lesson), ...TO_RUNNING);
    expect(a).toEqual(b);
    expect(cluster(a)).toEqual(cluster(b));
    expect(step(lesson, a, { type: 'LESSON_RESET' }).session).toEqual(createSession(lesson));
  });
});

describe('Lesson 3 creation timeline', () => {
  it('follows the watch-based shape: nobody calls the next component directly', () => {
    const s = run(createSession(lesson), ...TO_RUNNING);
    const events = timelineEvents(s.world, cluster(s));
    const hops = events.flatMap((e) => e.hops);
    // Only the API server talks to etcd.
    for (const h of hops) {
      if (h.to.kind === 'component' && h.to.component === 'etcd') {
        expect(h.from).toEqual({ kind: 'component', component: 'kube-apiserver' });
      }
    }
    // The scheduler records its choice through the API server, and never reaches the runtime.
    const bound = events.find((e) => e.id === 'bound')!;
    expect(bound.hops[0]).toMatchObject({ to: { kind: 'component', component: 'kube-apiserver' }, label: 'POST Binding' });
    expect(hops.some((h) => h.from.kind === 'component' && h.from.component === 'kube-scheduler' && h.to.kind === 'agent')).toBe(false);
    // The kubelet learns about the Pod through a watch, and talks to the runtime through CRI.
    const kubelet = events.find((e) => e.id === 'kubelet-processing')!;
    expect(kubelet.hops.map((h) => h.tone)).toEqual(['watch', 'cri']);
  });

  it('newEvents reports what just happened, and a fresh timeline after a resubmission', () => {
    const stored = run(createSession(lesson), ...TO_STORED);
    const before = timelineEvents(stored.world, cluster(stored));
    const bound = run(
      stored,
      { type: 'ETCD_STATE_INSPECTED' },
      { type: 'SCHEDULER_INSPECTED' },
      evaluate('worker-1', true),
      evaluate('worker-2', false),
      predict('worker-1', true),
      'schedule-pod',
    );
    expect(newEvents(before, timelineEvents(bound.world, cluster(bound))).map((e) => e.id)).toEqual([
      'node-selected',
      'bound',
    ]);

    const rejected = run(createSession(lesson), submit('Bad'), { type: 'API_SERVER_INSPECTED' }, 'process-request');
    const resubmitted = run(rejected, submit('good'));
    const after = timelineEvents(resubmitted.world, cluster(resubmitted));
    expect(newEvents(timelineEvents(rejected.world, cluster(rejected)), after).map((e) => e.id)).toEqual(['submitted']);
  });
});
