/**
 * Maps domain objects to positions in the 3D world. The domain model has no
 * notion of space; everything spatial lives here so layouts can change freely.
 */
import type { Cluster, ControlPlaneComponentType, Node, Pod } from '../domain/types';
import { podsOnNode } from '../domain/selectors';

export type Vec3 = [number, number, number];

export interface NodeLayout {
  name: string;
  position: Vec3;
  radius: number;
  /** Local position of the kubelet beacon on the platform surface. */
  kubelet: Vec3;
}

/** Height of a platform's walkable surface above its origin. */
export const PLATFORM_TOP = 0.3;

const WORKER_SLOTS: Vec3[] = [
  [-12, 0, 5],
  [0, -0.8, 11.5],
  [12, 0, 5],
];

/** Small clusters (one or two workers) sit symmetrically in front of the control plane. */
const SMALL_WORKER_SLOTS: Vec3[] = [
  [-7.5, -0.3, 8.5],
  [7.5, -0.3, 8.5],
];

export const CONTROL_PLANE_POSITION: Vec3 = [0, 2.6, -5];
export const CONTROL_PLANE_RADIUS = 6;
export const WORKER_RADIUS = 4.2;

export const nodeLayouts = (cluster: Cluster): Map<string, NodeLayout> => {
  const map = new Map<string, NodeLayout>();
  const workerCount = cluster.nodes.filter((n) => n.role !== 'control-plane').length;
  const slots = workerCount <= SMALL_WORKER_SLOTS.length ? SMALL_WORKER_SLOTS : WORKER_SLOTS;
  let w = 0;
  for (const n of cluster.nodes) {
    if (n.role === 'control-plane') {
      map.set(n.metadata.name, {
        name: n.metadata.name,
        position: CONTROL_PLANE_POSITION,
        radius: CONTROL_PLANE_RADIUS,
        kubelet: [-3.9, PLATFORM_TOP, 2.3],
      });
    } else {
      const slot = slots[w % slots.length]!;
      const ring = Math.floor(w / slots.length);
      // Kubelet sits on the inner (back) side so it never blocks the camera's view of the Pods.
      const inward = Math.atan2(-slot[2], -slot[0]) + 0.75;
      map.set(n.metadata.name, {
        name: n.metadata.name,
        position: [slot[0] * (1 + ring * 0.6), slot[1], slot[2] * (1 + ring * 0.6)],
        radius: WORKER_RADIUS,
        kubelet: [Math.cos(inward) * 3.3, PLATFORM_TOP, Math.sin(inward) * 3.3],
      });
      w++;
    }
  }
  return map;
};

/** Local positions (relative to the control-plane island) for each component structure. */
export const componentSlots: Record<ControlPlaneComponentType, Vec3> = {
  'kube-apiserver': [0, PLATFORM_TOP, 0],
  etcd: [-3.4, PLATFORM_TOP, -1.6],
  'kube-scheduler': [3.4, PLATFORM_TOP, -1.6],
  'kube-controller-manager': [0, PLATFORM_TOP, -3.6],
  'cloud-controller-manager': [-3, PLATFORM_TOP, 2.6],
};

/** Static Pods stand beside the component they run; offset from the component slot. */
const STATIC_POD_OFFSET: Vec3 = [1.05, 0, 1.0];

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/**
 * Local positions of Pods on their Node's platform. Static control-plane Pods
 * sit next to their component; everything else is arranged on a ring.
 */
export const podLocalPositions = (cluster: Cluster, node: Node): Map<string, Vec3> => {
  const result = new Map<string, Vec3>();
  const pods = podsOnNode(cluster, node.metadata.name);
  const ringPods: Pod[] = [];

  for (const p of pods) {
    const comp = cluster.controlPlane.find((c) => c.podUid === p.metadata.uid);
    if (comp) result.set(p.metadata.uid, add(componentSlots[comp.type], STATIC_POD_OFFSET));
    else ringPods.push(p);
  }

  if (node.role === 'control-plane') {
    ringPods.forEach((p, i) => result.set(p.metadata.uid, [3.2 + i * 0.9, PLATFORM_TOP, 2.6]));
  } else {
    const r = 2.25;
    const n = Math.max(ringPods.length, 1);
    ringPods.forEach((p, i) => {
      const a = (i / n) * Math.PI * 2 + Math.PI / 2 + 0.4;
      result.set(p.metadata.uid, [Math.cos(a) * r, PLATFORM_TOP, Math.sin(a) * r]);
    });
  }
  return result;
};

/**
 * Where controller objects float: beside the control plane, since they are
 * API objects acted on by the controller manager — not things running on a Node.
 */
export const WORKLOAD_ANCHOR: Vec3 = [11.5, 4.6, -3.5];
const REPLICASET_DROP = 2.5;
const REPLICASET_SPACING = 5.4;
const PENDING_DROP = 1.55;
const PENDING_SPACING = 0.8;

/** World positions of Deployments and their ReplicaSets (in creation order, left to right). */
export const workloadPositions = (cluster: Cluster): Map<string, Vec3> => {
  const result = new Map<string, Vec3>();
  const deployments = cluster.workloads.filter((w) => w.kind === 'Deployment');
  deployments.forEach((d, i) => {
    const pos = add(WORKLOAD_ANCHOR, [0, 0, i * 6]);
    result.set(d.metadata.uid, pos);
    const owned = cluster.workloads.filter((w) => w.metadata.ownerReferences.some((r) => r.controller && r.uid === d.metadata.uid));
    owned.forEach((rs, j) => {
      result.set(rs.metadata.uid, add(pos, [(j - (owned.length - 1) / 2) * REPLICASET_SPACING, -REPLICASET_DROP, 0]));
    });
  });
  return result;
};

/** Pods that exist in the API but have no Node yet wait under the controller that created them. */
export const pendingPodPositions = (cluster: Cluster): Map<string, Vec3> => {
  const result = new Map<string, Vec3>();
  const anchors = workloadPositions(cluster);
  const byOwner = new Map<string, Pod[]>();
  for (const p of cluster.pods) {
    if (p.nodeName) continue;
    const owner = p.metadata.ownerReferences.find((r) => r.controller);
    if (!owner || !anchors.has(owner.uid)) continue;
    byOwner.set(owner.uid, [...(byOwner.get(owner.uid) ?? []), p]);
  }
  for (const [owner, pods] of byOwner) {
    const base = anchors.get(owner)!;
    pods.forEach((p, i) =>
      result.set(p.metadata.uid, add(base, [(i - (pods.length - 1) / 2) * PENDING_SPACING, -PENDING_DROP, 0])),
    );
  }
  return result;
};

export const podWorldPosition = (cluster: Cluster, podUid: string): Vec3 | undefined => {
  const pod = cluster.pods.find((p) => p.metadata.uid === podUid);
  if (pod && !pod.nodeName) return pendingPodPositions(cluster).get(podUid);
  if (!pod?.nodeName) return undefined;
  const node = cluster.nodes.find((n) => n.metadata.name === pod.nodeName);
  const nl = nodeLayouts(cluster).get(pod.nodeName);
  if (!node || !nl) return undefined;
  const local = podLocalPositions(cluster, node).get(podUid);
  return local ? add(nl.position, local) : undefined;
};
