/**
 * The learner-built cluster used by Learn mode. Separate from the Explore demo
 * data: it starts from a lesson's initial world and changes only through the
 * learner's actions.
 *
 * Creating a cluster, a Node or a Pod with one click is an educational
 * abstraction, not a simulation of kubeadm, the API server or the scheduler.
 */
import type {
  Cluster,
  Container,
  ContainerState,
  ControlPlaneComponent,
  Namespace,
  Node,
  Pod,
  PodPhase,
  PodStatusCondition,
} from '../domain/types';
import { fitsOnNode, freeCapacity, findPod, podRequests } from '../domain/selectors';
import {
  MAX_REPLICAS,
  WEB_IMAGES,
  createDeployment,
  deleteManagedPod,
  deleteStandalone,
  initialControllers,
  isSettled,
  scaleDeployment,
  syncControllers,
  updateImage,
  type ControllersState,
  type NodeRoom,
  type WebImage,
} from '../simulation/controllers';
import { buildControllerObjects, managedPodUid, replicaSetUid } from './controllerObjects';
import type { BuildActionKind, LearnerAction } from './types';

/** Prepared Pods a lesson can bring into the world. */
export type SandboxPodName = 'hello-web' | 'web-and-logger' | 'report-once' | 'broken-once' | 'data-cruncher';
export type LabPodName = 'report-once' | 'broken-once';
export type LabPhase = Extract<PodPhase, 'Pending' | 'Running' | 'Succeeded' | 'Failed'>;

/**
 * How far the learner's Pod request has travelled (Lesson 3), one step per
 * component acting on it:
 * - submitted: kubectl sent it; it waits at the API server.
 * - rejected: the API server refused it; nothing was stored.
 * - persisted: accepted and stored in etcd; no Node yet.
 * - bound: the scheduler picked a Node and recorded the binding.
 * - preparing: that Node's kubelet asked the runtime to create the container.
 * - running: the container started and the kubelet reported it.
 */
export type RequestStage = 'submitted' | 'rejected' | 'persisted' | 'bound' | 'preparing' | 'running';

export const REQUEST_IMAGES = ['nginx:1.27', 'httpd:2.4'] as const;
export type RequestImage = (typeof REQUEST_IMAGES)[number];

export interface PodRequest {
  name: string;
  image: RequestImage;
  stage: RequestStage;
  /** Set once the scheduler has bound the Pod. */
  nodeName?: string;
}

export interface SandboxWorld {
  initialized: boolean;
  /** Worker Node names, in the order they joined. */
  workers: readonly string[];
  /** The learner has opened the application container (Lesson 2). */
  containerOpened: boolean;
  /** Prepared Pods that exist, in creation order. */
  pods: readonly SandboxPodName[];
  /** Phase of each lifecycle-lab Pod that has been created. */
  lab: Readonly<Partial<Record<LabPodName, LabPhase>>>;
  /** The Pod the learner submits through the API (Lesson 3). */
  request: PodRequest | null;
  /** Lesson 4: what the controllers manage, and the standalone Pod they do not. */
  controllers: ControllersState | null;
}

export const EMPTY_WORLD: SandboxWorld = {
  initialized: false,
  workers: [],
  containerOpened: false,
  pods: [],
  lab: {},
  request: null,
  controllers: null,
};

export const SANDBOX_CONTROL_PLANE = 'control-plane-1';

/** The cluster as Lesson 1 leaves it: a control plane and two worker Nodes. */
export const FIRST_CLUSTER_WORLD: SandboxWorld = { ...EMPTY_WORLD, initialized: true, workers: ['worker-1', 'worker-2'] };

/**
 * Lesson 3's starting point: Lesson 2's first Pod is still running, and a
 * data-cruncher Pod now reserves most of worker-2's CPU.
 */
export const BUSY_CLUSTER_WORLD: SandboxWorld = {
  ...FIRST_CLUSTER_WORLD,
  containerOpened: true,
  pods: ['hello-web', 'data-cruncher'],
};

export const REQUEST_POD_UID = 'sandbox-pod-request';
export const DEFAULT_REQUEST = { name: 'my-pod', image: 'nginx:1.27' as RequestImage };

/** Lesson 4's starting point: Lesson 3's cluster, with the learner's standalone Pod running on worker-1. */
export const MAINTAINED_CLUSTER_WORLD: SandboxWorld = {
  ...BUSY_CLUSTER_WORLD,
  request: { ...DEFAULT_REQUEST, stage: 'running', nodeName: 'worker-1' },
  controllers: initialControllers({ name: DEFAULT_REQUEST.name, nodeName: 'worker-1' }),
};

export const DEPLOYMENT_DEFAULTS = { name: 'web', replicas: 3, image: WEB_IMAGES[0] as WebImage };
/** What the learner's Pod asks the scheduler to reserve. */
export const REQUEST_RESOURCES = { cpuMillis: 1000, memoryMiB: 512 };

const RFC1123_SUBDOMAIN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;

/** The API server's validation error for a Pod name, or null when the name is valid. */
export const podNameError = (name: string): string | null => {
  if (name.length === 0) return 'metadata.name: Required value: name or generateName is required';
  if (name.length > 253) return `metadata.name: Invalid value: "${name}": must be no more than 253 characters`;
  if (!RFC1123_SUBDOMAIN.test(name)) {
    return `metadata.name: Invalid value: "${name}": a lowercase RFC 1123 subdomain must consist of lower case alphanumeric characters, '-' or '.', and must start and end with an alphanumeric character`;
  }
  return null;
};

export const nextWorkerName = (world: SandboxWorld) => `worker-${world.workers.length + 1}`;

export const sandboxPodUid = (name: SandboxPodName) => `sandbox-pod-${name}`;

export const FIRST_APP_IMAGE = 'kubeverse/hello-web:1.0';

const T0 = '2026-11-01T00:00:00Z';
const T_POD = '2026-11-01T00:10:00Z';
const T_REQUEST = '2026-11-01T00:20:00Z';

/** Machines differ in size, but each one has a fixed amount of CPU and memory. */
const MACHINE_SIZES = [
  { cpuMillis: 4000, memoryMiB: 8192 },
  { cpuMillis: 8000, memoryMiB: 16384 },
  { cpuMillis: 4000, memoryMiB: 16384 },
];

const node = (name: string, role: Node['role'], index: number): Node => {
  const size = role === 'control-plane' ? { cpuMillis: 4000, memoryMiB: 8192 } : MACHINE_SIZES[(index - 1) % MACHINE_SIZES.length]!;
  return {
    kind: 'Node',
    metadata: {
      uid: `sandbox-node-${name}`,
      name,
      labels: {
        'kubernetes.io/hostname': name,
        'kubernetes.io/os': 'linux',
        ...(role === 'control-plane' ? { 'node-role.kubernetes.io/control-plane': '' } : {}),
      },
      creationTimestamp: T0,
      ownerReferences: [],
    },
    role,
    podCIDR: `10.244.${index}.0/24`,
    internalIP: `192.168.20.${10 + index}`,
    capacity: { ...size, pods: 110 },
    allocatable: { cpuMillis: size.cpuMillis - 200, memoryMiB: size.memoryMiB - 512, pods: 110 },
    conditions: [{ type: 'Ready', status: 'True' }],
    taints:
      role === 'control-plane' ? [{ key: 'node-role.kubernetes.io/control-plane', effect: 'NoSchedule' }] : [],
    nodeInfo: {
      kubeletVersion: 'v1.34.1',
      containerRuntime: 'containerd://2.1.4',
      osImage: 'Ubuntu 24.04 LTS',
      kernelVersion: '6.8.0-45-generic',
    },
  };
};

const COMPONENTS: readonly ControlPlaneComponent['type'][] = [
  'kube-apiserver',
  'etcd',
  'kube-scheduler',
  'kube-controller-manager',
];

const ns = (name: string): Namespace => ({
  kind: 'Namespace',
  metadata: { uid: `sandbox-ns-${name}`, name, labels: {}, creationTimestamp: T0, ownerReferences: [] },
  phase: 'Active',
});

// ---------------------------------------------------------------------------
// Prepared Pods
// ---------------------------------------------------------------------------

const RUNNING: ContainerState = { state: 'running', startedAt: T_POD };

const container = (
  c: Omit<Container, 'resources' | 'restartCount' | 'status'> & { status?: ContainerState; resources?: Container['resources'] },
): Container => ({
  resources: {},
  restartCount: 0,
  status: RUNNING,
  ...c,
});

/**
 * Where the learner's first Pod lands: the worker with the most free CPU.
 * A stand-in for the scheduler, which Lesson 3 explains.
 */
const firstPodNode = (nodes: readonly Node[]): Node | undefined =>
  nodes
    .filter((n) => n.role === 'worker')
    .reduce<Node | undefined>((best, n) => (!best || n.allocatable.cpuMillis > best.allocatable.cpuMillis ? n : best), undefined);

const podIP = (n: Node, host: number) => n.podCIDR.replace(/\.0\/\d+$/, `.${host}`);

/** The single container's state behind each phase of a one-container lab Pod. */
const LAB_STATUS: Record<LabPhase, ContainerState> = {
  Pending: { state: 'waiting', reason: 'ContainerCreating' },
  Running: RUNNING,
  Succeeded: { state: 'terminated', reason: 'Completed', exitCode: 0 },
  Failed: { state: 'terminated', reason: 'Error', exitCode: 1 },
};

const LAB_COMMAND: Record<LabPodName, string[]> = {
  'report-once': ['sh', '-c', 'echo "report ready"; exit 0'],
  'broken-once': ['sh', '-c', 'echo "config file missing" >&2; exit 1'],
};

const buildPod = (name: SandboxPodName, world: SandboxWorld, nodes: readonly Node[]): Pod | null => {
  const home = firstPodNode(nodes);
  const other = nodes.find((n) => n.role === 'worker' && n !== home) ?? home;
  const base = {
    kind: 'Pod' as const,
    origin: 'standalone' as const,
    initContainers: [],
    qosClass: 'BestEffort' as const,
    hostNetwork: false,
    serviceAccountName: 'default',
  };
  const meta = (labels: Record<string, string>) => ({
    uid: sandboxPodUid(name),
    name,
    namespace: 'default',
    labels,
    creationTimestamp: T_POD,
    ownerReferences: [],
  });

  switch (name) {
    case 'hello-web':
      if (!home) return null;
      return {
        ...base,
        metadata: meta({ app: 'hello-web' }),
        nodeName: home.metadata.name,
        phase: 'Running',
        podIP: podIP(home, 5),
        containers: [
          container({
            name: 'hello-web',
            image: FIRST_APP_IMAGE,
            role: 'app',
            command: ['node', 'server.js'],
            ports: [{ name: 'http', containerPort: 8080, protocol: 'TCP' }],
          }),
        ],
      };
    case 'web-and-logger':
      if (!other) return null;
      return {
        ...base,
        metadata: meta({ app: 'web' }),
        nodeName: other.metadata.name,
        phase: 'Running',
        podIP: podIP(other, 7),
        volumes: [{ name: 'logs', source: 'emptyDir' }],
        containers: [
          container({
            name: 'web',
            image: 'nginx:1.27',
            role: 'app',
            command: ['nginx', '-g', 'daemon off;'],
            ports: [{ name: 'http', containerPort: 80, protocol: 'TCP' }],
            volumeMounts: [{ name: 'logs', mountPath: '/var/log/nginx' }],
          }),
          container({
            name: 'log-shipper',
            image: 'busybox:1.36',
            role: 'sidecar',
            command: ['sh', '-c', 'tail -F /logs/access.log'],
            ports: [],
            volumeMounts: [{ name: 'logs', mountPath: '/logs' }],
          }),
        ],
      };
    case 'data-cruncher':
      if (!home) return null;
      return {
        ...base,
        qosClass: 'Burstable',
        metadata: meta({ app: 'data-cruncher' }),
        nodeName: home.metadata.name,
        phase: 'Running',
        podIP: podIP(home, 8),
        containers: [
          container({
            name: 'cruncher',
            image: 'kubeverse/cruncher:2.3',
            role: 'app',
            command: ['cruncher', '--workers=7'],
            ports: [],
            resources: { requests: { cpuMillis: 7000, memoryMiB: 4096 } },
          }),
        ],
      };
    case 'report-once':
    case 'broken-once': {
      const phase = world.lab[name];
      const host = name === 'report-once' ? other : home;
      if (!phase || !host) return null;
      return {
        ...base,
        metadata: meta({ app: 'lifecycle-lab' }),
        nodeName: host.metadata.name,
        phase,
        podIP: phase === 'Pending' ? undefined : podIP(host, name === 'report-once' ? 9 : 11),
        restartPolicy: 'Never',
        containers: [
          container({
            name: name === 'report-once' ? 'report' : 'task',
            image: 'busybox:1.36',
            role: 'app',
            command: LAB_COMMAND[name],
            ports: [],
            status: LAB_STATUS[phase],
          }),
        ],
      };
    }
  }
};

const condition = (type: PodStatusCondition['type'], ok: boolean): PodStatusCondition => ({
  type,
  status: ok ? 'True' : 'False',
});

/**
 * The learner's Pod as the API stores it at each stage. Nothing exists before
 * the API server accepts the request.
 */
const buildRequestedPod = (req: PodRequest, nodes: readonly Node[], standalone?: ControllersState['standalone']): Pod | null => {
  if (req.stage === 'submitted' || req.stage === 'rejected') return null;
  if (standalone?.stage === 'gone') return null;
  const host = req.nodeName ? nodes.find((n) => n.metadata.name === req.nodeName) : undefined;
  const running = req.stage === 'running';
  const preparing = req.stage === 'preparing';
  return {
    kind: 'Pod',
    origin: 'standalone',
    metadata: {
      uid: REQUEST_POD_UID,
      name: req.name,
      namespace: 'default',
      labels: {},
      creationTimestamp: T_REQUEST,
      ownerReferences: [],
    },
    nodeName: host?.metadata.name,
    terminating: standalone?.stage === 'terminating' || undefined,
    phase: running ? 'Running' : 'Pending',
    podIP: running && host ? podIP(host, 13) : undefined,
    qosClass: 'Burstable',
    hostNetwork: false,
    serviceAccountName: 'default',
    initContainers: [],
    awaitingKubelet: !running && !preparing,
    conditions: host
      ? [
          condition('PodScheduled', true),
          ...(running || preparing
            ? [condition('Initialized', true), condition('ContainersReady', running), condition('Ready', running)]
            : []),
        ]
      : [],
    containers: [
      container({
        name: 'web',
        image: req.image,
        role: 'app',
        ports: [],
        resources: { requests: { ...REQUEST_RESOURCES } },
        status: running ? { state: 'running', startedAt: T_REQUEST } : { state: 'waiting', reason: 'ContainerCreating' },
      }),
    ],
  };
};

const buildNodes = (world: SandboxWorld): Node[] =>
  world.initialized
    ? [node(SANDBOX_CONTROL_PLANE, 'control-plane', 0), ...world.workers.map((w, i) => node(w, 'worker', i + 1))]
    : [];

/** Pods no controller manages: the prepared ones and the learner's own. */
const unmanagedPods = (world: SandboxWorld, nodes: readonly Node[]): Pod[] => {
  const pods = world.pods.map((p) => buildPod(p, world, nodes)).filter((p): p is Pod => p !== null);
  const requested = world.request && buildRequestedPod(world.request, nodes, world.controllers?.standalone);
  if (requested) pods.push(requested);
  return pods;
};

/** What each worker has left for the controllers' Pods, once every other Pod is counted. */
export const controllerRooms = (world: SandboxWorld): NodeRoom[] => {
  const nodes = buildNodes(world);
  const pods = unmanagedPods(world, nodes);
  return nodes
    .filter((n) => n.role === 'worker')
    .map((n) => ({
      name: n.metadata.name,
      freeCpuMillis:
        n.allocatable.cpuMillis -
        pods.filter((p) => p.nodeName === n.metadata.name).reduce((sum, p) => sum + podRequests(p).cpuMillis, 0),
    }));
};

/** Builds the domain view of the learner's cluster. Deterministic. */
export const buildSandboxCluster = (world: SandboxWorld): Cluster => {
  const nodes = buildNodes(world);
  const controlPlane: ControlPlaneComponent[] = world.initialized
    ? COMPONENTS.map((type) => ({
        kind: 'ControlPlaneComponent',
        uid: `sandbox-cpc-${type}`,
        type,
        summary: '',
        nodeName: SANDBOX_CONTROL_PLANE,
        runsAs: 'static-pod',
        healthy: true,
      }))
    : [];
  const managed = world.controllers ? buildControllerObjects(world.controllers, nodes) : { workloads: [], pods: [] };
  const pods = [...unmanagedPods(world, nodes), ...managed.pods];
  return {
    uid: 'sandbox-cluster',
    name: 'my-first-cluster',
    kubernetesVersion: 'v1.34.1',
    source: 'demo',
    namespaces: world.initialized ? [ns('default'), ns('kube-system')] : [],
    nodes,
    pods,
    workloads: managed.workloads,
    controlPlane,
  };
};

// ---------------------------------------------------------------------------
// World-building actions
// ---------------------------------------------------------------------------

const LAB_ACTION: Record<LabPodName, { kind: BuildActionKind; outcome: LabPhase }> = {
  'report-once': { kind: 'advance-lab-success', outcome: 'Succeeded' },
  'broken-once': { kind: 'advance-lab-failure', outcome: 'Failed' },
};

/** The phase a lab Pod moves to next, or null once it has finished. */
export const nextLabPhase = (world: SandboxWorld, pod: LabPodName): LabPhase | null => {
  const phase = world.lab[pod];
  if (!phase) return 'Pending';
  if (phase === 'Pending') return 'Running';
  if (phase === 'Running') return LAB_ACTION[pod].outcome;
  return null;
};

const labPodOf = (podUid: string): LabPodName | undefined =>
  (Object.keys(LAB_ACTION) as LabPodName[]).find((p) => sandboxPodUid(p) === podUid);

/** The lab button that advances this Pod, if it is a lifecycle-lab Pod. */
export const labActionFor = (podUid: string): BuildActionKind | undefined => {
  const pod = labPodOf(podUid);
  return pod ? LAB_ACTION[pod].kind : undefined;
};

interface WorldActionSpec {
  /** Whether the world allows the action right now, independent of lesson rules. */
  available: (w: SandboxWorld) => boolean;
  /** Times already performed, for lesson limits. */
  performed: (w: SandboxWorld) => number;
  /** The action performing this intent produces (the default one, for intents that take learner input). */
  action: (w: SandboxWorld) => LearnerAction;
  label: (w: SandboxWorld) => string;
  /** For intents carrying learner input: whether this particular action is acceptable. Others must equal `action`. */
  accepts?: (w: SandboxWorld, action: LearnerAction) => boolean;
}

/**
 * The simplified scheduler: among worker Nodes whose free capacity covers the
 * Pod's requests (filtering), the one with the most free CPU (scoring).
 */
export const schedulerChoice = (cluster: Cluster, podUid: string): string | undefined => {
  const pod = findPod(cluster, podUid);
  if (!pod) return undefined;
  return cluster.nodes
    .filter((n) => fitsOnNode(cluster, pod, n.metadata.name))
    .map((n) => ({ name: n.metadata.name, cpu: freeCapacity(cluster, n.metadata.name).cpuMillis }))
    .sort((a, b) => b.cpu - a.cpu || a.name.localeCompare(b.name))[0]?.name;
};

const stageIs = (w: SandboxWorld, stage: RequestStage) => w.request?.stage === stage;
/** Whether a Pod with this name already exists (kubectl apply would then modify it instead of creating one). */
export const isNameTaken = (w: SandboxWorld, name: string) =>
  buildSandboxCluster(w).pods.some((p) => p.metadata.name === name);

const requestAction = (
  w: SandboxWorld,
  type: 'POD_BOUND_TO_NODE' | 'POD_SYNC_STARTED' | 'CONTAINER_STARTED',
): LearnerAction => ({ type, podId: REQUEST_POD_UID, nodeId: w.request?.nodeName ?? '' });

const hasWorkers = (w: SandboxWorld) => w.initialized && w.workers.length > 0;

const labSpec = (pod: LabPodName): WorldActionSpec => ({
  available: (w) => hasWorkers(w) && nextLabPhase(w, pod) !== null,
  performed: (w) => (w.lab[pod] ? 1 : 0),
  action: (w) => ({ type: 'POD_LIFECYCLE_OBSERVED', podId: sandboxPodUid(pod), phase: nextLabPhase(w, pod) ?? 'Unknown' }),
  label: (w) => {
    const next = nextLabPhase(w, pod);
    if (next === 'Pending') return `Create Pod ${pod}`;
    if (next === 'Running') return 'Start its container';
    return 'Let its program run to the end';
  },
});

const RFC1123_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
/** Leaves room for the generated ReplicaSet and Pod suffixes within the 63-character label limit. */
const MAX_DEPLOYMENT_NAME = 40;

/** Why a Deployment name would be refused, or null when it is valid. */
export const deploymentNameError = (name: string): string | null => {
  if (name.length === 0) return 'metadata.name: Required value';
  if (name.length > MAX_DEPLOYMENT_NAME) return `metadata.name: keep it under ${MAX_DEPLOYMENT_NAME} characters (Pod names add suffixes)`;
  if (!RFC1123_LABEL.test(name)) {
    return 'metadata.name: lower case letters, digits and "-" only, starting and ending with a letter or digit';
  }
  return null;
};

const deployment = (w: SandboxWorld) => w.controllers?.deployment ?? null;

/** Pods the learner may delete with kubectl: the ReplicaSets' Pods that are not already going. */
export const deletableManagedPods = (w: SandboxWorld) =>
  (w.controllers?.pods ?? []).filter((p) => p.stage !== 'terminating');

const kubectlCount = (w: SandboxWorld, reason: string, kind: 'Pod' | 'Deployment') =>
  (w.controllers?.events ?? []).filter((e) => e.source === 'kubectl' && e.reason === reason && e.object.kind === kind).length;

const managedPodAction = (w: SandboxWorld): LearnerAction => {
  const pod = deletableManagedPods(w).find((p) => p.stage === 'running') ?? deletableManagedPods(w)[0];
  return {
    type: 'REPLICASET_POD_DELETED',
    podId: pod ? managedPodUid(pod.serial) : '',
    replicaSetId: pod ? replicaSetUid(pod.replicaSet) : '',
  };
};

export const WORLD_ACTIONS: Record<BuildActionKind, WorldActionSpec> = {
  'initialize-cluster': {
    available: (w) => !w.initialized,
    performed: (w) => (w.initialized ? 1 : 0),
    action: () => ({ type: 'CLUSTER_INITIALIZED', controlPlaneNodeId: SANDBOX_CONTROL_PLANE }),
    label: () => 'Initialize cluster',
  },
  'add-worker-node': {
    available: (w) => w.initialized,
    performed: (w) => w.workers.length,
    action: (w) => ({ type: 'NODE_ADDED', nodeId: nextWorkerName(w), role: 'worker' }),
    label: () => 'Add worker Node',
  },
  'open-container': {
    available: (w) => hasWorkers(w) && !w.containerOpened,
    performed: (w) => (w.containerOpened ? 1 : 0),
    action: () => ({ type: 'CONTAINER_OPENED', image: FIRST_APP_IMAGE }),
    label: () => 'Open the container',
  },
  'create-pod': {
    available: (w) => hasWorkers(w) && w.containerOpened && !w.pods.includes('hello-web'),
    performed: (w) => (w.pods.includes('hello-web') ? 1 : 0),
    action: (w) => ({
      type: 'POD_CREATED',
      podId: sandboxPodUid('hello-web'),
      nodeId: firstPodNode(buildSandboxCluster(w).nodes)?.metadata.name ?? '',
    }),
    label: () => 'Wrap it in a Pod',
  },
  'open-multi-container-example': {
    available: (w) => hasWorkers(w) && !w.pods.includes('web-and-logger'),
    performed: (w) => (w.pods.includes('web-and-logger') ? 1 : 0),
    action: () => ({ type: 'MULTI_CONTAINER_EXAMPLE_OPENED', podId: sandboxPodUid('web-and-logger') }),
    label: () => 'Open example: web server + log helper',
  },
  'advance-lab-success': labSpec('report-once'),
  'advance-lab-failure': labSpec('broken-once'),
  'submit-pod-request': {
    available: (w) => hasWorkers(w) && (w.request === null || w.request.stage === 'rejected'),
    performed: (w) => (w.request && w.request.stage !== 'rejected' ? 1 : 0),
    action: () => ({ type: 'POD_REQUEST_SUBMITTED', podName: DEFAULT_REQUEST.name, image: DEFAULT_REQUEST.image }),
    label: () => 'kubectl apply -f my-pod.yaml',
    accepts: (w, a) =>
      a.type === 'POD_REQUEST_SUBMITTED' &&
      (REQUEST_IMAGES as readonly string[]).includes(a.image) &&
      a.podName.length <= 253 &&
      !isNameTaken(w, a.podName),
  },
  'process-request': {
    available: (w) => stageIs(w, 'submitted'),
    performed: (w) => (w.request && w.request.stage !== 'submitted' ? 1 : 0),
    action: (w) => ({
      type: 'REQUEST_PROCESSED',
      podName: w.request?.name ?? '',
      outcome: w.request && podNameError(w.request.name) === null ? 'accepted' : 'rejected',
    }),
    label: () => 'Process the request',
  },
  'schedule-pod': {
    available: (w) => stageIs(w, 'persisted') && schedulerChoice(buildSandboxCluster(w), REQUEST_POD_UID) !== undefined,
    performed: (w) => (w.request?.nodeName ? 1 : 0),
    action: (w) => ({
      type: 'POD_BOUND_TO_NODE',
      podId: REQUEST_POD_UID,
      nodeId: schedulerChoice(buildSandboxCluster(w), REQUEST_POD_UID) ?? '',
    }),
    label: () => 'Let the scheduler decide',
  },
  'kubelet-prepare-pod': {
    available: (w) => stageIs(w, 'bound'),
    performed: (w) => (stageIs(w, 'preparing') || stageIs(w, 'running') ? 1 : 0),
    action: (w) => requestAction(w, 'POD_SYNC_STARTED'),
    label: (w) => `Kubelet on ${w.request?.nodeName ?? 'its Node'}: prepare the Pod`,
  },
  'start-container': {
    available: (w) => stageIs(w, 'preparing'),
    performed: (w) => (stageIs(w, 'running') ? 1 : 0),
    action: (w) => requestAction(w, 'CONTAINER_STARTED'),
    label: () => 'Start the container',
  },
  'delete-standalone-pod': {
    available: (w) => w.controllers?.standalone.stage === 'present',
    performed: (w) => (w.controllers && w.controllers.standalone.stage !== 'present' ? 1 : 0),
    action: () => ({ type: 'STANDALONE_POD_DELETED', podId: REQUEST_POD_UID }),
    label: (w) => `kubectl delete pod ${w.controllers?.standalone.name ?? DEFAULT_REQUEST.name}`,
  },
  'create-deployment': {
    available: (w) => !!w.controllers && !w.controllers.deployment,
    performed: (w) => (deployment(w) ? 1 : 0),
    action: () => ({ type: 'DEPLOYMENT_CREATED', ...DEPLOYMENT_DEFAULTS }),
    label: () => `kubectl apply -f ${DEPLOYMENT_DEFAULTS.name}-deployment.yaml`,
    accepts: (_, a) =>
      a.type === 'DEPLOYMENT_CREATED' &&
      deploymentNameError(a.name) === null &&
      a.replicas === DEPLOYMENT_DEFAULTS.replicas &&
      a.image === DEPLOYMENT_DEFAULTS.image,
  },
  'run-controllers': {
    available: (w) => !!w.controllers && !isSettled(w.controllers, controllerRooms(w)),
    performed: (w) => w.controllers?.pass ?? 0,
    action: (w) => ({ type: 'CONTROLLERS_SYNCED', pass: (w.controllers?.pass ?? 0) + 1 }),
    label: () => 'Run the control loops once',
  },
  'delete-replicaset-pod': {
    available: (w) => deletableManagedPods(w).length > 0,
    performed: (w) => kubectlCount(w, 'Delete', 'Pod') - (w.controllers && w.controllers.standalone.stage !== 'present' ? 1 : 0),
    action: managedPodAction,
    label: (w) => {
      const a = managedPodAction(w);
      const pod = a.type === 'REPLICASET_POD_DELETED' && deletableManagedPods(w).find((p) => managedPodUid(p.serial) === a.podId);
      return `kubectl delete pod ${pod ? pod.name : ''}`;
    },
    accepts: (w, a) =>
      a.type === 'REPLICASET_POD_DELETED' &&
      deletableManagedPods(w).some((p) => managedPodUid(p.serial) === a.podId && replicaSetUid(p.replicaSet) === a.replicaSetId),
  },
  'scale-deployment': {
    available: (w) => !!deployment(w),
    performed: (w) => kubectlCount(w, 'Scale', 'Deployment'),
    action: (w) => ({
      type: 'DEPLOYMENT_SCALED',
      name: deployment(w)?.name ?? '',
      replicas: deployment(w)?.replicas === 5 ? 2 : 5,
    }),
    label: (w) => `kubectl scale deployment ${deployment(w)?.name ?? ''} --replicas=${deployment(w)?.replicas === 5 ? 2 : 5}`,
    accepts: (w, a) => {
      const dep = deployment(w);
      return (
        a.type === 'DEPLOYMENT_SCALED' &&
        !!dep &&
        a.name === dep.name &&
        Number.isInteger(a.replicas) &&
        a.replicas >= 1 &&
        a.replicas <= MAX_REPLICAS &&
        a.replicas !== dep.replicas
      );
    },
  },
  'update-pod-template': {
    available: (w) => !!deployment(w),
    performed: (w) => kubectlCount(w, 'SetImage', 'Deployment'),
    action: (w) => ({
      type: 'POD_TEMPLATE_UPDATED',
      name: deployment(w)?.name ?? '',
      image: WEB_IMAGES.find((i) => i !== deployment(w)?.image) ?? WEB_IMAGES[1],
    }),
    label: (w) =>
      `kubectl set image deployment/${deployment(w)?.name ?? ''} web=${WEB_IMAGES.find((i) => i !== deployment(w)?.image) ?? ''}`,
    accepts: (w, a) => {
      const dep = deployment(w);
      return (
        a.type === 'POD_TEMPLATE_UPDATED' &&
        !!dep &&
        a.name === dep.name &&
        (WEB_IMAGES as readonly string[]).includes(a.image) &&
        a.image !== dep.image
      );
    },
  },
};

/** The build intent an action stems from, for actions that change the world. */
export const buildKindOf = (action: LearnerAction): BuildActionKind | null => {
  switch (action.type) {
    case 'CLUSTER_INITIALIZED':
      return 'initialize-cluster';
    case 'NODE_ADDED':
      return 'add-worker-node';
    case 'CONTAINER_OPENED':
      return 'open-container';
    case 'POD_CREATED':
      return 'create-pod';
    case 'MULTI_CONTAINER_EXAMPLE_OPENED':
      return 'open-multi-container-example';
    case 'POD_LIFECYCLE_OBSERVED':
      return labActionFor(action.podId) ?? null;
    case 'POD_REQUEST_SUBMITTED':
      return 'submit-pod-request';
    case 'REQUEST_PROCESSED':
      return 'process-request';
    case 'POD_BOUND_TO_NODE':
      return 'schedule-pod';
    case 'POD_SYNC_STARTED':
      return 'kubelet-prepare-pod';
    case 'CONTAINER_STARTED':
      return 'start-container';
    case 'STANDALONE_POD_DELETED':
      return 'delete-standalone-pod';
    case 'DEPLOYMENT_CREATED':
      return 'create-deployment';
    case 'CONTROLLERS_SYNCED':
      return 'run-controllers';
    case 'REPLICASET_POD_DELETED':
      return 'delete-replicaset-pod';
    case 'DEPLOYMENT_SCALED':
      return 'scale-deployment';
    case 'POD_TEMPLATE_UPDATED':
      return 'update-pod-template';
    default:
      return null;
  }
};

const advance = (w: SandboxWorld, stage: RequestStage, extra: Partial<PodRequest> = {}): SandboxWorld =>
  w.request ? { ...w, request: { ...w.request, ...extra, stage } } : w;

const addPod = (w: SandboxWorld, name: SandboxPodName) => (w.pods.includes(name) ? w.pods : [...w.pods, name]);

const withControllers = (w: SandboxWorld, controllers: ControllersState) =>
  controllers === w.controllers ? w : { ...w, controllers };

const reduceControllers = (w: SandboxWorld, s: ControllersState, action: LearnerAction): ControllersState => {
  switch (action.type) {
    case 'STANDALONE_POD_DELETED':
      return deleteStandalone(s);
    case 'DEPLOYMENT_CREATED':
      return createDeployment(s, action.name, action.image as WebImage, action.replicas);
    case 'CONTROLLERS_SYNCED':
      return syncControllers(s, controllerRooms(w));
    case 'REPLICASET_POD_DELETED': {
      const pod = s.pods.find((p) => managedPodUid(p.serial) === action.podId);
      return pod ? deleteManagedPod(s, pod.name) : s;
    }
    case 'DEPLOYMENT_SCALED':
      return scaleDeployment(s, action.replicas);
    case 'POD_TEMPLATE_UPDATED':
      return updateImage(s, action.image as WebImage);
    default:
      return s;
  }
};

/** Applies an already-validated world-building action. */
export const reduceWorld = (w: SandboxWorld, action: LearnerAction): SandboxWorld => {
  switch (action.type) {
    case 'CLUSTER_INITIALIZED':
      return { ...w, initialized: true };
    case 'NODE_ADDED':
      return { ...w, workers: [...w.workers, action.nodeId] };
    case 'CONTAINER_OPENED':
      return { ...w, containerOpened: true };
    case 'POD_CREATED':
      return { ...w, pods: addPod(w, 'hello-web') };
    case 'MULTI_CONTAINER_EXAMPLE_OPENED':
      return { ...w, pods: addPod(w, 'web-and-logger') };
    case 'POD_LIFECYCLE_OBSERVED': {
      const pod = labPodOf(action.podId);
      if (!pod || action.phase === 'Unknown') return w;
      return { ...w, pods: addPod(w, pod), lab: { ...w.lab, [pod]: action.phase } };
    }
    case 'POD_REQUEST_SUBMITTED':
      return { ...w, request: { name: action.podName, image: action.image as RequestImage, stage: 'submitted' } };
    case 'REQUEST_PROCESSED':
      return advance(w, action.outcome === 'accepted' ? 'persisted' : 'rejected');
    case 'POD_BOUND_TO_NODE':
      return advance(w, 'bound', { nodeName: action.nodeId });
    case 'POD_SYNC_STARTED':
      return advance(w, 'preparing');
    case 'CONTAINER_STARTED':
      return advance(w, 'running');
    default:
      return w.controllers ? withControllers(w, reduceControllers(w, w.controllers, action)) : w;
  }
};
