/**
 * The Playground's Kubernetes objects, shaped like the API stores them
 * (apiVersion / kind / metadata / spec / status), reduced to the fields the
 * lessons use. Pure data: the simulation reads and writes these, the terminal
 * prints them, the scene is built from them.
 */

export type Labels = Record<string, string>;

export interface OwnerRef {
  apiVersion: 'apps/v1';
  kind: 'ReplicaSet' | 'Deployment';
  name: string;
  uid: string;
  controller: true;
}

export interface ObjectMeta {
  name: string;
  namespace: string;
  uid: string;
  labels: Labels;
  annotations: Record<string, string>;
  /** Simulated seconds since the session started. */
  creationTime: number;
  /** Bumped on every spec change (metadata.generation). */
  generation: number;
  ownerReferences: OwnerRef[];
  /** Deletion requested (metadata.deletionTimestamp). */
  deletionTime?: number;
}

// ---------------------------------------------------------------------------
// Pod spec
// ---------------------------------------------------------------------------

export interface ResourceList {
  cpu?: string;
  memory?: string;
}

export interface ResourceRequirements {
  requests?: ResourceList;
  limits?: ResourceList;
}

export interface EnvVar {
  name: string;
  value?: string;
  valueFrom?: { configMapKeyRef?: { name: string; key: string } };
}

export interface EnvFromSource {
  configMapRef?: { name: string };
}

export interface Probe {
  httpGet?: { path?: string; port: number | string };
  tcpSocket?: { port: number | string };
  exec?: { command: string[] };
  initialDelaySeconds?: number;
  periodSeconds?: number;
  failureThreshold?: number;
}

export interface ContainerPort {
  containerPort: number;
  name?: string;
  protocol?: 'TCP' | 'UDP' | 'SCTP';
}

export interface VolumeMount {
  name: string;
  mountPath: string;
  readOnly?: boolean;
}

export interface ContainerSpec {
  name: string;
  image: string;
  command?: string[];
  args?: string[];
  ports?: ContainerPort[];
  env?: EnvVar[];
  envFrom?: EnvFromSource[];
  resources?: ResourceRequirements;
  readinessProbe?: Probe;
  livenessProbe?: Probe;
  volumeMounts?: VolumeMount[];
}

export interface VolumeSpec {
  name: string;
  emptyDir?: Record<string, unknown>;
  configMap?: { name: string };
  persistentVolumeClaim?: { claimName: string };
}

export interface PodSpec {
  containers: ContainerSpec[];
  volumes?: VolumeSpec[];
  restartPolicy?: 'Always' | 'OnFailure' | 'Never';
}

export interface PodTemplate {
  metadata: { labels: Labels; annotations?: Record<string, string> };
  spec: PodSpec;
}

export interface LabelSelector {
  matchLabels: Labels;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Where a Pod is in its (simulated) life, one step per controller pass:
 * Pending (no Node) → Scheduled (bound) → ContainerCreating → Running.
 */
export type PodStage = 'Pending' | 'Scheduled' | 'ContainerCreating' | 'Running';

export type QoSClass = 'Guaranteed' | 'Burstable' | 'BestEffort';

export interface ContainerStatus {
  name: string;
  image: string;
  ready: boolean;
  restartCount: number;
  state: 'waiting' | 'running';
  /** Waiting reason, e.g. ContainerCreating, CreateContainerConfigError, CrashLoopBackOff. */
  reason?: string;
  message?: string;
  startedAt?: number;
  /** Passes in a row the liveness probe has failed. */
  livenessFailures?: number;
}

export interface PodCondition {
  type: 'PodScheduled' | 'Initialized' | 'ContainersReady' | 'Ready';
  status: 'True' | 'False';
  reason?: string;
  message?: string;
}

export interface PodStatus {
  phase: 'Pending' | 'Running';
  stage: PodStage;
  nodeName?: string;
  podIP?: string;
  hostIP?: string;
  qosClass: QoSClass;
  conditions: PodCondition[];
  containerStatuses: ContainerStatus[];
  startTime?: number;
  /** Why it is stuck, when it is (e.g. Unschedulable). */
  reason?: string;
  message?: string;
}

// ---------------------------------------------------------------------------
// Objects
// ---------------------------------------------------------------------------

export interface PodObject {
  apiVersion: 'v1';
  kind: 'Pod';
  metadata: ObjectMeta;
  spec: PodSpec;
  status: PodStatus;
}

export interface ReplicaSetObject {
  apiVersion: 'apps/v1';
  kind: 'ReplicaSet';
  metadata: ObjectMeta;
  spec: { replicas: number; selector: LabelSelector; template: PodTemplate };
  status: { replicas: number; readyReplicas: number; availableReplicas: number };
}

export interface DeploymentObject {
  apiVersion: 'apps/v1';
  kind: 'Deployment';
  metadata: ObjectMeta;
  spec: {
    replicas: number;
    selector: LabelSelector;
    template: PodTemplate;
    strategy: { type: 'RollingUpdate' | 'Recreate' };
  };
  status: {
    replicas: number;
    updatedReplicas: number;
    readyReplicas: number;
    availableReplicas: number;
    observedGeneration: number;
  };
}

export interface ServicePort {
  name?: string;
  protocol: 'TCP' | 'UDP' | 'SCTP';
  port: number;
  targetPort: number | string;
  nodePort?: number;
}

export interface ServiceObject {
  apiVersion: 'v1';
  kind: 'Service';
  metadata: ObjectMeta;
  spec: {
    type: 'ClusterIP' | 'NodePort' | 'LoadBalancer';
    selector?: Labels;
    ports: ServicePort[];
    clusterIP: string;
  };
}

export interface ConfigMapObject {
  apiVersion: 'v1';
  kind: 'ConfigMap';
  metadata: ObjectMeta;
  data: Record<string, string>;
}

export interface PvcObject {
  apiVersion: 'v1';
  kind: 'PersistentVolumeClaim';
  metadata: ObjectMeta;
  spec: {
    accessModes: string[];
    resources: { requests: { storage: string } };
    storageClassName: string;
    volumeName?: string;
  };
  status: { phase: 'Pending' | 'Bound'; capacity?: string };
}

export type KObject = PodObject | ReplicaSetObject | DeploymentObject | ServiceObject | ConfigMapObject | PvcObject;
export type Kind = KObject['kind'];
export type ObjectOf<K extends Kind> = Extract<KObject, { kind: K }>;

/** What a manifest asks for, once validated: everything the API would store, minus what the server fills in. */
export type DesiredObject =
  | { kind: 'Pod'; apiVersion: 'v1'; metadata: DesiredMeta; spec: PodSpec }
  | { kind: 'ReplicaSet'; apiVersion: 'apps/v1'; metadata: DesiredMeta; spec: ReplicaSetObject['spec'] }
  | { kind: 'Deployment'; apiVersion: 'apps/v1'; metadata: DesiredMeta; spec: DeploymentObject['spec'] }
  | { kind: 'Service'; apiVersion: 'v1'; metadata: DesiredMeta; spec: Omit<ServiceObject['spec'], 'clusterIP'> }
  | { kind: 'ConfigMap'; apiVersion: 'v1'; metadata: DesiredMeta; data: Record<string, string> }
  | { kind: 'PersistentVolumeClaim'; apiVersion: 'v1'; metadata: DesiredMeta; spec: Omit<PvcObject['spec'], 'volumeName'> };

export interface DesiredMeta {
  name: string;
  namespace: string;
  labels: Labels;
  annotations: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Cluster
// ---------------------------------------------------------------------------

export interface SimNode {
  name: string;
  role: 'control-plane' | 'worker';
  /** Allocatable CPU in millicores. */
  cpuMillis: number;
  /** Allocatable memory in MiB. */
  memoryMiB: number;
  internalIP: string;
  podCIDR: string;
}

export interface SimEvent {
  seq: number;
  time: number;
  type: 'Normal' | 'Warning';
  reason: string;
  object: { kind: Kind; name: string; namespace: string };
  message: string;
  source: string;
}

export interface SimState {
  /** Simulated seconds since the session started. */
  time: number;
  /** Controller passes run so far. */
  pass: number;
  /** Counter behind uids, generated names and IPs. Deterministic. */
  seq: number;
  nodes: readonly SimNode[];
  objects: readonly KObject[];
  events: readonly SimEvent[];
}

export const NAMESPACES = ['default', 'kube-system'] as const;
