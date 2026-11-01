/**
 * The API objects behind Lesson 4's controller simulation: one Deployment,
 * its ReplicaSets and their Pods, linked by ownerReferences exactly as the
 * API stores them. Deterministic.
 */
import type { Deployment, Node, OwnerReference, Pod, PodStatusCondition, ReplicaSet } from '../domain/types';
import {
  WEB_POD_REQUESTS,
  currentReplicaSet,
  deploymentCounts,
  replicaSetCounts,
  type ControllersState,
  type ManagedPod,
  type ManagedReplicaSet,
} from '../simulation/controllers';

const BASE = Date.UTC(2026, 10, 1, 0, 30, 0);
/** Each controller pass stands for a couple of seconds of cluster time. */
const at = (pass: number) => new Date(BASE + pass * 2000).toISOString().replace('.000Z', 'Z');

export const deploymentUid = (name: string) => `sandbox-deploy-${name}`;
export const replicaSetUid = (name: string) => `sandbox-rs-${name}`;
export const managedPodUid = (serial: number) => `sandbox-rs-pod-${serial}`;

const podIP = (n: Node, host: number) => n.podCIDR.replace(/\.0\/\d+$/, `.${host}`);
const condition = (type: PodStatusCondition['type'], ok: boolean): PodStatusCondition => ({
  type,
  status: ok ? 'True' : 'False',
});

const appLabels = (deployment: string) => ({ app: deployment });

const template = (deployment: string, rs: { image: string; hash?: string }) => ({
  labels: { ...appLabels(deployment), ...(rs.hash ? { 'pod-template-hash': rs.hash } : {}) },
  containerName: 'web',
  image: rs.image,
  requests: { ...WEB_POD_REQUESTS },
});

const buildPod = (s: ControllersState, p: ManagedPod, rs: ManagedReplicaSet, nodes: readonly Node[]): Pod => {
  const deployment = s.deployment?.name ?? 'web';
  const stage = p.stage === 'terminating' ? (p.stoppedFrom ?? 'pending') : p.stage;
  const host = p.nodeName ? nodes.find((n) => n.metadata.name === p.nodeName) : undefined;
  const running = stage === 'running';
  const owner: OwnerReference = { kind: 'ReplicaSet', name: rs.name, uid: replicaSetUid(rs.name), controller: true };
  const conditions: PodStatusCondition[] = host
    ? [
        condition('PodScheduled', true),
        ...(stage === 'creating' || running
          ? [condition('Initialized', true), condition('ContainersReady', running), condition('Ready', running)]
          : []),
      ]
    : p.unschedulable
      ? [
          {
            type: 'PodScheduled',
            status: 'False',
            reason: 'Unschedulable',
            message: '0/2 worker Nodes are available: Insufficient cpu.',
          },
        ]
      : [];
  return {
    kind: 'Pod',
    origin: 'replicaset',
    metadata: {
      uid: managedPodUid(p.serial),
      name: p.name,
      namespace: 'default',
      labels: template(deployment, rs).labels,
      creationTimestamp: at(p.createdPass),
      ownerReferences: [owner],
    },
    nodeName: host?.metadata.name,
    phase: running ? 'Running' : 'Pending',
    podIP: running && host ? podIP(host, 20 + p.serial) : undefined,
    qosClass: 'Burstable',
    hostNetwork: false,
    serviceAccountName: 'default',
    initContainers: [],
    awaitingKubelet: stage === 'pending' || stage === 'bound',
    conditions,
    terminating: p.stage === 'terminating' || undefined,
    containers: [
      {
        name: 'web',
        image: rs.image,
        role: 'app',
        ports: [{ name: 'http', containerPort: 8080, protocol: 'TCP' }],
        resources: { requests: { ...WEB_POD_REQUESTS } },
        restartCount: 0,
        status: running ? { state: 'running', startedAt: at(p.createdPass + 3) } : { state: 'waiting', reason: 'ContainerCreating' },
      },
    ],
  };
};

export const buildControllerObjects = (
  s: ControllersState,
  nodes: readonly Node[],
): { workloads: (Deployment | ReplicaSet)[]; pods: Pod[] } => {
  const dep = s.deployment;
  if (!dep) return { workloads: [], pods: [] };
  const counts = deploymentCounts(s)!;
  const current = currentReplicaSet(s);
  const depRef: OwnerReference = { kind: 'Deployment', name: dep.name, uid: deploymentUid(dep.name), controller: true };

  const deployment: Deployment = {
    kind: 'Deployment',
    metadata: {
      uid: depRef.uid,
      name: dep.name,
      namespace: 'default',
      labels: appLabels(dep.name),
      creationTimestamp: at(dep.createdPass),
      ownerReferences: [],
    },
    selector: { matchLabels: appLabels(dep.name) },
    template: template(dep.name, { image: dep.image }),
    replicas: dep.replicas,
    strategy: 'RollingUpdate',
    rollingUpdate: { maxSurge: '25%', maxUnavailable: '25%' },
    revision: current?.revision,
    status: {
      replicas: counts.current,
      updatedReplicas: counts.updated,
      readyReplicas: counts.ready,
      availableReplicas: counts.available,
    },
  };

  const replicaSets: ReplicaSet[] = s.replicaSets.map((rs) => {
    const c = replicaSetCounts(s, rs);
    return {
      kind: 'ReplicaSet',
      metadata: {
        uid: replicaSetUid(rs.name),
        name: rs.name,
        namespace: 'default',
        labels: template(dep.name, rs).labels,
        creationTimestamp: at(rs.createdPass),
        ownerReferences: [depRef],
      },
      selector: { matchLabels: template(dep.name, rs).labels },
      template: template(dep.name, rs),
      replicas: rs.replicas,
      readyReplicas: c.ready,
      currentReplicas: c.current,
      revision: rs.revision,
      podTemplateHash: rs.hash,
    };
  });

  const pods = s.pods.flatMap((p) => {
    const rs = s.replicaSets.find((r) => r.name === p.replicaSet);
    return rs ? [buildPod(s, p, rs, nodes)] : [];
  });

  return { workloads: [deployment, ...replicaSets], pods };
};

/** Pods created to replace one deleted from outside (for the lesson, not an API field). */
export const replacementPodUids = (s: ControllersState | null): Set<string> =>
  new Set((s?.pods ?? []).filter((p) => p.replaces).map((p) => managedPodUid(p.serial)));

export const managedPodBySerialUid = (s: ControllersState, uid: string) => s.pods.find((p) => managedPodUid(p.serial) === uid);
