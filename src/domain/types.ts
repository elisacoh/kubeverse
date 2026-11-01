/**
 * Kubernetes domain model for KubeVerse.
 *
 * Pure data: no rendering, no three.js, no React. The scene and UI read from
 * these types; a future simulation engine will produce and mutate them through
 * events (see `src/simulation/types.ts`).
 */

export type Uid = string;

export type Labels = Readonly<Record<string, string>>;

export interface ObjectMeta {
  uid: Uid;
  name: string;
  /** Cluster-scoped objects (Node, Namespace) have no namespace. */
  namespace?: string;
  labels: Labels;
  /** ISO-8601 timestamp. */
  creationTimestamp: string;
  ownerReferences: readonly OwnerReference[];
}

export type WorkloadKind = 'Deployment' | 'ReplicaSet' | 'DaemonSet' | 'StatefulSet' | 'Job';

export type OwnerKind = WorkloadKind | 'Node';

export interface OwnerReference {
  kind: OwnerKind;
  name: string;
  uid: Uid;
  /** True for the managing controller (at most one per object). */
  controller: boolean;
}

// ---------------------------------------------------------------------------
// Namespace
// ---------------------------------------------------------------------------

export interface Namespace {
  kind: 'Namespace';
  metadata: ObjectMeta;
  phase: 'Active' | 'Terminating';
}

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

export type NodeRole = 'control-plane' | 'worker';

export interface NodeCondition {
  type: 'Ready' | 'MemoryPressure' | 'DiskPressure' | 'PIDPressure' | 'NetworkUnavailable';
  status: 'True' | 'False' | 'Unknown';
}

export interface ResourceQuantity {
  /** CPU in millicores. */
  cpuMillis: number;
  /** Memory in MiB. */
  memoryMiB: number;
  pods: number;
}

export interface NodeTaint {
  key: string;
  value?: string;
  effect: 'NoSchedule' | 'PreferNoSchedule' | 'NoExecute';
}

export interface Node {
  kind: 'Node';
  metadata: ObjectMeta;
  role: NodeRole;
  podCIDR: string;
  internalIP: string;
  capacity: ResourceQuantity;
  allocatable: ResourceQuantity;
  conditions: readonly NodeCondition[];
  taints: readonly NodeTaint[];
  nodeInfo: {
    kubeletVersion: string;
    containerRuntime: string;
    osImage: string;
    kernelVersion: string;
  };
}

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

export type ContainerRole = 'app' | 'sidecar' | 'init';

export type ContainerState =
  | { state: 'waiting'; reason: string }
  | { state: 'running'; startedAt: string }
  | { state: 'terminated'; reason: string; exitCode: number };

export interface ContainerPort {
  name?: string;
  containerPort: number;
  protocol: 'TCP' | 'UDP' | 'SCTP';
}

export interface ResourceRequirements {
  requests?: { cpuMillis?: number; memoryMiB?: number };
  limits?: { cpuMillis?: number; memoryMiB?: number };
}

export interface VolumeMount {
  name: string;
  mountPath: string;
}

export interface Container {
  name: string;
  image: string;
  role: ContainerRole;
  /** The process the container starts, when it overrides the image default. */
  command?: readonly string[];
  ports: readonly ContainerPort[];
  volumeMounts?: readonly VolumeMount[];
  resources: ResourceRequirements;
  status: ContainerState;
  restartCount: number;
}

// ---------------------------------------------------------------------------
// Pod
// ---------------------------------------------------------------------------

export type PodPhase = 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Unknown';

/**
 * How a Pod came to exist. This is derived information (Kubernetes itself
 * expresses it through ownerReferences and mirror-pod annotations), but it is
 * the primary teaching dimension, so it is modelled explicitly.
 */
export type PodOrigin =
  | 'static' // kubelet reads a manifest from disk; API server shows a mirror Pod
  | 'replicaset' // usually via a Deployment
  | 'daemonset'
  | 'statefulset'
  | 'job'
  | 'standalone'; // created directly, no controller

export type QoSClass = 'Guaranteed' | 'Burstable' | 'BestEffort';

export type RestartPolicy = 'Always' | 'OnFailure' | 'Never';

/** A Pod-level volume; containers share it only by mounting it. */
export interface PodVolume {
  name: string;
  source: 'emptyDir';
}

export type PodConditionType = 'PodScheduled' | 'Initialized' | 'ContainersReady' | 'Ready';

export interface PodStatusCondition {
  type: PodConditionType;
  status: 'True' | 'False';
  /** Machine-readable cause when the condition is False, e.g. "Unschedulable". */
  reason?: string;
  message?: string;
}

export interface Pod {
  kind: 'Pod';
  metadata: ObjectMeta;
  origin: PodOrigin;
  /** Name of the Node this Pod is bound to; undefined while Pending/unscheduled. */
  nodeName?: string;
  /** Reported only where a scene needs them; absent means "not modelled". */
  conditions?: readonly PodStatusCondition[];
  /** No kubelet has acted on it yet (unscheduled, or just bound): no container statuses reported. */
  awaitingKubelet?: boolean;
  initContainers: readonly Container[];
  containers: readonly Container[];
  phase: PodPhase;
  podIP?: string;
  qosClass: QoSClass;
  /** Pods using hostNetwork share the Node's network namespace instead of their own. */
  hostNetwork: boolean;
  serviceAccountName: string;
  /** Defaults by origin when absent (Always, or OnFailure for Jobs). */
  restartPolicy?: RestartPolicy;
  volumes?: readonly PodVolume[];
  /** Present for static Pods: the mirror object the kubelet registers with the API server. */
  mirrorOf?: { manifestPath: string };
  /** Deletion requested (metadata.deletionTimestamp set): its containers are being stopped. */
  terminating?: boolean;
}

// ---------------------------------------------------------------------------
// Workload controllers
// ---------------------------------------------------------------------------

export interface PodSelector {
  matchLabels: Labels;
}

/** The Pod template a controller stamps Pods from, reduced to what we model. */
export interface PodTemplateSummary {
  labels: Labels;
  containerName: string;
  image: string;
  requests?: ResourceRequirements['requests'];
}

interface WorkloadBase {
  metadata: ObjectMeta;
  selector: PodSelector;
  /** Absent where a scene does not model it. */
  template?: PodTemplateSummary;
}

export interface Deployment extends WorkloadBase {
  kind: 'Deployment';
  /** Desired number of Pods (spec.replicas). */
  replicas: number;
  strategy: 'RollingUpdate' | 'Recreate';
  rollingUpdate?: { maxSurge: string; maxUnavailable: string };
  /** deployment.kubernetes.io/revision: the revision of its current ReplicaSet. */
  revision?: number;
  status?: {
    /** Pod objects that exist (not terminating), Pending included. */
    replicas: number;
    updatedReplicas: number;
    readyReplicas: number;
    availableReplicas: number;
  };
}

export interface ReplicaSet extends WorkloadBase {
  kind: 'ReplicaSet';
  replicas: number;
  readyReplicas: number;
  /** status.replicas: Pod objects that exist (not terminating). */
  currentReplicas?: number;
  revision?: number;
  podTemplateHash?: string;
}

export interface DaemonSet extends WorkloadBase {
  kind: 'DaemonSet';
  desiredNumberScheduled: number;
  numberReady: number;
}

export interface StatefulSet extends WorkloadBase {
  kind: 'StatefulSet';
  replicas: number;
  serviceName: string;
}

export interface Job extends WorkloadBase {
  kind: 'Job';
  completions: number;
  succeeded: number;
}

export type WorkloadController = Deployment | ReplicaSet | DaemonSet | StatefulSet | Job;

// ---------------------------------------------------------------------------
// Control plane
// ---------------------------------------------------------------------------

export type ControlPlaneComponentType =
  | 'kube-apiserver'
  | 'etcd'
  | 'kube-scheduler'
  | 'kube-controller-manager'
  | 'cloud-controller-manager';

export interface ControlPlaneComponent {
  kind: 'ControlPlaneComponent';
  uid: Uid;
  type: ControlPlaneComponentType;
  /** Short human description for the UI. */
  summary: string;
  /** Node hosting the component. */
  nodeName: string;
  /**
   * How it runs. In kubeadm clusters these are static Pods; in managed
   * clusters they may be hidden processes outside the cluster.
   */
  runsAs: 'static-pod' | 'systemd-service' | 'managed-external';
  /** If runsAs === 'static-pod', the uid of the corresponding mirror Pod. */
  podUid?: Uid;
  healthy: boolean;
}

// ---------------------------------------------------------------------------
// Cluster
// ---------------------------------------------------------------------------

export interface Cluster {
  uid: Uid;
  name: string;
  kubernetesVersion: string;
  /** Marks generated/demo content so it is never confused with a live cluster. */
  source: 'demo' | 'live';
  namespaces: readonly Namespace[];
  nodes: readonly Node[];
  pods: readonly Pod[];
  workloads: readonly WorkloadController[];
  controlPlane: readonly ControlPlaneComponent[];
}

export type ClusterHealth = 'healthy' | 'degraded' | 'critical';
