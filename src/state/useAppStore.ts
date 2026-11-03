import { create } from 'zustand';
import type { Cluster } from '../domain/types';
import { controllerRef, findPod } from '../domain/selectors';
import { staticDemoSource } from '../simulation/staticDemoSource';
import { FULL_PRESENTATION, type NodeAgent, type ScenePresentation } from './presentation';

export type AppMode = 'explore' | 'learn' | 'playground';

/** Where the camera is and which world is rendered. */
/** Something in the cluster view the camera frames closely: a controller emblem, or a Pod still waiting for a Node. */
export type CameraFocus = { kind: 'workload' | 'pod'; uid: string };

export type View =
  | { kind: 'cluster'; focus?: CameraFocus }
  /** `closeUp`: the camera frames one Pod on this Node closely (e.g. when it is introduced). */
  | { kind: 'node'; nodeName: string; closeUp?: string }
  | { kind: 'pod'; podUid: string };

export type Selection =
  | { kind: 'pod'; uid: string }
  | { kind: 'component'; uid: string }
  | { kind: 'container'; podUid: string; name: string }
  | { kind: 'agent'; nodeName: string; agent: NodeAgent }
  /** A workload controller object (Deployment, ReplicaSet…). */
  | { kind: 'workload'; uid: string }
  | null;

/** The latest entity the learner clicked; `seq` changes on every pick, even of the same entity. */
export type EntityPick =
  | { kind: 'node' | 'pod' | 'component' | 'workload'; id: string; seq: number }
  /** `id` is the Pod uid. */
  | { kind: 'container'; id: string; container: string; seq: number }
  /** `id` is the Node name. */
  | { kind: 'agent'; id: string; agent: NodeAgent; seq: number };

/** Short-lived camera "dive" played before switching into/out of the anatomy view. */
export type Transition = { kind: 'enter-pod'; podUid: string } | { kind: 'exit-pod' } | null;

const DIVE_MS = 700;
const FADE_OUT_MS = 350;

interface AppState {
  cluster: Cluster;
  presentation: ScenePresentation;
  mode: AppMode;
  pick: EntityPick | null;
  view: View;
  selection: Selection;
  hoveredId: string | null;
  transition: Transition;
  /** True while the screen is faded for a world swap. */
  veil: boolean;
  /** Bumped to force the camera to re-apply its goal for the current view. */
  cameraNonce: number;
  /** Latest request to glide the orbit pivot to the empty-space point under the pointer (NDC). */
  pivotRequest: { ndc: [number, number]; seq: number } | null;

  setMode: (mode: AppMode) => void;
  /** Swap the world being shown (Explore demo data or a lesson sandbox). */
  loadWorld: (cluster: Cluster, presentation: ScenePresentation) => void;
  setHovered: (id: string | null) => void;
  goToCluster: () => void;
  focusNode: (nodeName: string) => void;
  /** Move the camera to a node without counting it as a learner pick. */
  flyToNode: (nodeName: string) => void;
  /** Frame one Pod closely, leaving the anatomy view if needed. Not a learner pick. */
  showPod: (podUid: string) => void;
  /** Frame a controller or waiting Pod from the cluster view, keeping the selection. Not a learner pick. */
  focusInCluster: (focus: CameraFocus) => void;
  requestPivot: (ndc: [number, number]) => void;
  selectPod: (uid: string) => void;
  selectComponent: (uid: string) => void;
  selectContainer: (podUid: string, name: string) => void;
  selectAgent: (nodeName: string, agent: NodeAgent) => void;
  /** Select a workload; in Learn mode the camera moves to the cluster view and frames it. */
  selectWorkload: (uid: string) => void;
  /** Update what the scene reveals without swapping the world. */
  setPresentation: (presentation: ScenePresentation) => void;
  clearSelection: () => void;
  exploreInside: (podUid: string) => void;
  exitPod: (to: 'node' | 'cluster') => void;
  /** Escape / back button: one level up. */
  back: () => void;
  recenter: () => void;
  /** Jump straight to a navigation state, cancelling any running transition (lesson start / reset). */
  applyScenario: (scenario: { view: View; selection: Selection }) => void;
}

let timers: ReturnType<typeof setTimeout>[] = [];
const schedule = (fn: () => void, ms: number) => {
  timers.push(setTimeout(fn, ms));
};
const clearTimers = () => {
  timers.forEach(clearTimeout);
  timers = [];
};

let pickSeq = 0;
const pick = (kind: 'node' | 'pod' | 'component' | 'workload', id: string): EntityPick => ({ kind, id, seq: ++pickSeq });

/** Whether the right-hand inspector has something to show. */
export const selectInspectorOpen = (s: Pick<AppState, 'selection' | 'view'>) =>
  s.selection !== null || (s.view.kind === 'node' && !s.view.closeUp);

export const exploreCluster = staticDemoSource.snapshot();

export const useAppStore = create<AppState>()((set, get) => ({
  cluster: exploreCluster,
  presentation: FULL_PRESENTATION,
  mode: 'explore',
  pick: null,
  view: { kind: 'cluster' },
  selection: null,
  hoveredId: null,
  transition: null,
  veil: false,
  cameraNonce: 0,
  pivotRequest: null,

  // The Playground teaser covers the world, so nothing should stay selected behind it.
  setMode: (mode) => set(mode === 'playground' ? { mode, selection: null } : { mode }),

  loadWorld: (cluster, presentation) => set({ cluster, presentation, hoveredId: null }),

  setHovered: (hoveredId) => set({ hoveredId }),

  goToCluster: () => {
    if (get().view.kind === 'pod') return get().exitPod('cluster');
    set({ view: { kind: 'cluster' }, selection: null });
  },

  focusNode: (nodeName) => {
    if (get().view.kind === 'pod') return;
    set({ view: { kind: 'node', nodeName }, selection: null, pick: pick('node', nodeName) });
  },

  flyToNode: (nodeName) => {
    if (get().view.kind === 'pod' || get().transition) return;
    set({ view: { kind: 'node', nodeName }, selection: null });
  },

  showPod: (podUid) => {
    const nodeName = findPod(get().cluster, podUid)?.nodeName;
    if (!nodeName) return;
    const view: View = { kind: 'node', nodeName, closeUp: podUid };
    if (get().view.kind !== 'pod') {
      if (!get().transition) set({ view, selection: null });
      return;
    }
    clearTimers();
    set({ transition: { kind: 'exit-pod' }, veil: true });
    schedule(() => {
      set({ view, selection: null, transition: null });
      schedule(() => set({ veil: false }), 80);
    }, FADE_OUT_MS);
  },

  focusInCluster: (focus) => {
    if (get().view.kind === 'pod' || get().transition) return;
    set({ view: { kind: 'cluster', focus } });
  },

  requestPivot: (ndc) => set((s) => ({ pivotRequest: { ndc, seq: (s.pivotRequest?.seq ?? 0) + 1 } })),

  selectPod: (uid) => {
    const pod = findPod(get().cluster, uid);
    if (!pod) return;
    if (get().view.kind === 'pod') {
      set({ selection: { kind: 'pod', uid } });
      return;
    }
    const view = get().view;
    const keepCloseUp = view.kind === 'node' && view.closeUp === uid;
    // A controller's unscheduled Pod waits beside its ReplicaSet, which only the cluster view shows.
    const waitsByOwner = !pod.nodeName && controllerRef(pod) !== undefined && get().mode === 'learn';
    set({
      pick: pick('pod', uid),
      selection: { kind: 'pod', uid },
      view: keepCloseUp
        ? view
        : pod.nodeName
          ? { kind: 'node', nodeName: pod.nodeName }
          : waitsByOwner
            ? { kind: 'cluster', focus: { kind: 'pod', uid } }
            : view,
    });
  },

  selectComponent: (uid) => {
    const comp = get().cluster.controlPlane.find((c) => c.uid === uid);
    if (!comp) return;
    set({
      selection: { kind: 'component', uid },
      view: { kind: 'node', nodeName: comp.nodeName },
      pick: pick('component', uid),
    });
  },

  selectContainer: (podUid, name) =>
    set({
      selection: { kind: 'container', podUid, name },
      pick: { kind: 'container', id: podUid, container: name, seq: ++pickSeq },
    }),

  selectAgent: (nodeName, agent) => {
    if (get().view.kind === 'pod' || !get().cluster.nodes.some((n) => n.metadata.name === nodeName)) return;
    set({
      selection: { kind: 'agent', nodeName, agent },
      view: { kind: 'node', nodeName },
      pick: { kind: 'agent', id: nodeName, agent, seq: ++pickSeq },
    });
  },

  selectWorkload: (uid) => {
    if (!get().cluster.workloads.some((w) => w.metadata.uid === uid)) return;
    // Only Learn mode draws controllers in the world; elsewhere the camera stays put.
    const stay = get().mode !== 'learn' || get().view.kind === 'pod' || get().transition !== null;
    set({
      selection: { kind: 'workload', uid },
      pick: pick('workload', uid),
      ...(stay ? {} : { view: { kind: 'cluster', focus: { kind: 'workload', uid } } }),
    });
  },

  setPresentation: (presentation) => set({ presentation }),

  clearSelection: () => set({ selection: null }),

  exploreInside: (podUid) => {
    if (get().transition || get().view.kind === 'pod') return;
    clearTimers();
    set({ transition: { kind: 'enter-pod', podUid }, selection: { kind: 'pod', uid: podUid } });
    schedule(() => set({ veil: true }), DIVE_MS - FADE_OUT_MS);
    schedule(() => {
      set({ view: { kind: 'pod', podUid }, transition: null, selection: { kind: 'pod', uid: podUid } });
      schedule(() => set({ veil: false }), 80);
    }, DIVE_MS);
  },

  exitPod: (to) => {
    const view = get().view;
    if (view.kind !== 'pod' || get().transition) return;
    const pod = findPod(get().cluster, view.podUid);
    clearTimers();
    set({ transition: { kind: 'exit-pod' }, veil: true });
    schedule(() => {
      const nodeName = pod?.nodeName;
      set({
        view: to === 'node' && nodeName ? { kind: 'node', nodeName } : { kind: 'cluster' },
        selection: to === 'node' && pod ? { kind: 'pod', uid: pod.metadata.uid } : null,
        transition: null,
      });
      schedule(() => set({ veil: false }), 80);
    }, FADE_OUT_MS);
  },

  back: () => {
    const { view, selection, transition } = get();
    if (transition) return;
    if (view.kind === 'pod') {
      if (selection?.kind === 'container') set({ selection: { kind: 'pod', uid: view.podUid } });
      else get().exitPod('node');
      return;
    }
    if (selection) return set({ selection: null });
    if (view.kind === 'node' || view.focus) return set({ view: { kind: 'cluster' } });
  },

  recenter: () => set((s) => ({ cameraNonce: s.cameraNonce + 1 })),

  applyScenario: ({ view, selection }) => {
    clearTimers();
    set((s) => ({ view, selection, transition: null, veil: false, cameraNonce: s.cameraNonce + 1 }));
  },
}));
