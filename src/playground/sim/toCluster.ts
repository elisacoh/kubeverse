/**
 * The Playground cluster as the shared domain model the 3D scene and the
 * inspectors already understand. Deterministic: the same state always gives
 * the same `Cluster`.
 */
import type {
  Cluster,
  Container,
  ControlPlaneComponent,
  Deployment,
  Node,
  OwnerReference,
  Pod,
  ReplicaSet,
  ResourceRequirements,
  WorkloadController,
} from '../../domain/types';
import { parseCpu, parseMemory } from './quantity';
import { controllerOf, templateHash } from './cluster';
import type { ContainerSpec, KObject, PodObject, ResourceList, SimState } from './types';

/** Fixed origin for the simulated clock, so timestamps read like real ones. */
const EPOCH = Date.UTC(2026, 10, 8, 9, 0, 0);
export const isoAt = (seconds: number) => new Date(EPOCH + seconds * 1000).toISOString().replace('.000Z', 'Z');

const nodeUid = (name: string) => `pg-node-${name}`;

const toNode = (n: SimState['nodes'][number], i: number): Node => ({
  kind: 'Node',
  metadata: {
    uid: nodeUid(n.name),
    name: n.name,
    labels: {
      'kubernetes.io/hostname': n.name,
      'kubernetes.io/os': 'linux',
      ...(n.role === 'control-plane' ? { 'node-role.kubernetes.io/control-plane': '' } : {}),
    },
    creationTimestamp: isoAt(0),
    ownerReferences: [],
  },
  role: n.role,
  podCIDR: n.podCIDR,
  internalIP: n.internalIP,
  capacity: { cpuMillis: n.cpuMillis + 200, memoryMiB: n.memoryMiB + 512, pods: 110 },
  allocatable: { cpuMillis: n.cpuMillis, memoryMiB: n.memoryMiB, pods: 110 },
  conditions: [{ type: 'Ready', status: 'True' }],
  taints: n.role === 'control-plane' ? [{ key: 'node-role.kubernetes.io/control-plane', effect: 'NoSchedule' }] : [],
  nodeInfo: {
    kubeletVersion: 'v1.34.1',
    containerRuntime: 'containerd://2.1.4 (simulated)',
    osImage: 'KubeVerse Playground',
    kernelVersion: `simulated-${i}`,
  },
});

const COMPONENTS: ControlPlaneComponent['type'][] = ['kube-apiserver', 'etcd', 'kube-scheduler', 'kube-controller-manager'];

const resources = (list?: ResourceList): ResourceRequirements['requests'] => {
  if (!list) return undefined;
  const cpu = list.cpu ? parseCpu(list.cpu) : null;
  const mem = list.memory ? parseMemory(list.memory) : null;
  return { ...(cpu !== null ? { cpuMillis: cpu } : {}), ...(mem !== null ? { memoryMiB: Math.round(mem) } : {}) };
};

const ownerRefs = (o: KObject): OwnerReference[] => o.metadata.ownerReferences.map((r) => ({ kind: r.kind, name: r.name, uid: r.uid, controller: r.controller }));

const toContainer = (pod: PodObject, c: ContainerSpec): Container => {
  const st = pod.status.containerStatuses.find((x) => x.name === c.name);
  return {
    name: c.name,
    image: c.image,
    role: 'app',
    ...(c.command ? { command: [...c.command, ...(c.args ?? [])] } : {}),
    ports: (c.ports ?? []).map((p) => ({ containerPort: p.containerPort, protocol: p.protocol ?? 'TCP', ...(p.name ? { name: p.name } : {}) })),
    ...(c.volumeMounts ? { volumeMounts: c.volumeMounts.map((m) => ({ name: m.name, mountPath: m.mountPath })) } : {}),
    resources: { requests: resources(c.resources?.requests), limits: resources(c.resources?.limits) },
    status:
      st?.state === 'running'
        ? { state: 'running', startedAt: isoAt(st.startedAt ?? 0) }
        : { state: 'waiting', reason: st?.reason ?? 'ContainerCreating' },
    restartCount: st?.restartCount ?? 0,
  };
};

const toPod = (p: PodObject): Pod => ({
  kind: 'Pod',
  metadata: {
    uid: p.metadata.uid,
    name: p.metadata.name,
    namespace: p.metadata.namespace,
    labels: p.metadata.labels,
    creationTimestamp: isoAt(p.metadata.creationTime),
    ownerReferences: ownerRefs(p),
  },
  origin: controllerOf(p) ? 'replicaset' : 'standalone',
  nodeName: p.status.nodeName,
  conditions: p.status.conditions.map((c) => ({ type: c.type, status: c.status, ...(c.reason ? { reason: c.reason } : {}), ...(c.message ? { message: c.message } : {}) })),
  awaitingKubelet: p.status.stage === 'Pending' || p.status.stage === 'Scheduled',
  initContainers: [],
  containers: p.spec.containers.map((c) => toContainer(p, c)),
  phase: p.status.phase,
  podIP: p.status.podIP,
  qosClass: p.status.qosClass,
  hostNetwork: false,
  serviceAccountName: 'default',
  restartPolicy: p.spec.restartPolicy ?? 'Always',
  volumes: (p.spec.volumes ?? []).filter((v) => v.emptyDir).map((v) => ({ name: v.name, source: 'emptyDir' as const })),
  terminating: p.metadata.deletionTime !== undefined || undefined,
});

const firstContainer = (spec: { containers: ContainerSpec[] }) => spec.containers[0];

export const buildPlaygroundCluster = (s: SimState): Cluster => {
  const workloads: WorkloadController[] = [];
  const deployments = s.objects.filter((o) => o.kind === 'Deployment');
  for (const o of s.objects) {
    if (o.kind === 'Deployment') {
      const c = firstContainer(o.spec.template.spec);
      const owned = s.objects.filter((x) => x.kind === 'ReplicaSet' && controllerOf(x)?.uid === o.metadata.uid);
      const hash = templateHash(o.spec.template);
      const current = owned.find((rs) => rs.metadata.labels['pod-template-hash'] === hash);
      const d: Deployment = {
        kind: 'Deployment',
        metadata: { uid: o.metadata.uid, name: o.metadata.name, namespace: o.metadata.namespace, labels: o.metadata.labels, creationTimestamp: isoAt(o.metadata.creationTime), ownerReferences: [] },
        selector: { matchLabels: o.spec.selector.matchLabels },
        template: { labels: o.spec.template.metadata.labels, containerName: c?.name ?? '', image: c?.image ?? '', requests: resources(c?.resources?.requests) },
        replicas: o.spec.replicas,
        strategy: o.spec.strategy.type,
        rollingUpdate: { maxSurge: '25%', maxUnavailable: '25%' },
        revision: current ? owned.indexOf(current) + 1 : undefined,
        status: { replicas: o.status.replicas, updatedReplicas: o.status.updatedReplicas, readyReplicas: o.status.readyReplicas, availableReplicas: o.status.availableReplicas },
      };
      workloads.push(d);
    }
  }
  for (const o of s.objects) {
    if (o.kind !== 'ReplicaSet') continue;
    const c = firstContainer(o.spec.template.spec);
    const owner = controllerOf(o);
    const siblings = owner ? s.objects.filter((x) => x.kind === 'ReplicaSet' && controllerOf(x)?.uid === owner.uid) : [];
    const managed = owner && deployments.some((d) => d.metadata.uid === owner.uid);
    const rs: ReplicaSet = {
      kind: 'ReplicaSet',
      metadata: { uid: o.metadata.uid, name: o.metadata.name, namespace: o.metadata.namespace, labels: o.metadata.labels, creationTimestamp: isoAt(o.metadata.creationTime), ownerReferences: ownerRefs(o) },
      selector: { matchLabels: o.spec.selector.matchLabels },
      template: { labels: o.spec.template.metadata.labels, containerName: c?.name ?? '', image: c?.image ?? '', requests: resources(c?.resources?.requests) },
      replicas: o.spec.replicas,
      readyReplicas: o.status.readyReplicas,
      currentReplicas: o.status.replicas,
      ...(managed ? { revision: siblings.indexOf(o) + 1, podTemplateHash: o.metadata.labels['pod-template-hash'] } : {}),
    };
    workloads.push(rs);
  }
  const controlPlane: ControlPlaneComponent[] = COMPONENTS.map((type) => ({
    kind: 'ControlPlaneComponent',
    uid: `pg-cpc-${type}`,
    type,
    summary: '',
    nodeName: 'control-plane-1',
    runsAs: 'static-pod',
    healthy: true,
  }));
  return {
    uid: 'playground-cluster',
    name: 'playground',
    kubernetesVersion: 'v1.34.1',
    source: 'playground',
    namespaces: ['default', 'kube-system'].map((name) => ({
      kind: 'Namespace',
      metadata: { uid: `pg-ns-${name}`, name, labels: {}, creationTimestamp: isoAt(0), ownerReferences: [] },
      phase: 'Active',
    })),
    nodes: s.nodes.map(toNode),
    pods: s.objects.filter((o): o is PodObject => o.kind === 'Pod').map(toPod),
    workloads,
    controlPlane,
  };
};
