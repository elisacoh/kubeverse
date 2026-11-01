import type {
  Cluster,
  ClusterHealth,
  Container,
  ControlPlaneComponent,
  Node,
  ObjectMeta,
  OwnerReference,
  Pod,
  PodOrigin,
  WorkloadController,
} from './types';

export const findNode = (cluster: Cluster, name: string): Node | undefined =>
  cluster.nodes.find((n) => n.metadata.name === name);

export const findPod = (cluster: Cluster, uid: string): Pod | undefined =>
  cluster.pods.find((p) => p.metadata.uid === uid);

export const findWorkload = (cluster: Cluster, uid: string): WorkloadController | undefined =>
  cluster.workloads.find((w) => w.metadata.uid === uid);

export const findComponent = (cluster: Cluster, uid: string): ControlPlaneComponent | undefined =>
  cluster.controlPlane.find((c) => c.uid === uid);

export const podsOnNode = (cluster: Cluster, nodeName: string): Pod[] =>
  cluster.pods.filter((p) => p.nodeName === nodeName);

/** What a Pod asks the scheduler to reserve: the sum of its containers' requests. */
export const podRequests = (pod: Pod) =>
  pod.containers.reduce(
    (sum, c) => ({
      cpuMillis: sum.cpuMillis + (c.resources.requests?.cpuMillis ?? 0),
      memoryMiB: sum.memoryMiB + (c.resources.requests?.memoryMiB ?? 0),
    }),
    { cpuMillis: 0, memoryMiB: 0 },
  );

/** Allocatable capacity minus the requests of the Pods already bound to the Node and still active. */
export const freeCapacity = (cluster: Cluster, nodeName: string) => {
  const node = findNode(cluster, nodeName);
  if (!node) return { cpuMillis: 0, memoryMiB: 0 };
  return podsOnNode(cluster, nodeName)
    .filter((p) => p.phase !== 'Succeeded' && p.phase !== 'Failed')
    .reduce(
      (free, p) => {
        const r = podRequests(p);
        return { cpuMillis: free.cpuMillis - r.cpuMillis, memoryMiB: free.memoryMiB - r.memoryMiB };
      },
      { cpuMillis: node.allocatable.cpuMillis, memoryMiB: node.allocatable.memoryMiB },
    );
};

/** Simplified scheduling filter: a worker Node fits if its free capacity covers the Pod's requests. */
export const fitsOnNode = (cluster: Cluster, pod: Pod, nodeName: string) => {
  const node = findNode(cluster, nodeName);
  if (!node || node.role !== 'worker') return false;
  const free = freeCapacity(cluster, nodeName);
  const need = podRequests(pod);
  return free.cpuMillis >= need.cpuMillis && free.memoryMiB >= need.memoryMiB;
};

/** A Pod that exists in the API but has no Node yet. */
export const unscheduledPod = (cluster: Cluster): Pod | undefined => cluster.pods.find((p) => !p.nodeName);

export const controllerRef = (object: { metadata: ObjectMeta }): OwnerReference | undefined =>
  object.metadata.ownerReferences.find((r) => r.controller);

/** Reverse of ownerReferences: the Pods whose managing controller is this workload. */
export const podsControlledBy = (cluster: Cluster, uid: string): Pod[] =>
  cluster.pods.filter((p) => controllerRef(p)?.uid === uid);

/** Reverse of ownerReferences: the workloads (e.g. ReplicaSets) this workload manages. */
export const workloadsControlledBy = (cluster: Cluster, uid: string): WorkloadController[] =>
  cluster.workloads.filter((w) => controllerRef(w)?.uid === uid);

/**
 * Walks ownerReferences upward: Pod → ReplicaSet → Deployment.
 * Returns the chain starting at the direct owner. Static Pods end at their Node.
 */
export const ownerChain = (cluster: Cluster, pod: Pod): OwnerReference[] => {
  const chain: OwnerReference[] = [];
  let current = controllerRef(pod);
  const seen = new Set<string>();
  while (current && !seen.has(current.uid)) {
    seen.add(current.uid);
    chain.push(current);
    if (current.kind === 'Node') break;
    const owner = findWorkload(cluster, current.uid);
    current = owner?.metadata.ownerReferences.find((r) => r.controller);
  }
  return chain;
};

/** The top-level workload a user would typically interact with (e.g. the Deployment). */
export const rootWorkload = (cluster: Cluster, pod: Pod): WorkloadController | undefined => {
  const chain = ownerChain(cluster, pod).filter((r) => r.kind !== 'Node');
  const top = chain[chain.length - 1];
  return top ? findWorkload(cluster, top.uid) : undefined;
};

export const componentForPod = (cluster: Cluster, pod: Pod): ControlPlaneComponent | undefined =>
  cluster.controlPlane.find((c) => c.podUid === pod.metadata.uid);

export type PodCondition = 'ok' | 'warning' | 'failed' | 'done';

export const isContainerHealthy = (c: Container): boolean =>
  c.status.state === 'running' ||
  (c.status.state === 'terminated' && c.status.exitCode === 0 && c.role === 'init');

export const podCondition = (pod: Pod): PodCondition => {
  if (pod.phase === 'Failed' || pod.phase === 'Unknown') return 'failed';
  if (pod.phase === 'Succeeded') return 'done';
  if (pod.phase === 'Pending') return 'warning';
  return pod.containers.every(isContainerHealthy) ? 'ok' : 'warning';
};

/** Kubernetes-style status string, as `kubectl get pods` would show it. */
export const podStatusText = (pod: Pod): string => {
  const waiting = pod.containers.find((c) => c.status.state === 'waiting');
  if (waiting && waiting.status.state === 'waiting') return waiting.status.reason;
  return pod.phase;
};

export const readyCount = (pod: Pod): string =>
  `${pod.containers.filter((c) => c.status.state === 'running').length}/${pod.containers.length}`;

export const restartTotal = (pod: Pod): number =>
  pod.containers.reduce((sum, c) => sum + c.restartCount, 0);

export const isNodeReady = (node: Node): boolean =>
  node.conditions.some((c) => c.type === 'Ready' && c.status === 'True');

export interface HealthIssue {
  message: string;
  podUid?: string;
  nodeName?: string;
  componentUid?: string;
}

export interface HealthSummary {
  health: ClusterHealth;
  nodesReady: number;
  nodesTotal: number;
  podsHealthy: number;
  podsTotal: number;
  issues: HealthIssue[];
}

export const clusterHealth = (cluster: Cluster): HealthSummary => {
  const issues: HealthIssue[] = [];
  const nodesReady = cluster.nodes.filter(isNodeReady).length;
  cluster.nodes
    .filter((n) => !isNodeReady(n))
    .forEach((n) => issues.push({ message: `Node ${n.metadata.name} is NotReady`, nodeName: n.metadata.name }));

  let podsHealthy = 0;
  for (const p of cluster.pods) {
    const cond = podCondition(p);
    if (cond === 'ok' || cond === 'done') podsHealthy++;
    else
      issues.push({
        message: `${p.metadata.namespace}/${p.metadata.name} — ${podStatusText(p)}`,
        podUid: p.metadata.uid,
      });
  }
  cluster.controlPlane
    .filter((c) => !c.healthy)
    .forEach((c) => issues.push({ message: `${c.type} is unhealthy`, componentUid: c.uid }));

  const cpDown = cluster.controlPlane.some((c) => !c.healthy);
  const health: ClusterHealth =
    cpDown || nodesReady < cluster.nodes.length ? 'critical' : issues.length ? 'degraded' : 'healthy';

  return {
    health,
    nodesReady,
    nodesTotal: cluster.nodes.length,
    podsHealthy,
    podsTotal: cluster.pods.length,
    issues,
  };
};

export const ORIGIN_LABEL: Record<PodOrigin, string> = {
  static: 'Static Pod',
  replicaset: 'ReplicaSet',
  daemonset: 'DaemonSet',
  statefulset: 'StatefulSet',
  job: 'Job',
  standalone: 'Standalone Pod',
};

export const ORIGIN_EXPLAINER: Record<PodOrigin, string> = {
  static:
    'Started directly by the kubelet from a manifest file on the Node. The API server only shows a read-only "mirror" Pod.',
  replicaset:
    'Kept at the desired replica count by a ReplicaSet — usually created and versioned by a Deployment.',
  daemonset: 'A DaemonSet runs exactly one copy of this Pod on every eligible Node.',
  statefulset:
    'Managed by a StatefulSet: stable name, stable ordinal identity and (usually) its own persistent storage.',
  job: 'Created by a Job to run to completion, then stop. It is not restarted once it succeeds.',
  standalone:
    'Created directly with no controller. If it dies or its Node fails, nothing will recreate it.',
};
