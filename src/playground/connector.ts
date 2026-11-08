import type { Cluster } from '../domain/types';
import { useAppStore } from '../state/useAppStore';
import { lessonById } from './curriculum';
import { FULL_PRESENTATION, type ScenePresentation } from '../state/presentation';
import { buildPlaygroundCluster } from './sim/toCluster';
import { usePlayground, type ResourceRef } from './store';
import type { KObject } from './sim/types';

const PRESENTATION: ScenePresentation = { ...FULL_PRESENTATION, animateEntries: true };

/** Simulated seconds advance in real time while a lesson workspace is open. */
export const TICK_MS = 1000;

/** The universe before any cluster exists, for lessons that build no Kubernetes object. */
const emptyUniverse = (c: Cluster): Cluster => ({ ...c, uid: 'playground-universe', nodes: [], pods: [], workloads: [], controlPlane: [] });

const sameRef = (a: ResourceRef | null, b: ResourceRef | null) => a?.kind === b?.kind && a?.name === b?.name && a?.namespace === b?.namespace;

const refOf = (o: KObject): ResourceRef => ({ kind: o.kind, name: o.metadata.name, namespace: o.metadata.namespace });

/**
 * Shows an object in the 3D world: Pods and controllers are selected and
 * framed; objects without a native form (Services, ConfigMaps, claims) are
 * highlighted on their shelf, seen from the cluster overview.
 */
export const locate = (ref: ResourceRef) => {
  const app = useAppStore.getState();
  const o = usePlayground.getState().sim.objects.find((x) => x.kind === ref.kind && x.metadata.name === ref.name && x.metadata.namespace === ref.namespace);
  if (!o) return;
  if (o.kind === 'Pod') app.selectPod(o.metadata.uid);
  else if (o.kind === 'Deployment' || o.kind === 'ReplicaSet') app.selectWorkload(o.metadata.uid);
  else {
    app.clearSelection();
    if (app.view.kind === 'pod') app.exitPod('cluster');
    else app.applyScenario({ view: { kind: 'cluster' }, selection: null });
  }
};

/**
 * Wires the Playground to the shared 3D world:
 * - in Playground mode the scene shows the simulated cluster, rebuilt when objects change;
 * - picking a Pod or controller in the world selects it in My Cluster;
 * - the simulation clock ticks while a lesson workspace is open.
 * Returns an unsubscribe function.
 */
export const connectPlayground = (): (() => void) => {
  let shown: { objects: readonly KObject[]; empty: boolean } | null = null;
  const show = () => {
    const app = useAppStore.getState();
    if (app.mode !== 'playground') {
      shown = null;
      return;
    }
    const pg = usePlayground.getState();
    const sim = pg.sim;
    const empty = pg.view === 'workspace' && lessonById(pg.lessonId)?.world === 'empty';
    if (shown && shown.objects === sim.objects && shown.empty === empty && app.cluster.source === 'playground') return;
    if (shown?.empty && empty) return;
    shown = { objects: sim.objects, empty };
    app.loadWorld(empty ? emptyUniverse(buildPlaygroundCluster(sim)) : buildPlaygroundCluster(sim), PRESENTATION);
    const s = useAppStore.getState().selection;
    const cluster = useAppStore.getState().cluster;
    if (s?.kind === 'pod' && !cluster.pods.some((p) => p.metadata.uid === s.uid)) app.clearSelection();
    if (s?.kind === 'workload' && !cluster.workloads.some((w) => w.metadata.uid === s.uid)) app.clearSelection();
  };

  const offApp = useAppStore.subscribe((next, prev) => {
    if (next.mode !== prev.mode) show();
    if (next.mode !== 'playground' || next.selection === prev.selection) return;
    const sel = next.selection;
    const uid = sel?.kind === 'pod' || sel?.kind === 'workload' ? sel.uid : sel?.kind === 'container' ? sel.podUid : null;
    if (!uid) return;
    const pg = usePlayground.getState();
    const o = pg.sim.objects.find((x) => x.metadata.uid === uid);
    if (o && !sameRef(pg.selected, refOf(o))) pg.select(refOf(o));
  });

  const offPlayground = usePlayground.subscribe((next, prev) => {
    if (next.sim !== prev.sim || next.view !== prev.view || next.lessonId !== prev.lessonId) show();
  });

  const clock = setInterval(() => {
    const pg = usePlayground.getState();
    if (useAppStore.getState().mode === 'playground' && pg.view === 'workspace' && !document.hidden) pg.tick();
  }, TICK_MS);

  show();
  return () => {
    offApp();
    offPlayground();
    clearInterval(clock);
  };
};
