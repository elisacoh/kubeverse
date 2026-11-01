import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exploreCluster, useAppStore } from '../state/useAppStore';
import { FULL_PRESENTATION } from '../state/presentation';
import { connectLearning } from './connector';
import { createSession, currentObjective } from './engine';
import { birthOfACluster as lesson } from './lessons/birthOfACluster';
import { meetYourFirstPod as lesson2 } from './lessons/meetYourFirstPod';
import { behindTheScenes as lesson3 } from './lessons/behindTheScenes';
import { REQUEST_POD_UID, sandboxPodUid } from './sandbox';
import { selectActiveHighlight, useLearningStore } from './useLearningStore';
import { deploymentUid, managedPodUid, replicaSetUid } from './controllerObjects';
import { LOOP_INTERVAL_MS } from './controllerLoop';
import { WEB_IMAGES } from '../simulation/controllers';

const app = () => useAppStore.getState();
const learning = () => useLearningStore.getState();
const completed = () => learning().session?.progress.completed ?? [];
const current = () => {
  const { lesson: l, session } = learning();
  return l && session ? currentObjective(l, session.progress)?.id : undefined;
};
const nodeNames = () => app().cluster.nodes.map((n) => n.metadata.name);

let disconnect: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  disconnect?.();
  app().setMode('explore');
  useLearningStore.setState({ lesson: null, session: null, cards: [], hintLevel: {}, completedLessons: [] });
  app().loadWorld(exploreCluster, FULL_PRESENTATION);
  app().applyScenario({ view: { kind: 'cluster' }, selection: null });
  disconnect = connectLearning();
});

afterEach(() => {
  disconnect();
  vi.useRealTimers();
});

describe('Lesson 1 with the real stores', () => {
  it('opens on an empty universe, separate from the Explore demo data', () => {
    expect(nodeNames()).toContain('worker-aurora');
    app().setMode('learn');
    expect(learning().lesson?.id).toBe('birth-of-a-cluster');
    expect(nodeNames()).toEqual([]);
    expect(app().presentation).toEqual(lesson.presentation);
    expect(learning().cards[0]).toEqual({ kind: 'intro' });
  });

  it('builds and completes the lesson through user actions only', () => {
    app().setMode('learn');

    learning().perform('initialize-cluster');
    expect(nodeNames()).toEqual(['control-plane-1']);
    expect(learning().cards[0]).toMatchObject({ kind: 'discovery', conceptId: 'cluster' });

    // Waiting does nothing: progress never advances on its own.
    vi.advanceTimersByTime(60_000);
    expect(current()).toBe('meet-control-plane');

    // Not offered yet.
    learning().perform('add-worker-node');
    expect(nodeNames()).toEqual(['control-plane-1']);

    app().focusNode('control-plane-1');
    expect(completed()).toContain('meet-control-plane');

    learning().perform('add-worker-node');
    expect(nodeNames()).toEqual(['control-plane-1', 'worker-1']);
    // The camera follows the new worker without counting as a pick.
    expect(app().view).toEqual({ kind: 'node', nodeName: 'worker-1' });
    learning().perform('add-worker-node');
    expect(nodeNames()).toEqual(['control-plane-1', 'worker-1', 'worker-2']);
    expect(app().view).toEqual({ kind: 'node', nodeName: 'worker-2' });
    expect(learning().cards[0]).toMatchObject({ kind: 'discovery', conceptId: 'many-machines' });
    learning().perform('add-worker-node');
    expect(nodeNames()).toHaveLength(3);

    app().focusNode('worker-1');
    expect(learning().cards[0]).toMatchObject({ kind: 'feedback' });
    expect(completed()).not.toContain('identify-coordination');
    app().focusNode('control-plane-1');
    app().focusNode('control-plane-1');
    expect(completed()).toContain('identify-coordination');

    app().focusNode('worker-2');
    expect(completed()).toContain('identify-capacity');
    expect(learning().cards.at(-1)).toEqual({ kind: 'complete' });
    expect(learning().completedLessons).toContain('birth-of-a-cluster');

    // The constructed cluster stays visible after completion.
    expect(nodeNames()).toEqual(['control-plane-1', 'worker-1', 'worker-2']);
    expect(app().mode).toBe('learn');
  });

  it('replay restores the empty universe', () => {
    app().setMode('learn');
    learning().perform('initialize-cluster');
    app().focusNode('control-plane-1');
    learning().perform('add-worker-node');
    learning().requestHint();
    learning().resetLesson();
    expect(nodeNames()).toEqual([]);
    expect(app().view).toEqual({ kind: 'cluster' });
    expect(learning().session).toEqual(createSession(lesson));
    expect(learning().hintLevel).toEqual({});
  });

  it('switching to Explore restores the demo cluster, and back to Learn restores the lesson world', () => {
    app().setMode('learn');
    learning().perform('initialize-cluster');
    app().focusNode('control-plane-1');
    learning().perform('add-worker-node');

    app().setMode('explore');
    expect(app().cluster).toBe(exploreCluster);
    expect(app().presentation).toEqual(FULL_PRESENTATION);
    // Picks in Explore are not lesson actions.
    app().focusNode('worker-aurora');
    expect(completed()).toEqual(['initialize-cluster', 'meet-control-plane', 'add-first-worker']);

    app().setMode('learn');
    expect(nodeNames()).toEqual(['control-plane-1', 'worker-1']);
    expect(completed()).toEqual(['initialize-cluster', 'meet-control-plane', 'add-first-worker']);
  });

  it('highlights only after a hint is requested, and only for the current objective', () => {
    app().setMode('learn');
    expect(selectActiveHighlight(learning())).toBeNull();
    learning().requestHint();
    expect(selectActiveHighlight(learning())).toEqual({ kind: 'build-site', action: 'initialize-cluster' });
    learning().perform('initialize-cluster');
    expect(selectActiveHighlight(learning())).toBeNull();
  });

  it('lesson 2 cannot be started before lesson 1 is completed', () => {
    app().setMode('learn');
    learning().startLesson('meet-your-first-pod');
    expect(learning().lesson?.id).toBe('birth-of-a-cluster');
  });
});

const HELLO = sandboxPodUid('hello-web');
const MULTI = sandboxPodUid('web-and-logger');
const BROKEN = sandboxPodUid('broken-once');
const podNames = () => app().cluster.pods.map((p) => p.metadata.name);
const enterPod = (uid: string) => {
  app().exploreInside(uid);
  vi.advanceTimersByTime(1_000);
};

describe('Lesson 2 with the real stores', () => {
  beforeEach(() => {
    useLearningStore.setState({ completedLessons: ['birth-of-a-cluster'] });
  });

  it('opens directly on the completed Lesson 1 cluster, without Pods', () => {
    app().setMode('learn');
    expect(learning().lesson?.id).toBe('meet-your-first-pod');
    expect(nodeNames()).toEqual(['control-plane-1', 'worker-1', 'worker-2']);
    expect(podNames()).toEqual([]);
    expect(app().presentation).toEqual(lesson2.presentation);
  });

  it('starting it from the Lesson 1 completion keeps Learn mode and resets the camera', () => {
    useLearningStore.setState({ completedLessons: [] });
    app().setMode('learn');
    app().focusNode('worker-1');
    useLearningStore.setState({ completedLessons: ['birth-of-a-cluster'] });
    learning().startLesson('meet-your-first-pod');
    expect(learning().lesson?.id).toBe('meet-your-first-pod');
    expect(app().view).toEqual({ kind: 'cluster' });
    expect(nodeNames()).toEqual(['control-plane-1', 'worker-1', 'worker-2']);
  });

  it('is completed through user actions only', () => {
    app().setMode('learn');
    learning().perform('create-pod');
    expect(podNames()).toEqual([]);

    learning().perform('open-container');
    learning().perform('create-pod');
    expect(podNames()).toEqual(['hello-web']);
    // The camera closes in on the new Pod alone, without selecting it.
    expect(app().view).toEqual({ kind: 'node', nodeName: 'worker-2', closeUp: HELLO });
    expect(app().selection).toBeNull();
    expect(learning().cards[0]).toMatchObject({ kind: 'discovery', conceptId: 'pod' });

    vi.advanceTimersByTime(60_000);
    expect(current()).toBe('select-pod');

    app().selectPod(HELLO);
    expect(app().view).toEqual({ kind: 'node', nodeName: 'worker-2', closeUp: HELLO });
    expect(completed()).toContain('select-pod');

    enterPod(HELLO);
    expect(app().view).toEqual({ kind: 'pod', podUid: HELLO });
    expect(completed()).toContain('enter-pod');

    app().selectContainer(HELLO, 'hello-web');
    expect(completed()).toContain('inspect-app-container');

    // Opening the example leaves the first Pod and closes in on the new one.
    learning().perform('open-multi-container-example');
    vi.advanceTimersByTime(1_000);
    expect(app().view).toEqual({ kind: 'node', nodeName: 'worker-1', closeUp: MULTI });

    enterPod(MULTI);
    app().selectContainer(MULTI, 'web');
    app().selectContainer(MULTI, 'web');
    expect(completed()).not.toContain('inspect-both-containers');
    app().selectContainer(MULTI, 'log-shipper');
    expect(completed()).toContain('inspect-both-containers');

    learning().perform('advance-lab-success');
    vi.advanceTimersByTime(1_000);
    expect(app().cluster.pods.find((p) => p.metadata.name === 'report-once')?.phase).toBe('Pending');
    learning().perform('advance-lab-success');
    learning().perform('advance-lab-success');
    expect(completed()).toContain('lab-succeeded');

    learning().perform('advance-lab-failure');
    vi.advanceTimersByTime(1_000);
    learning().perform('advance-lab-failure');
    learning().perform('advance-lab-failure');
    expect(app().cluster.pods.find((p) => p.metadata.uid === BROKEN)?.phase).toBe('Failed');
    expect(completed()).toContain('lab-failed');

    enterPod(BROKEN);
    app().selectContainer(BROKEN, 'task');
    expect(learning().cards.at(-1)).toEqual({ kind: 'complete' });
    expect(learning().completedLessons).toContain('meet-your-first-pod');
    expect(podNames()).toEqual(['hello-web', 'web-and-logger', 'report-once', 'broken-once']);
  });

  it('replay restores the Lesson 1 cluster without Pods, and Explore stays untouched', () => {
    app().setMode('learn');
    learning().perform('open-container');
    learning().perform('create-pod');
    enterPod(HELLO);

    app().setMode('explore');
    expect(app().cluster).toBe(exploreCluster);
    app().setMode('learn');
    expect(podNames()).toEqual(['hello-web']);

    learning().resetLesson();
    vi.advanceTimersByTime(1_000);
    expect(learning().session).toEqual(createSession(lesson2));
    expect(nodeNames()).toEqual(['control-plane-1', 'worker-1', 'worker-2']);
    expect(podNames()).toEqual([]);
    expect(app().view).toEqual({ kind: 'cluster' });
  });
});

const componentUid = (type: string) => app().cluster.controlPlane.find((c) => c.type === type)!.uid;
const revealed = () => app().presentation.revealed;
const myPod = () => app().cluster.pods.find((p) => p.metadata.uid === REQUEST_POD_UID);

describe('Lesson 3 with the real stores', () => {
  beforeEach(() => {
    useLearningStore.setState({ completedLessons: ['birth-of-a-cluster', 'meet-your-first-pod'] });
  });

  it('launched directly, rebuilds the Lesson 1+2 cluster with a busy worker-2', () => {
    app().setMode('learn');
    expect(learning().lesson?.id).toBe('behind-the-scenes');
    expect(nodeNames()).toEqual(['control-plane-1', 'worker-1', 'worker-2']);
    expect(podNames()).toEqual(['hello-web', 'data-cruncher']);
    expect(app().presentation).toEqual(lesson3.presentation);
    expect(learning().cards[0]).toEqual({ kind: 'intro' });
  });

  it('is completed through user actions only, the camera following the Pod’s journey', () => {
    app().setMode('learn');
    learning().dispatch({ type: 'POD_REQUEST_SUBMITTED', podName: 'my-pod', image: 'httpd:2.4' });
    // Submitting creates no Pod; the camera goes to the control plane.
    expect(myPod()).toBeUndefined();
    expect(app().view).toEqual({ kind: 'node', nodeName: 'control-plane-1' });
    expect(revealed()).toEqual(['kube-apiserver']);

    vi.advanceTimersByTime(60_000);
    expect(current()).toBe('inspect-api-server');
    learning().perform('process-request');
    expect(myPod()).toBeUndefined();

    app().selectComponent(componentUid('kube-apiserver'));
    expect(completed()).toContain('inspect-api-server');
    learning().perform('process-request');
    expect(myPod()).toMatchObject({ phase: 'Pending', nodeName: undefined });
    expect(revealed()).toEqual(['kube-apiserver', 'etcd']);

    app().selectComponent(componentUid('etcd'));
    app().selectComponent(componentUid('kube-scheduler'));
    expect(completed()).toContain('inspect-scheduler');

    app().focusNode('worker-1');
    app().focusNode('worker-2');
    expect(completed()).toContain('evaluate-nodes');
    learning().dispatch({ type: 'SCHEDULING_PREDICTED', podId: REQUEST_POD_UID, nodeId: 'worker-1', correct: true });
    learning().perform('schedule-pod');
    expect(myPod()).toMatchObject({ nodeName: 'worker-1', phase: 'Pending', awaitingKubelet: true });
    expect(app().view).toEqual({ kind: 'node', nodeName: 'worker-1' });
    expect(revealed()).toContain('kubelet');

    app().selectAgent('worker-2', 'kubelet');
    expect(learning().cards[0]).toMatchObject({ kind: 'feedback' });
    app().selectAgent('worker-1', 'kubelet');
    expect(completed()).toContain('inspect-kubelet');
    learning().perform('kubelet-prepare-pod');
    expect(revealed()).toContain('container-runtime');
    app().selectAgent('worker-1', 'container-runtime');
    learning().perform('start-container');
    expect(myPod()?.phase).toBe('Running');
    expect(app().view).toEqual({ kind: 'node', nodeName: 'worker-1', closeUp: REQUEST_POD_UID });

    app().selectPod(REQUEST_POD_UID);
    expect(completed()).toContain('observe-running');
    for (const eventId of ['submitted', 'bound', 'pod-running']) {
      learning().dispatch({ type: 'EVENT_TIMELINE_EXPLORED', eventId });
    }
    expect(learning().cards.at(-1)).toEqual({ kind: 'complete' });
    expect(learning().completedLessons).toContain('behind-the-scenes');
  });

  it('replay restores the starting world and hides the components again; Explore stays untouched', () => {
    app().setMode('learn');
    learning().dispatch({ type: 'POD_REQUEST_SUBMITTED', podName: 'my-pod', image: 'nginx:1.27' });
    app().selectComponent(componentUid('kube-apiserver'));
    learning().perform('process-request');

    app().setMode('explore');
    expect(app().cluster).toBe(exploreCluster);
    expect(app().presentation).toEqual(FULL_PRESENTATION);
    app().setMode('learn');
    expect(myPod()?.phase).toBe('Pending');
    expect(revealed()).toEqual(['kube-apiserver', 'etcd']);

    learning().resetLesson();
    vi.advanceTimersByTime(1_000);
    expect(learning().session).toEqual(createSession(lesson3));
    expect(podNames()).toEqual(['hello-web', 'data-cruncher']);
    expect(revealed()).toEqual([]);
    expect(app().view).toEqual({ kind: 'cluster' });
  });
});

describe('Lesson 4 with the real stores', () => {
  beforeEach(() => {
    useLearningStore.setState({ completedLessons: ['birth-of-a-cluster', 'meet-your-first-pod', 'behind-the-scenes'] });
  });

  const controllers = () => learning().session!.world.controllers!;
  const loopPasses = (n: number) => vi.advanceTimersByTime(LOOP_INTERVAL_MS * n);

  it('the camera follows each command to where it lands, then to the Pods worth seeing', () => {
    app().setMode('learn');
    expect(learning().lesson?.id).toBe('desired-state');
    learning().perform('delete-standalone-pod');
    loopPasses(3);
    app().selectComponent(componentUid('kube-controller-manager'));

    learning().dispatch({ type: 'DEPLOYMENT_CREATED', name: 'web', replicas: 3, image: WEB_IMAGES[0] });
    expect(app().view).toEqual({ kind: 'cluster', focus: { kind: 'workload', uid: deploymentUid('web') } });
    loopPasses(10);
    // Routine Pod creation does not drag the camera around.
    expect(app().view).toEqual({ kind: 'cluster', focus: { kind: 'workload', uid: deploymentUid('web') } });

    const rs = replicaSetUid(controllers().replicaSets[0]!.name);
    app().selectWorkload(rs);
    expect(app().view).toEqual({ kind: 'cluster', focus: { kind: 'workload', uid: rs } });
    const victim = managedPodUid(controllers().pods[0]!.serial);
    learning().dispatch({ type: 'POD_OWNER_CHAIN_EXPLORED', podId: victim, replicaSetId: rs });

    learning().dispatch({ type: 'REPLICASET_POD_DELETED', podId: victim, replicaSetId: rs });
    expect(app().view).toEqual({ kind: 'cluster', focus: { kind: 'pod', uid: victim } });
    loopPasses(10);
    const replacement = controllers().pods.find((p) => p.replaces)!;
    expect(app().view).toEqual({ kind: 'cluster', focus: { kind: 'pod', uid: managedPodUid(replacement.serial) } });
    app().selectPod(managedPodUid(replacement.serial));
    expect(completed()).toContain('observe-reconciliation');

    learning().dispatch({ type: 'DEPLOYMENT_SCALED', name: 'web', replicas: 5 });
    expect(app().view).toEqual({ kind: 'cluster', focus: { kind: 'workload', uid: rs } });
    loopPasses(10);
    const waiting = controllers().pods.find((p) => p.unschedulable)!;
    expect(app().view).toEqual({ kind: 'cluster', focus: { kind: 'pod', uid: managedPodUid(waiting.serial) } });
  });
});
