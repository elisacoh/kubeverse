/**
 * DEMO DATA — not connected to any real cluster.
 *
 * A small kubeadm-style cluster: one control-plane Node and three worker Nodes.
 * Everything here is static and deterministic so the scene renders identically
 * on every load. A future simulation engine will start from a snapshot like this.
 */
import type {
  Cluster,
  Container,
  ControlPlaneComponent,
  Labels,
  Namespace,
  Node,
  OwnerReference,
  Pod,
  PodOrigin,
  QoSClass,
  WorkloadController,
} from './types';

const T0 = '2026-10-28T09:00:00Z';
const T1 = '2026-10-30T14:12:00Z';
const T2 = '2026-11-01T06:40:00Z';

const ns = (name: string, labels: Labels = {}): Namespace => ({
  kind: 'Namespace',
  metadata: { uid: `ns-${name}`, name, labels, creationTimestamp: T0, ownerReferences: [] },
  phase: 'Active',
});

const namespaces: Namespace[] = [
  ns('default'),
  ns('kube-system'),
  ns('shop', { team: 'storefront' }),
  ns('analytics', { team: 'data' }),
];

const node = (
  name: string,
  role: Node['role'],
  index: number,
  extra: Partial<Pick<Node, 'taints'>> = {},
): Node => ({
  kind: 'Node',
  metadata: {
    uid: `node-${name}`,
    name,
    labels: {
      'kubernetes.io/hostname': name,
      'kubernetes.io/os': 'linux',
      ...(role === 'control-plane' ? { 'node-role.kubernetes.io/control-plane': '' } : {}),
      'topology.kubernetes.io/zone': `demo-zone-${String.fromCharCode(97 + (index % 3))}`,
    },
    creationTimestamp: T0,
    ownerReferences: [],
  },
  role,
  podCIDR: `10.244.${index}.0/24`,
  internalIP: `192.168.10.${10 + index}`,
  capacity: { cpuMillis: 4000, memoryMiB: 8192, pods: 110 },
  allocatable: { cpuMillis: 3800, memoryMiB: 7680, pods: 110 },
  conditions: [
    { type: 'Ready', status: 'True' },
    { type: 'MemoryPressure', status: 'False' },
    { type: 'DiskPressure', status: 'False' },
    { type: 'PIDPressure', status: 'False' },
  ],
  taints: extra.taints ?? [],
  nodeInfo: {
    kubeletVersion: 'v1.34.1',
    containerRuntime: 'containerd://2.1.4',
    osImage: 'Ubuntu 24.04 LTS',
    kernelVersion: '6.8.0-45-generic',
  },
});

const nodes: Node[] = [
  node('cp-1', 'control-plane', 0, {
    taints: [{ key: 'node-role.kubernetes.io/control-plane', effect: 'NoSchedule' }],
  }),
  node('worker-aurora', 'worker', 1),
  node('worker-borealis', 'worker', 2),
  node('worker-cascade', 'worker', 3),
];

// ---------------------------------------------------------------------------
// Workload controllers
// ---------------------------------------------------------------------------

const ref = (w: WorkloadController): OwnerReference => ({
  kind: w.kind,
  name: w.metadata.name,
  uid: w.metadata.uid,
  controller: true,
});

const meta = (
  uid: string,
  name: string,
  namespace: string,
  labels: Labels,
  ownerReferences: OwnerReference[] = [],
  creationTimestamp = T1,
) => ({ uid, name, namespace, labels, ownerReferences, creationTimestamp });

const storefrontDeploy: WorkloadController = {
  kind: 'Deployment',
  metadata: meta('wl-storefront-deploy', 'storefront', 'shop', { app: 'storefront' }),
  selector: { matchLabels: { app: 'storefront' } },
  replicas: 3,
  strategy: 'RollingUpdate',
};
const storefrontRS: WorkloadController = {
  kind: 'ReplicaSet',
  metadata: meta(
    'wl-storefront-rs',
    'storefront-6d8f7c9b5',
    'shop',
    { app: 'storefront', 'pod-template-hash': '6d8f7c9b5' },
    [ref(storefrontDeploy)],
  ),
  selector: { matchLabels: { app: 'storefront', 'pod-template-hash': '6d8f7c9b5' } },
  replicas: 3,
  readyReplicas: 3,
};

const recommenderDeploy: WorkloadController = {
  kind: 'Deployment',
  metadata: meta('wl-recommender-deploy', 'recommender', 'shop', { app: 'recommender' }),
  selector: { matchLabels: { app: 'recommender' } },
  replicas: 1,
  strategy: 'RollingUpdate',
};
const recommenderRS: WorkloadController = {
  kind: 'ReplicaSet',
  metadata: meta(
    'wl-recommender-rs',
    'recommender-84c5d9f6f',
    'shop',
    { app: 'recommender', 'pod-template-hash': '84c5d9f6f' },
    [ref(recommenderDeploy)],
  ),
  selector: { matchLabels: { app: 'recommender', 'pod-template-hash': '84c5d9f6f' } },
  replicas: 1,
  readyReplicas: 0,
};

const corednsDeploy: WorkloadController = {
  kind: 'Deployment',
  metadata: meta('wl-coredns-deploy', 'coredns', 'kube-system', { 'k8s-app': 'kube-dns' }, [], T0),
  selector: { matchLabels: { 'k8s-app': 'kube-dns' } },
  replicas: 2,
  strategy: 'RollingUpdate',
};
const corednsRS: WorkloadController = {
  kind: 'ReplicaSet',
  metadata: meta(
    'wl-coredns-rs',
    'coredns-7db6d8ff4d',
    'kube-system',
    { 'k8s-app': 'kube-dns', 'pod-template-hash': '7db6d8ff4d' },
    [ref(corednsDeploy)],
    T0,
  ),
  selector: { matchLabels: { 'k8s-app': 'kube-dns', 'pod-template-hash': '7db6d8ff4d' } },
  replicas: 2,
  readyReplicas: 2,
};

const kubeProxyDS: WorkloadController = {
  kind: 'DaemonSet',
  metadata: meta('wl-kube-proxy-ds', 'kube-proxy', 'kube-system', { 'k8s-app': 'kube-proxy' }, [], T0),
  selector: { matchLabels: { 'k8s-app': 'kube-proxy' } },
  desiredNumberScheduled: 4,
  numberReady: 4,
};

const ordersSTS: WorkloadController = {
  kind: 'StatefulSet',
  metadata: meta('wl-orders-db-sts', 'orders-db', 'shop', { app: 'orders-db' }),
  selector: { matchLabels: { app: 'orders-db' } },
  replicas: 1,
  serviceName: 'orders-db',
};

const reportJob: WorkloadController = {
  kind: 'Job',
  metadata: meta('wl-nightly-report-job', 'nightly-report-29391840', 'analytics', {
    'job-name': 'nightly-report-29391840',
  }),
  selector: { matchLabels: { 'job-name': 'nightly-report-29391840' } },
  completions: 1,
  succeeded: 0,
};

const workloads: WorkloadController[] = [
  storefrontDeploy,
  storefrontRS,
  recommenderDeploy,
  recommenderRS,
  corednsDeploy,
  corednsRS,
  kubeProxyDS,
  ordersSTS,
  reportJob,
];

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

const running = { state: 'running' as const, startedAt: T1 };

const c = (
  name: string,
  image: string,
  opts: Partial<Omit<Container, 'name' | 'image'>> = {},
): Container => ({
  name,
  image,
  role: opts.role ?? 'app',
  ports: opts.ports ?? [],
  resources: opts.resources ?? {},
  status: opts.status ?? running,
  restartCount: opts.restartCount ?? 0,
});

// ---------------------------------------------------------------------------
// Pods
// ---------------------------------------------------------------------------

interface PodSpecInput {
  uid: string;
  name: string;
  namespace: string;
  nodeName: string;
  origin: PodOrigin;
  labels: Labels;
  owner?: WorkloadController | Node;
  containers: Container[];
  initContainers?: Container[];
  phase?: Pod['phase'];
  podIP?: string;
  qosClass?: QoSClass;
  hostNetwork?: boolean;
  serviceAccountName?: string;
  manifestPath?: string;
  createdAt?: string;
}

const pod = (p: PodSpecInput): Pod => {
  const ownerReferences: OwnerReference[] = p.owner
    ? [
        p.owner.kind === 'Node'
          ? { kind: 'Node', name: p.owner.metadata.name, uid: p.owner.metadata.uid, controller: true }
          : ref(p.owner),
      ]
    : [];
  return {
    kind: 'Pod',
    metadata: meta(p.uid, p.name, p.namespace, p.labels, ownerReferences, p.createdAt ?? T1),
    origin: p.origin,
    nodeName: p.nodeName,
    initContainers: p.initContainers ?? [],
    containers: p.containers,
    phase: p.phase ?? 'Running',
    podIP: p.podIP,
    qosClass: p.qosClass ?? 'Burstable',
    hostNetwork: p.hostNetwork ?? false,
    serviceAccountName: p.serviceAccountName ?? 'default',
    mirrorOf: p.manifestPath ? { manifestPath: p.manifestPath } : undefined,
  };
};

const cp = nodes[0]!;
const nodeIP = (n: Node) => n.internalIP;

const staticPod = (component: string, image: string, port: number): Pod =>
  pod({
    uid: `pod-${component}-cp-1`,
    name: `${component}-cp-1`,
    namespace: 'kube-system',
    nodeName: cp.metadata.name,
    origin: 'static',
    labels: { component, tier: 'control-plane' },
    owner: cp,
    containers: [
      c(component, image, {
        ports: [{ containerPort: port, protocol: 'TCP' }],
        resources: { requests: { cpuMillis: component === 'kube-apiserver' ? 250 : 100 } },
      }),
    ],
    podIP: nodeIP(cp),
    hostNetwork: true,
    manifestPath: `/etc/kubernetes/manifests/${component}.yaml`,
    createdAt: T0,
  });

const staticPods: Pod[] = [
  staticPod('kube-apiserver', 'registry.k8s.io/kube-apiserver:v1.34.1', 6443),
  staticPod('etcd', 'registry.k8s.io/etcd:3.6.4-0', 2379),
  staticPod('kube-scheduler', 'registry.k8s.io/kube-scheduler:v1.34.1', 10259),
  staticPod('kube-controller-manager', 'registry.k8s.io/kube-controller-manager:v1.34.1', 10257),
];

const kubeProxySuffix = ['h7x2q', 'm4n8c', 'z9t5w', 'p2r6k'];
const kubeProxyPods: Pod[] = nodes.map((n, i) =>
  pod({
    uid: `pod-kube-proxy-${n.metadata.name}`,
    name: `kube-proxy-${kubeProxySuffix[i]}`,
    namespace: 'kube-system',
    nodeName: n.metadata.name,
    origin: 'daemonset',
    labels: { 'k8s-app': 'kube-proxy', 'controller-revision-hash': '5c6b8d7f9' },
    owner: kubeProxyDS,
    containers: [c('kube-proxy', 'registry.k8s.io/kube-proxy:v1.34.1')],
    podIP: nodeIP(n),
    hostNetwork: true,
    serviceAccountName: 'kube-proxy',
    qosClass: 'BestEffort',
    createdAt: T0,
  }),
);

const [, aurora, borealis, cascade] = nodes as [Node, Node, Node, Node];

const storefrontPod = (suffix: string, n: Node, ip: string): Pod =>
  pod({
    uid: `pod-storefront-${suffix}`,
    name: `storefront-6d8f7c9b5-${suffix}`,
    namespace: 'shop',
    nodeName: n.metadata.name,
    origin: 'replicaset',
    labels: { app: 'storefront', 'pod-template-hash': '6d8f7c9b5' },
    owner: storefrontRS,
    initContainers: [
      c('fetch-assets', 'busybox:1.37', {
        role: 'init',
        status: { state: 'terminated', reason: 'Completed', exitCode: 0 },
      }),
    ],
    containers: [
      c('web', 'nginx:1.27-alpine', {
        ports: [{ name: 'http', containerPort: 8080, protocol: 'TCP' }],
        resources: {
          requests: { cpuMillis: 100, memoryMiB: 128 },
          limits: { cpuMillis: 500, memoryMiB: 256 },
        },
      }),
      c('log-shipper', 'fluent/fluent-bit:3.2', {
        role: 'sidecar',
        ports: [{ name: 'metrics', containerPort: 2020, protocol: 'TCP' }],
        resources: { requests: { cpuMillis: 20, memoryMiB: 32 }, limits: { memoryMiB: 64 } },
      }),
    ],
    podIP: ip,
    serviceAccountName: 'storefront',
  });

const corednsPod = (suffix: string, n: Node, ip: string): Pod =>
  pod({
    uid: `pod-coredns-${suffix}`,
    name: `coredns-7db6d8ff4d-${suffix}`,
    namespace: 'kube-system',
    nodeName: n.metadata.name,
    origin: 'replicaset',
    labels: { 'k8s-app': 'kube-dns', 'pod-template-hash': '7db6d8ff4d' },
    owner: corednsRS,
    containers: [
      c('coredns', 'registry.k8s.io/coredns/coredns:v1.12.0', {
        ports: [
          { name: 'dns', containerPort: 53, protocol: 'UDP' },
          { name: 'dns-tcp', containerPort: 53, protocol: 'TCP' },
          { name: 'metrics', containerPort: 9153, protocol: 'TCP' },
        ],
        resources: { requests: { cpuMillis: 100, memoryMiB: 70 }, limits: { memoryMiB: 170 } },
      }),
    ],
    podIP: ip,
    serviceAccountName: 'coredns',
    createdAt: T0,
  });

const appPods: Pod[] = [
  storefrontPod('x2k4p', aurora, '10.244.1.12'),
  storefrontPod('q8v3n', borealis, '10.244.2.17'),
  storefrontPod('f5j7d', cascade, '10.244.3.9'),
  corednsPod('lw9fz', aurora, '10.244.1.3'),
  corednsPod('b6tqm', borealis, '10.244.2.4'),
  pod({
    uid: 'pod-orders-db-0',
    name: 'orders-db-0',
    namespace: 'shop',
    nodeName: borealis.metadata.name,
    origin: 'statefulset',
    labels: { app: 'orders-db', 'statefulset.kubernetes.io/pod-name': 'orders-db-0' },
    owner: ordersSTS,
    containers: [
      c('postgres', 'postgres:17-alpine', {
        ports: [{ name: 'pg', containerPort: 5432, protocol: 'TCP' }],
        resources: {
          requests: { cpuMillis: 500, memoryMiB: 1024 },
          limits: { cpuMillis: 500, memoryMiB: 1024 },
        },
      }),
      c('pg-exporter', 'quay.io/prometheuscommunity/postgres-exporter:v0.16.0', {
        role: 'sidecar',
        ports: [{ name: 'metrics', containerPort: 9187, protocol: 'TCP' }],
        resources: {
          requests: { cpuMillis: 50, memoryMiB: 64 },
          limits: { cpuMillis: 50, memoryMiB: 64 },
        },
      }),
    ],
    podIP: '10.244.2.21',
    qosClass: 'Guaranteed',
    serviceAccountName: 'orders-db',
  }),
  pod({
    uid: 'pod-recommender-r7c2k',
    name: 'recommender-84c5d9f6f-r7c2k',
    namespace: 'shop',
    nodeName: cascade.metadata.name,
    origin: 'replicaset',
    labels: { app: 'recommender', 'pod-template-hash': '84c5d9f6f' },
    owner: recommenderRS,
    containers: [
      c('recommender', 'demo.kubeverse.dev/recommender:0.4.2', {
        ports: [{ name: 'grpc', containerPort: 9000, protocol: 'TCP' }],
        resources: { requests: { cpuMillis: 200, memoryMiB: 256 }, limits: { memoryMiB: 256 } },
        status: { state: 'waiting', reason: 'CrashLoopBackOff' },
        restartCount: 7,
      }),
    ],
    podIP: '10.244.3.14',
    serviceAccountName: 'recommender',
    createdAt: T2,
  }),
  pod({
    uid: 'pod-nightly-report-29391840-k3m8s',
    name: 'nightly-report-29391840-k3m8s',
    namespace: 'analytics',
    nodeName: cascade.metadata.name,
    origin: 'job',
    labels: { 'job-name': 'nightly-report-29391840' },
    owner: reportJob,
    containers: [
      c('report', 'demo.kubeverse.dev/report-builder:1.8', {
        resources: { requests: { cpuMillis: 300, memoryMiB: 512 } },
      }),
    ],
    podIP: '10.244.3.22',
    createdAt: T2,
  }),
  pod({
    uid: 'pod-debug-shell',
    name: 'debug-shell',
    namespace: 'default',
    nodeName: aurora.metadata.name,
    origin: 'standalone',
    labels: { purpose: 'debugging' },
    containers: [c('shell', 'nicolaka/netshoot:v0.13')],
    podIP: '10.244.1.30',
    qosClass: 'BestEffort',
    createdAt: T2,
  }),
];

const component = (
  type: ControlPlaneComponent['type'],
  summary: string,
): ControlPlaneComponent => ({
  kind: 'ControlPlaneComponent',
  uid: `cpc-${type}`,
  type,
  summary,
  nodeName: cp.metadata.name,
  runsAs: 'static-pod',
  podUid: `pod-${type}-cp-1`,
  healthy: true,
});

const controlPlane: ControlPlaneComponent[] = [
  component(
    'kube-apiserver',
    'The front door of the cluster. Every component — and every kubectl command — talks to the API server, which validates requests and persists state in etcd.',
  ),
  component(
    'etcd',
    'A consistent, distributed key-value store holding the entire cluster state. Only the API server talks to it directly.',
  ),
  component(
    'kube-scheduler',
    'Watches for Pods without a Node and picks the best Node for each, based on resources, constraints and affinity.',
  ),
  component(
    'kube-controller-manager',
    'Runs reconciliation loops (Deployment, ReplicaSet, Node, Job controllers…) that drive actual state toward desired state.',
  ),
];

export const demoCluster: Cluster = {
  uid: 'cluster-demo',
  name: 'demo-cluster',
  kubernetesVersion: 'v1.34.1',
  source: 'demo',
  namespaces,
  nodes,
  pods: [...staticPods, ...kubeProxyPods, ...appPods],
  workloads,
  controlPlane,
};
