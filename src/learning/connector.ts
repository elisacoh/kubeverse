import { exploreCluster, useAppStore } from '../state/useAppStore';
import { FULL_PRESENTATION } from '../state/presentation';
import { defaultLesson } from './curriculum';
import { canPerform, presentationOf } from './engine';
import { deriveActions, deriveViewActions } from './observe';
import { REQUEST_POD_UID, SANDBOX_CONTROL_PLANE, buildSandboxCluster, type SandboxWorld } from './sandbox';
import { deploymentUid, managedPodUid, replacementPodUids, replicaSetUid } from './controllerObjects';
import { currentReplicaSet, type ControllersState } from '../simulation/controllers';
import { LOOP_INTERVAL_MS, useControllerLoop } from './controllerLoop';
import { useLearningStore } from './useLearningStore';

/**
 * Lesson 4: the camera glides, without zooming, to where the learner's
 * command lands — the Deployment, the ReplicaSet being scaled, the deleted
 * Pod — and then to the consequences worth seeing: a replacement Pod
 * arriving, Pods that cannot be scheduled. Routine Pod churn is not chased.
 */
const followControllers = (before: ControllersState | null, after: ControllersState) => {
  const app = useAppStore.getState();
  const fresh = after.events.slice(before?.events.length ?? 0);
  const podUid = (name: string) => {
    const p = after.pods.find((x) => x.name === name);
    return p ? managedPodUid(p.serial) : undefined;
  };
  let move: (() => void) | undefined;
  let waitingShown = false;
  for (const e of fresh) {
    if (e.source === 'kubectl') {
      if (e.reason === 'Create' && after.deployment) {
        const uid = deploymentUid(after.deployment.name);
        move = () => app.focusInCluster({ kind: 'workload', uid });
      } else if (e.reason === 'SetImage' && after.deployment) {
        const uid = deploymentUid(after.deployment.name);
        move = () => app.focusInCluster({ kind: 'workload', uid });
      } else if (e.reason === 'Scale') {
        const rs = currentReplicaSet(after);
        if (rs) move = () => app.focusInCluster({ kind: 'workload', uid: replicaSetUid(rs.name) });
      } else if (e.reason === 'Delete' && e.object.kind === 'Pod') {
        const uid = podUid(e.object.name);
        if (uid) move = () => app.focusInCluster({ kind: 'pod', uid });
      }
    } else if (e.reason === 'FailedScheduling' && !waitingShown) {
      // The first waiting Pod is the one that keeps the "no room" tag.
      const uid = podUid(e.object.name);
      if (uid) {
        waitingShown = true;
        move = () => app.focusInCluster({ kind: 'pod', uid });
      }
    } else if (e.reason === 'Scheduled' && after.pods.find((p) => p.name === e.object.name)?.replaces) {
      const uid = podUid(e.object.name);
      if (uid) move = () => app.focusInCluster({ kind: 'pod', uid });
    }
  }
  move?.();
};

/**
 * The camera follows what the learner just set in motion: the request
 * travelling through the cluster, else a new Pod, else a new worker.
 */
const followNewArrival = (before: SandboxWorld, after: SandboxWorld) => {
  const app = useAppStore.getState();
  if (after.controllers) return followControllers(before.controllers, after.controllers);
  const stage = after.request?.stage;
  if (stage !== before.request?.stage) {
    if (stage === 'submitted') return app.flyToNode(SANDBOX_CONTROL_PLANE);
    if (stage === 'bound' && after.request?.nodeName) return app.flyToNode(after.request.nodeName);
    if (stage === 'running') return app.showPod(REQUEST_POD_UID);
    if (stage) return;
  }
  const prev = buildSandboxCluster(before);
  const next = buildSandboxCluster(after);
  const pod = next.pods.find((p) => !prev.pods.some((q) => q.metadata.uid === p.metadata.uid));
  if (pod) return app.showPod(pod.metadata.uid);
  const node = next.nodes.find((n) => n.role === 'worker' && !prev.nodes.some((m) => m.metadata.uid === n.metadata.uid));
  if (node) app.flyToNode(node.metadata.name);
};

/** A selected Pod or workload that no longer exists is let go, rather than leaving an empty panel. */
const dropVanishedSelection = () => {
  const app = useAppStore.getState();
  const s = app.selection;
  if (s?.kind === 'pod' && !app.cluster.pods.some((p) => p.metadata.uid === s.uid)) app.clearSelection();
  if (s?.kind === 'workload' && !app.cluster.workloads.some((w) => w.metadata.uid === s.uid)) app.clearSelection();
};

/**
 * Wires the app store to the learning store:
 * - Learn mode shows the lesson's own sandbox world; Explore shows the demo
 *   cluster. Switching modes never discards either one.
 * - While in Learn mode, the learner's picks and entering a Pod become actions.
 * - Lesson 4's control loops run one pass at a time while there is work to do.
 * Returns an unsubscribe function.
 */
export const connectLearning = (): (() => void) => {
  const showWorld = () => {
    const app = useAppStore.getState();
    const { lesson, session } = useLearningStore.getState();
    if (app.mode === 'learn' && lesson && session) {
      app.loadWorld(buildSandboxCluster(session.world), presentationOf(lesson, session));
      if (app.view.kind !== 'pod') dropVanishedSelection();
    } else if (app.mode === 'explore' && app.cluster !== exploreCluster) {
      app.loadWorld(exploreCluster, FULL_PRESENTATION);
    }
  };

  let loopTimer: ReturnType<typeof setTimeout> | null = null;
  const loopShouldRun = () => {
    const { lesson, session } = useLearningStore.getState();
    return (
      useAppStore.getState().mode === 'learn' &&
      !useControllerLoop.getState().paused &&
      !!lesson &&
      !!session &&
      canPerform(lesson, session, 'run-controllers')
    );
  };
  const scheduleLoop = () => {
    if (!loopShouldRun()) {
      if (loopTimer) clearTimeout(loopTimer);
      loopTimer = null;
      return;
    }
    if (loopTimer) return;
    loopTimer = setTimeout(() => {
      loopTimer = null;
      if (loopShouldRun()) useLearningStore.getState().perform('run-controllers');
      scheduleLoop();
    }, LOOP_INTERVAL_MS);
  };

  const onModeChange = () => {
    const app = useAppStore.getState();
    const learning = useLearningStore.getState();
    if (app.mode === 'learn' && !learning.lesson) {
      learning.startLesson(defaultLesson(learning.completedLessons).id);
    } else {
      const scenario = app.mode === 'learn' && learning.lesson ? learning.lesson.initialScenario : null;
      app.applyScenario(scenario ?? { view: { kind: 'cluster' }, selection: null });
    }
    showWorld();
    scheduleLoop();
  };

  const offApp = useAppStore.subscribe((next, prev) => {
    if (next.mode !== prev.mode) onModeChange();
    if (next.mode !== 'learn') return;
    const world = useLearningStore.getState().session?.world;
    const context = { replacements: replacementPodUids(world?.controllers ?? null) };
    const actions = [
      ...deriveActions(next.cluster, prev.pick, next.pick, context),
      ...(prev.mode === 'learn' && next.view !== prev.view ? deriveViewActions(next.cluster, prev.view, next.view) : []),
    ];
    if (actions.length) actions.forEach(useLearningStore.getState().dispatch);
  });

  const offLearning = useLearningStore.subscribe((next, prev) => {
    const app = useAppStore.getState();
    const learn = app.mode === 'learn';
    const worldChanged = next.session?.world !== prev.session?.world;
    if (next.lesson && next.lesson !== prev.lesson && learn) {
      app.applyScenario(next.lesson.initialScenario ?? { view: { kind: 'cluster' }, selection: null });
    }
    if (next.lesson !== prev.lesson || next.session?.world === next.lesson?.initialWorld) {
      useControllerLoop.getState().setPaused(false);
    }
    if (worldChanged || next.lesson !== prev.lesson) showWorld();
    else if (learn && next.lesson && next.session && next.session !== prev.session) {
      const presentation = presentationOf(next.lesson, next.session);
      if (JSON.stringify(presentation) !== JSON.stringify(app.presentation)) app.setPresentation(presentation);
    }
    if (worldChanged && next.lesson === prev.lesson && prev.session && next.session && learn) {
      followNewArrival(prev.session.world, next.session.world);
    }
    scheduleLoop();
  });

  const offLoop = useControllerLoop.subscribe(scheduleLoop);

  if (useAppStore.getState().mode === 'learn') onModeChange();
  return () => {
    offApp();
    offLearning();
    offLoop();
    if (loopTimer) clearTimeout(loopTimer);
  };
};
