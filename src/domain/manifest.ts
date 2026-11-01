/**
 * Kubernetes-style YAML manifests for the objects shown in the world, as
 * `kubectl get -o yaml` would print them (trimmed to the fields we model).
 */
import { findComponent, findNode, findPod, findWorkload } from './selectors';
import type {
  Cluster,
  Container,
  ControlPlaneComponent,
  Node,
  ObjectMeta,
  OwnerReference,
  Pod,
  PodTemplateSummary,
  RestartPolicy,
  WorkloadController,
} from './types';

type Yaml = string | number | boolean | null | undefined | readonly Yaml[] | { readonly [key: string]: Yaml };

export interface Manifest {
  /** Where this YAML lives, e.g. "Node/worker-2" or a file path on the Node. */
  source: string;
  /** Short caveat when the YAML is not a plain API object. */
  note?: string;
  yaml: string;
}

export type ManifestTarget =
  | { kind: 'node'; name: string }
  | { kind: 'pod'; uid: string }
  | { kind: 'component'; uid: string }
  | { kind: 'container'; podUid: string; name: string }
  | { kind: 'workload'; uid: string };

// ---------------------------------------------------------------------------
// YAML serialization
// ---------------------------------------------------------------------------

const PLAIN = /^[A-Za-z0-9_./:@+-][A-Za-z0-9_ ./:@+=-]*$/;
const RESERVED = /^(true|false|yes|no|on|off|null|~|-?\d+(\.\d+)?|\d{4}-\d\d-\d\d.*)$/i;

const scalar = (v: string | number | boolean | null): string => {
  if (v === null) return 'null';
  if (typeof v !== 'string') return String(v);
  if (v === '' || !PLAIN.test(v) || RESERVED.test(v) || v.endsWith(' ') || v.includes(': ')) return JSON.stringify(v);
  return v;
};

const isEmpty = (v: Yaml) =>
  Array.isArray(v) ? v.length === 0 : typeof v === 'object' && v !== null && Object.keys(v).length === 0;

const lines = (value: Yaml, indent: string): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((item: Yaml) => {
      if (typeof item === 'object' && item !== null && !isEmpty(item)) {
        const [first = '', ...rest] = lines(item, `${indent}  `);
        return [`${indent}- ${first.trimStart()}`, ...rest];
      }
      return [`${indent}- ${inline(item)}`];
    });
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value as Record<string, Yaml>).flatMap(([k, v]) => {
      if (v === undefined) return [];
      const key = scalar(k);
      if (typeof v === 'object' && v !== null && !isEmpty(v)) {
        return [`${indent}${key}:`, ...lines(v, Array.isArray(v) ? indent : `${indent}  `)];
      }
      return [`${indent}${key}: ${inline(v)}`];
    });
  }
  return [`${indent}${inline(value)}`];
};

const inline = (v: Yaml): string => {
  if (Array.isArray(v)) return '[]';
  if (typeof v === 'object' && v !== null) return '{}';
  return scalar(v ?? null);
};

export const toYaml = (value: Yaml): string => `${lines(value, '').join('\n')}\n`;

// ---------------------------------------------------------------------------
// Quantities
// ---------------------------------------------------------------------------

export const cpuQuantity = (millis: number) => (millis % 1000 === 0 ? String(millis / 1000) : `${millis}m`);
export const memoryQuantity = (mib: number) => (mib % 1024 === 0 ? `${mib / 1024}Gi` : `${mib}Mi`);

const resources = (r: { cpuMillis?: number; memoryMiB?: number } | undefined) =>
  r && (r.cpuMillis !== undefined || r.memoryMiB !== undefined)
    ? {
        cpu: r.cpuMillis !== undefined ? cpuQuantity(r.cpuMillis) : undefined,
        memory: r.memoryMiB !== undefined ? memoryQuantity(r.memoryMiB) : undefined,
      }
    : undefined;

// ---------------------------------------------------------------------------
// Objects
// ---------------------------------------------------------------------------

const API_VERSION: Record<OwnerReference['kind'], string> = {
  Node: 'v1',
  Deployment: 'apps/v1',
  ReplicaSet: 'apps/v1',
  DaemonSet: 'apps/v1',
  StatefulSet: 'apps/v1',
  Job: 'batch/v1',
};

const nodeDoc = (node: Node) => ({
  apiVersion: 'v1',
  kind: 'Node',
  metadata: {
    name: node.metadata.name,
    uid: node.metadata.uid,
    creationTimestamp: node.metadata.creationTimestamp,
    labels: node.metadata.labels,
  },
  spec: {
    podCIDR: node.podCIDR,
    podCIDRs: [node.podCIDR],
    taints: node.taints.length ? node.taints.map((t) => ({ key: t.key, value: t.value, effect: t.effect })) : undefined,
  },
  status: {
    addresses: [
      { type: 'InternalIP', address: node.internalIP },
      { type: 'Hostname', address: node.metadata.name },
    ],
    capacity: {
      cpu: cpuQuantity(node.capacity.cpuMillis),
      memory: memoryQuantity(node.capacity.memoryMiB),
      pods: String(node.capacity.pods),
    },
    allocatable: {
      cpu: cpuQuantity(node.allocatable.cpuMillis),
      memory: memoryQuantity(node.allocatable.memoryMiB),
      pods: String(node.allocatable.pods),
    },
    conditions: node.conditions.map((c) => ({ type: c.type, status: c.status })),
    nodeInfo: {
      kubeletVersion: node.nodeInfo.kubeletVersion,
      containerRuntimeVersion: node.nodeInfo.containerRuntime,
      osImage: node.nodeInfo.osImage,
      kernelVersion: node.nodeInfo.kernelVersion,
      operatingSystem: 'linux',
      architecture: 'amd64',
    },
  },
});

const containerSpec = (c: Container) => ({
  name: c.name,
  image: c.image,
  command: c.command,
  ports: c.ports.length
    ? c.ports.map((p) => ({ name: p.name, containerPort: p.containerPort, protocol: p.protocol }))
    : undefined,
  resources: {
    requests: resources(c.resources.requests),
    limits: resources(c.resources.limits),
  },
  volumeMounts: c.volumeMounts?.length ? c.volumeMounts.map((m) => ({ name: m.name, mountPath: m.mountPath })) : undefined,
});

const containerState = (c: Container) => {
  const s = c.status;
  if (s.state === 'running') return { running: { startedAt: s.startedAt } };
  if (s.state === 'waiting') return { waiting: { reason: s.reason } };
  return { terminated: { reason: s.reason, exitCode: s.exitCode } };
};

const containerStatus = (c: Container) => ({
  name: c.name,
  image: c.image,
  ready: c.status.state === 'running',
  restartCount: c.restartCount,
  state: containerState(c),
});

const RESTART_POLICY: Record<Pod['origin'], RestartPolicy> = {
  static: 'Always',
  replicaset: 'Always',
  daemonset: 'Always',
  statefulset: 'Always',
  job: 'OnFailure',
  standalone: 'Always',
};

const podDoc = (cluster: Cluster, pod: Pod) => {
  const node = pod.nodeName ? findNode(cluster, pod.nodeName) : undefined;
  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: pod.metadata.name,
      namespace: pod.metadata.namespace,
      uid: pod.metadata.uid,
      creationTimestamp: pod.metadata.creationTimestamp,
      labels: Object.keys(pod.metadata.labels).length ? pod.metadata.labels : undefined,
      annotations: pod.mirrorOf
        ? { 'kubernetes.io/config.mirror': pod.metadata.uid, 'kubernetes.io/config.source': 'file' }
        : undefined,
      ownerReferences: pod.metadata.ownerReferences.length
        ? pod.metadata.ownerReferences.map((r) => ({
            apiVersion: API_VERSION[r.kind],
            kind: r.kind,
            name: r.name,
            uid: r.uid,
            controller: r.controller,
          }))
        : undefined,
    },
    spec: {
      nodeName: pod.nodeName,
      hostNetwork: pod.hostNetwork || undefined,
      serviceAccountName: pod.serviceAccountName,
      restartPolicy: pod.restartPolicy ?? RESTART_POLICY[pod.origin],
      initContainers: pod.initContainers.length ? pod.initContainers.map(containerSpec) : undefined,
      containers: pod.containers.map(containerSpec),
      volumes: pod.volumes?.length ? pod.volumes.map((v) => ({ name: v.name, [v.source]: {} })) : undefined,
    },
    status: {
      phase: pod.phase,
      conditions: pod.conditions?.length ? pod.conditions.map((c) => ({ type: c.type, status: c.status })) : undefined,
      hostIP: node?.internalIP,
      podIP: pod.podIP,
      qosClass: pod.qosClass,
      initContainerStatuses:
        pod.initContainers.length && !pod.awaitingKubelet ? pod.initContainers.map(containerStatus) : undefined,
      containerStatuses: pod.awaitingKubelet ? undefined : pod.containers.map(containerStatus),
    },
  };
};

const ownerRefs = (refs: readonly OwnerReference[]) =>
  refs.length
    ? refs.map((r) => ({ apiVersion: API_VERSION[r.kind], kind: r.kind, name: r.name, uid: r.uid, controller: r.controller }))
    : undefined;

const templateDoc = (t: PodTemplateSummary) => ({
  metadata: { labels: t.labels },
  spec: {
    containers: [
      {
        name: t.containerName,
        image: t.image,
        resources: { requests: resources(t.requests) },
      },
    ],
  },
});

const workloadMeta = (meta: ObjectMeta, annotations?: Record<string, string>) => ({
  name: meta.name,
  namespace: meta.namespace,
  uid: meta.uid,
  creationTimestamp: meta.creationTimestamp,
  labels: Object.keys(meta.labels).length ? meta.labels : undefined,
  annotations,
  ownerReferences: ownerRefs(meta.ownerReferences),
});

const revisionAnnotation = (revision: number | undefined) =>
  revision !== undefined ? { 'deployment.kubernetes.io/revision': String(revision) } : undefined;

const workloadDoc = (w: WorkloadController) => {
  const base = { apiVersion: API_VERSION[w.kind], kind: w.kind };
  switch (w.kind) {
    case 'Deployment':
      return {
        ...base,
        metadata: workloadMeta(w.metadata, revisionAnnotation(w.revision)),
        spec: {
          replicas: w.replicas,
          selector: { matchLabels: w.selector.matchLabels },
          strategy: {
            type: w.strategy,
            rollingUpdate: w.rollingUpdate ? { ...w.rollingUpdate } : undefined,
          },
          template: w.template ? templateDoc(w.template) : undefined,
        },
        status: w.status ? { ...w.status } : undefined,
      };
    case 'ReplicaSet':
      return {
        ...base,
        metadata: workloadMeta(w.metadata, revisionAnnotation(w.revision)),
        spec: {
          replicas: w.replicas,
          selector: { matchLabels: w.selector.matchLabels },
          template: w.template ? templateDoc(w.template) : undefined,
        },
        status: { replicas: w.currentReplicas, readyReplicas: w.readyReplicas, availableReplicas: w.readyReplicas },
      };
    default:
      return { ...base, metadata: workloadMeta(w.metadata), spec: { selector: { matchLabels: w.selector.matchLabels } } };
  }
};

const IMAGE_NAME: Record<ControlPlaneComponent['type'], string> = {
  'kube-apiserver': 'kube-apiserver',
  etcd: 'etcd',
  'kube-scheduler': 'kube-scheduler',
  'kube-controller-manager': 'kube-controller-manager',
  'cloud-controller-manager': 'cloud-controller-manager',
};

/** The file the kubelet reads from disk to start a control-plane static Pod. */
const staticPodFile = (cluster: Cluster, c: ControlPlaneComponent) => ({
  apiVersion: 'v1',
  kind: 'Pod',
  metadata: {
    name: c.type,
    namespace: 'kube-system',
    labels: { component: c.type, tier: 'control-plane' },
  },
  spec: {
    hostNetwork: true,
    priorityClassName: 'system-node-critical',
    containers: [
      {
        name: c.type,
        image: `registry.k8s.io/${IMAGE_NAME[c.type]}:${c.type === 'etcd' ? '3.6.4-0' : cluster.kubernetesVersion}`,
        command: [c.type],
      },
    ],
  },
});

export const buildManifest = (cluster: Cluster, target: ManifestTarget): Manifest | null => {
  switch (target.kind) {
    case 'node': {
      const node = findNode(cluster, target.name);
      return node ? { source: `Node/${node.metadata.name}`, yaml: toYaml(nodeDoc(node)) } : null;
    }
    case 'pod': {
      const pod = findPod(cluster, target.uid);
      if (!pod) return null;
      return {
        source: `Pod/${pod.metadata.namespace}/${pod.metadata.name}`,
        note: pod.mirrorOf
          ? `Mirror Pod: read-only. The kubelet runs it from ${pod.mirrorOf.manifestPath}.`
          : undefined,
        yaml: toYaml(podDoc(cluster, pod)),
      };
    }
    case 'component': {
      const c = findComponent(cluster, target.uid);
      if (!c) return null;
      const pod = c.podUid ? findPod(cluster, c.podUid) : undefined;
      if (pod) {
        return {
          source: `Pod/${pod.metadata.namespace}/${pod.metadata.name}`,
          note: `${c.type} is not an API object itself. This is the mirror Pod of the static Pod that runs it.`,
          yaml: toYaml(podDoc(cluster, pod)),
        };
      }
      if (c.runsAs !== 'static-pod') return null;
      return {
        source: `${c.nodeName}:/etc/kubernetes/manifests/${c.type}.yaml`,
        note: 'Static Pod manifest on the Node’s disk (simplified).',
        yaml: toYaml(staticPodFile(cluster, c)),
      };
    }
    case 'container': {
      const pod = findPod(cluster, target.podUid);
      const container = pod && [...pod.initContainers, ...pod.containers].find((c) => c.name === target.name);
      if (!pod || !container) return null;
      const field = container.role === 'init' ? 'initContainers' : 'containers';
      return {
        source: `Pod/${pod.metadata.namespace}/${pod.metadata.name} · spec.${field}`,
        note: 'A container is not an API object: it is declared inside its Pod’s spec.',
        yaml: toYaml([containerSpec(container)]),
      };
    }
    case 'workload': {
      const w = findWorkload(cluster, target.uid);
      if (!w) return null;
      return { source: `${w.kind}/${w.metadata.namespace ?? 'default'}/${w.metadata.name}`, yaml: toYaml(workloadDoc(w)) };
    }
  }
};
