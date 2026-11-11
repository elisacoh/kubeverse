import type { Cluster } from '../../domain/types';
import { findPod } from '../../domain/selectors';
import type { CameraFocus, Selection, Transition, View } from '../../state/useAppStore';
import { nodeLayouts, podWorldPosition, workloadPositions, type Vec3 } from '../layout';

export interface CameraGoal {
  position: Vec3;
  target: Vec3;
  /** Seconds. */
  duration: number;
  /** Start from this pose instead of the current one (used when entering a new world). */
  from?: { position: Vec3; target: Vec3 };
  /** Glide to `target` keeping the current viewing distance and angle; `position` is ignored. */
  pan?: boolean;
}

export const CLUSTER_GOAL: CameraGoal = {
  position: [0, 17, 30],
  target: [0, -0.4, 4.5],
  duration: 1.4,
};

/** An empty universe: stay close to where the cluster will begin. */
export const EMPTY_CLUSTER_GOAL: CameraGoal = {
  position: [0, 10, 15],
  target: [0, 2.2, -3.5],
  duration: 1.4,
};

export const ANATOMY_GOAL: CameraGoal = {
  position: [0, 4.6, 14.5],
  target: [0, 0.2, 0],
  duration: 1.6,
  from: { position: [0, 1.6, 2.2], target: [0, 1.4, 0] },
};

const horizontalDir = (p: Vec3): [number, number] => {
  const len = Math.hypot(p[0], p[2]);
  return len < 0.001 ? [0, 1] : [p[0] / len, p[2] / len];
};

/**
 * Moves the view to a controller, a Pod or a point. Without `zoom` the learner keeps the distance they chose.
 * A Deployment is aimed between itself and its ReplicaSets, so both stay in view.
 */
const focusGoal = (cluster: Cluster, focus: CameraFocus): CameraGoal | undefined => {
  let target: Vec3 | undefined;
  let distance = 5;
  if (focus.kind === 'spot') {
    target = focus.position;
  } else if (focus.kind === 'workload') {
    const p = workloadPositions(cluster).get(focus.uid);
    const w = cluster.workloads.find((x) => x.metadata.uid === focus.uid);
    if (p && w) target = [p[0], p[1] - (w.kind === 'Deployment' ? 1.5 : 0.7), p[2]];
    distance = w?.kind === 'Deployment' ? 9 : 7;
  } else {
    const p = podWorldPosition(cluster, focus.uid);
    if (p) target = [p[0], p[1] + 0.6, p[2]];
    distance = 4;
  }
  if (!target) return undefined;
  if (!focus.zoom) return { target, position: target, duration: 1.2, pan: true };
  const [dx, dz] = horizontalDir(target);
  return { target, position: [target[0] + dx * distance * 0.55, target[1] + distance * 0.5, target[2] + dz * distance * 0.55 + distance * 0.6], duration: 1.3 };
};

export const computeGoal = (
  cluster: Cluster,
  view: View,
  selection: Selection,
  transition: Transition,
): CameraGoal => {
  if (transition?.kind === 'enter-pod') {
    const p = podWorldPosition(cluster, transition.podUid);
    if (p) {
      const [dx, dz] = horizontalDir(p);
      return {
        target: [p[0], p[1] + 0.5, p[2]],
        position: [p[0] + dx * 1.1, p[1] + 0.9, p[2] + dz * 1.1 + 0.6],
        duration: 0.75,
      };
    }
  }

  if (view.kind === 'pod') return ANATOMY_GOAL;
  if (view.kind === 'cluster') {
    const focused = view.focus && focusGoal(cluster, view.focus);
    if (focused) return focused;
    return cluster.nodes.length === 0 ? EMPTY_CLUSTER_GOAL : CLUSTER_GOAL;
  }

  const layout = nodeLayouts(cluster).get(view.nodeName);
  if (!layout) return CLUSTER_GOAL;
  const c = layout.position;
  const isCP = layout.radius > 5;

  const podUid = selection?.kind === 'pod' ? selection.uid : undefined;

  const closeUp = view.closeUp && (!podUid || podUid === view.closeUp) ? view.closeUp : undefined;
  const closePos = closeUp ? podWorldPosition(cluster, closeUp) : undefined;
  if (closePos) {
    // Pods face outward from the cluster centre, so look at them from that side.
    const [dx, dz] = horizontalDir(c);
    return {
      target: [closePos[0], closePos[1] + 0.6, closePos[2]],
      position: [closePos[0] + dx * 2.7, closePos[1] + 1.45, closePos[2] + dz * 2.7],
      duration: 1.5,
    };
  }
  const pod = podUid ? findPod(cluster, podUid) : undefined;
  const podPos = pod?.nodeName === view.nodeName && podUid ? podWorldPosition(cluster, podUid) : undefined;

  if (podPos) {
    const [dx, dz] = isCP ? [0, 1] : horizontalDir(c);
    const t: Vec3 = [(c[0] + podPos[0] * 4) / 5, podPos[1] + 0.6, (c[2] + podPos[2] * 4) / 5];
    return {
      target: t,
      position: [t[0] + dx * 6.2, t[1] + 3.6, t[2] + dz * 6.2],
      duration: 1.1,
    };
  }

  if (isCP) {
    return { target: [c[0], c[1] + 0.8, c[2]], position: [c[0], c[1] + 8.5, c[2] + 13], duration: 1.3 };
  }
  const [dx, dz] = horizontalDir(c);
  return {
    target: [c[0], c[1] + 0.6, c[2]],
    position: [c[0] + dx * 8.5, c[1] + 6.5, c[2] + dz * 8.5 + 1.5],
    duration: 1.3,
  };
};
