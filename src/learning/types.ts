/**
 * Learning Engine contracts. Pure data — no React, no three.js.
 */
import type { ContainerRole, ControlPlaneComponentType, PodPhase } from '../domain/types';
import type { NodeAgent, ScenePresentation } from '../state/presentation';
import type { Selection, View } from '../state/useAppStore';
import type { SandboxWorld } from './sandbox';

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Semantic type of something the learner selected in the world. */
export type EntityKind = 'control-plane' | 'worker-node' | 'control-plane-component' | 'pod' | 'workload';

export type ContainerStateName = 'waiting' | 'running' | 'terminated';

export type LearnerAction =
  | { type: 'CLUSTER_INITIALIZED'; controlPlaneNodeId: string }
  | { type: 'NODE_ADDED'; nodeId: string; role: 'worker' }
  | { type: 'ENTITY_SELECTED'; entityId: string; entityKind: EntityKind }
  | { type: 'CONTAINER_OPENED'; image: string }
  | { type: 'POD_CREATED'; podId: string; nodeId: string }
  | { type: 'POD_ANATOMY_ENTERED'; podId: string }
  | {
      type: 'CONTAINER_INSPECTED';
      podId: string;
      containerName: string;
      containerRole: ContainerRole;
      containerState: ContainerStateName;
    }
  | { type: 'MULTI_CONTAINER_EXAMPLE_OPENED'; podId: string }
  /** A lifecycle-lab Pod moved to a new phase at the learner's request. */
  | { type: 'POD_LIFECYCLE_OBSERVED'; podId: string; phase: PodPhase }
  /** Lesson 3: a Pod definition sent with a (simulated) kubectl apply. */
  | { type: 'POD_REQUEST_SUBMITTED'; podName: string; image: string }
  | { type: 'API_SERVER_INSPECTED' }
  | { type: 'REQUEST_PROCESSED'; podName: string; outcome: 'accepted' | 'rejected' }
  | { type: 'ETCD_STATE_INSPECTED' }
  | { type: 'SCHEDULER_INSPECTED' }
  /** The learner looked at a worker Node while a Pod waits for one. */
  | { type: 'NODE_ELIGIBILITY_EVALUATED'; podId: string; nodeId: string; eligible: boolean }
  | { type: 'SCHEDULING_PREDICTED'; podId: string; nodeId: string; correct: boolean }
  | { type: 'POD_BOUND_TO_NODE'; podId: string; nodeId: string }
  | { type: 'KUBELET_INSPECTED'; nodeId: string }
  | { type: 'CONTAINER_RUNTIME_INSPECTED'; nodeId: string }
  /** The kubelet picked up its assigned Pod and asked the runtime to prepare it. */
  | { type: 'POD_SYNC_STARTED'; podId: string; nodeId: string }
  | { type: 'CONTAINER_STARTED'; podId: string; nodeId: string }
  | { type: 'POD_RUNNING_OBSERVED'; podId: string }
  | { type: 'EVENT_TIMELINE_EXPLORED'; eventId: string }
  /** Lesson 4: `kubectl delete pod` on a Pod no controller owns. */
  | { type: 'STANDALONE_POD_DELETED'; podId: string }
  | { type: 'CONTROLLER_MANAGER_INSPECTED' }
  | { type: 'DEPLOYMENT_CREATED'; name: string; replicas: number; image: string }
  | { type: 'DEPLOYMENT_INSPECTED'; deploymentId: string }
  | { type: 'REPLICASET_INSPECTED'; replicaSetId: string; revision: number }
  /** The learner followed a Pod's ownerReferences up to its controller. */
  | { type: 'POD_OWNER_CHAIN_EXPLORED'; podId: string; replicaSetId: string }
  | { type: 'REPLICASET_POD_DELETED'; podId: string; replicaSetId: string }
  /** The learner looked at the Pod a ReplicaSet created to replace a deleted one, once it runs. */
  | { type: 'RECONCILIATION_OBSERVED'; podId: string }
  | { type: 'UNSCHEDULABLE_POD_INSPECTED'; podId: string }
  | { type: 'DEPLOYMENT_SCALED'; name: string; replicas: number }
  | { type: 'POD_TEMPLATE_UPDATED'; name: string; image: string }
  /** The learner inspected a ReplicaSet the finished rollout left behind. */
  | { type: 'ROLLING_UPDATE_OBSERVED'; replicaSetId: string }
  /** One pass of the controller loops (and of the scheduler and kubelets acting on their Pods). */
  | { type: 'CONTROLLERS_SYNCED'; pass: number }
  | { type: 'LESSON_RESET' };

export type LearnerActionType = LearnerAction['type'];

/** World-building intents the learner can trigger from the scene or the objective panel. */
export type BuildActionKind =
  | 'initialize-cluster'
  | 'add-worker-node'
  | 'open-container'
  | 'create-pod'
  | 'open-multi-container-example'
  | 'advance-lab-success'
  | 'advance-lab-failure'
  | 'submit-pod-request'
  | 'process-request'
  | 'schedule-pod'
  | 'kubelet-prepare-pod'
  | 'start-container'
  | 'delete-standalone-pod'
  | 'create-deployment'
  | 'run-controllers'
  | 'delete-replicaset-pod'
  | 'scale-deployment'
  | 'update-pod-template';

type Primitive = string | number | boolean;

/** Matches action fields by equality, or membership when an array is given. */
export type ActionFilter = Readonly<Record<string, Primitive | readonly Primitive[]>>;

export interface ActionMatcher {
  action: LearnerActionType;
  where?: ActionFilter;
}

// ---------------------------------------------------------------------------
// Lessons
// ---------------------------------------------------------------------------

export type CompletionCondition =
  /** Any one matching action. */
  | ({ type: 'action' } & ActionMatcher)
  /** `count` matching actions with distinct values of `key`. */
  | ({ type: 'distinct'; key: string; count: number } & ActionMatcher);

/** What the scene may emphasise once the learner asks for a hint. */
export type HighlightTarget =
  | { kind: 'build-site'; action: BuildActionKind }
  | { kind: 'node'; role?: 'control-plane' | 'worker' }
  | { kind: 'pod'; podId: string }
  /** Also marks the Pod itself, since the way to a container is through its Pod. */
  | { kind: 'container'; podId: string; role?: ContainerRole }
  | { kind: 'component'; component: ControlPlaneComponentType }
  | { kind: 'agent'; agent: NodeAgent; nodeId?: string }
  | { kind: 'workload'; workloadKind: 'Deployment' | 'ReplicaSet' };

export interface Concept {
  id: string;
  title: string;
  /** One or two sentences. */
  summary: string;
  /** Optional depth, shown on request. */
  details: readonly string[];
}

export interface Objective {
  id: string;
  title: string;
  instruction: string;
  /** Objectives that must be complete before this one listens. */
  requires?: readonly string[];
  condition: CompletionCondition;
  /** Concept revealed on completion. */
  discovers: string;
  /** Progressive hints; the first one also enables scene highlighting. */
  hints: readonly string[];
  highlight?: HighlightTarget;
  /** Build actions offered as buttons in the objective panel while this objective is current. */
  actions?: readonly BuildActionKind[];
  /** Gentle corrections for plausible wrong answers while this objective is current. */
  feedback?: readonly (ActionMatcher & { message: string })[];
}

export interface BuildActionRule {
  /** Objectives that must be complete before the action is offered. */
  requires?: readonly string[];
  /** Maximum number of times the action can be performed in this lesson. */
  limit?: number;
}

export interface Lesson {
  id: string;
  number: number;
  title: string;
  intro: { title: string; text: string };
  /** One sentence shown on completion. */
  summary: string;
  /** What the learner should understand afterwards. */
  goals: readonly string[];
  initialWorld: SandboxWorld;
  initialScenario: { view: View; selection: Selection };
  presentation: ScenePresentation;
  /** Presentation that changes as the lesson reveals more (defaults to `presentation`). */
  presentationFor?: (session: LessonSession) => ScenePresentation;
  buildActions: Readonly<Partial<Record<BuildActionKind, BuildActionRule>>>;
  objectives: readonly Objective[];
}

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

export interface LessonProgress {
  /** Completed objective ids, in completion order. */
  completed: readonly string[];
  /** Distinct keys seen per objective (for 'distinct' conditions). */
  seen: Readonly<Record<string, readonly string[]>>;
}

export interface LessonSession {
  lessonId: string;
  world: SandboxWorld;
  progress: LessonProgress;
}

export interface StepResult {
  session: LessonSession;
  /** Objectives completed by this action, in lesson order. */
  completed: readonly Objective[];
  /** Correction for a plausible mistake, if any. */
  feedback?: string;
}
