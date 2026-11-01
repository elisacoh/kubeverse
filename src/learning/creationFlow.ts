/**
 * Lesson 3's creation timeline, derived from the sandbox world. Pure data:
 * the scene turns hops into short animations, the UI lists the events.
 *
 * Components never call each other in a chain. Each one watches the API
 * server and acts on changes that concern it; only the API server talks to
 * etcd. Hops follow that shape.
 */
import type { Cluster, ControlPlaneComponentType } from '../domain/types';
import { findPod, fitsOnNode, freeCapacity, podRequests } from '../domain/selectors';
import type { NodeAgent } from '../state/presentation';
import { REQUEST_POD_UID, podNameError, type SandboxWorld } from './sandbox';

export type FlowAnchor =
  | { kind: 'client' }
  | { kind: 'component'; component: ControlPlaneComponentType }
  | { kind: 'agent'; agent: NodeAgent; node: string }
  | { kind: 'node'; node: string }
  | { kind: 'pod'; podId: string };

/** request: an API call · watch: a change delivered to a watcher · write: API server ⇄ etcd · cri: kubelet → runtime. */
export type HopTone = 'request' | 'watch' | 'write' | 'cri' | 'reject' | 'fit' | 'no-fit' | 'process';

export interface FlowHop {
  /** Shown beside the moving message. */
  label?: string;
  from: FlowAnchor;
  /** Same as `from` for work done in place (e.g. request processing). */
  to: FlowAnchor;
  tone: HopTone;
}

export type FlowFocus =
  | { kind: 'component'; component: ControlPlaneComponentType }
  | { kind: 'agent'; agent: NodeAgent; node: string }
  | { kind: 'pod'; podId: string }
  | { kind: 'node'; node: string };

export type TimelineEventId =
  | 'submitted'
  | 'rejected'
  | 'processed'
  | 'persisted'
  | 'awaiting-scheduling'
  | 'node-selected'
  | 'bound'
  | 'kubelet-processing'
  | 'container-started'
  | 'pod-running';

export interface TimelineEvent {
  id: TimelineEventId;
  title: string;
  /** Who acts. */
  actor: string;
  detail: string;
  focus: FlowFocus;
  hops: readonly FlowHop[];
}

const API = { kind: 'component', component: 'kube-apiserver' } as const;
const ETCD = { kind: 'component', component: 'etcd' } as const;
const SCHEDULER = { kind: 'component', component: 'kube-scheduler' } as const;
const POD = { kind: 'pod', podId: REQUEST_POD_UID } as const;
const kubelet = (node: string) => ({ kind: 'agent', agent: 'kubelet', node }) as const;
const runtime = (node: string) => ({ kind: 'agent', agent: 'container-runtime', node }) as const;

const cpu = (m: number) => `${+(m / 1000).toFixed(2)} CPU`;

const STAGE_ORDER = ['submitted', 'persisted', 'bound', 'preparing', 'running'] as const;
const reached = (world: SandboxWorld, stage: (typeof STAGE_ORDER)[number]) => {
  const s = world.request?.stage;
  if (!s || s === 'rejected') return stage === 'submitted' && s === 'rejected';
  return STAGE_ORDER.indexOf(s) >= STAGE_ORDER.indexOf(stage);
};

/** The events that have happened so far for the learner's latest request, in order. */
export const timelineEvents = (world: SandboxWorld, cluster: Cluster): TimelineEvent[] => {
  const req = world.request;
  if (!req) return [];
  const name = req.name;
  const events: TimelineEvent[] = [
    {
      id: 'submitted',
      title: 'Request submitted',
      actor: 'kubectl',
      detail: `kubectl sends POST /api/v1/namespaces/default/pods with the definition of ${name}. Nothing runs yet.`,
      focus: { kind: 'component', component: 'kube-apiserver' },
      hops: [{ from: { kind: 'client' }, to: API, tone: 'request', label: 'POST /api/v1/…/pods' }],
    },
  ];

  if (req.stage === 'rejected') {
    events.push({
      id: 'rejected',
      title: 'Request rejected',
      actor: 'kube-apiserver',
      detail: `Validation failed, so nothing was stored: ${podNameError(name) ?? 'invalid request'}`,
      focus: { kind: 'component', component: 'kube-apiserver' },
      hops: [{ from: API, to: API, tone: 'reject', label: '422 Invalid' }],
    });
    return events;
  }
  if (!reached(world, 'persisted')) return events;

  events.push(
    {
      id: 'processed',
      title: 'API processing completed',
      actor: 'kube-apiserver',
      detail: 'Authentication, authorization and admission let the request through, and the Pod passed validation.',
      focus: { kind: 'component', component: 'kube-apiserver' },
      hops: [{ from: API, to: API, tone: 'process', label: 'authn · authz · admission · validation' }],
    },
    {
      id: 'persisted',
      title: 'Pod object persisted',
      actor: 'kube-apiserver → etcd',
      detail: `The API server stores ${name} in etcd: phase Pending, no Node. Stored is not running.`,
      focus: { kind: 'component', component: 'etcd' },
      hops: [{ from: API, to: ETCD, tone: 'write', label: 'store Pod' }],
    },
    {
      id: 'awaiting-scheduling',
      title: 'Pod awaiting scheduling',
      actor: 'kube-scheduler',
      detail: 'The scheduler, watching the API server, is notified of a Pod with no spec.nodeName.',
      focus: { kind: 'component', component: 'kube-scheduler' },
      hops: [{ from: API, to: SCHEDULER, tone: 'watch', label: 'watch: Pod without a Node' }],
    },
  );
  if (!reached(world, 'bound') || !req.nodeName) return events;

  const node = req.nodeName;
  const pod = findPod(cluster, REQUEST_POD_UID);
  const others = cluster.nodes.filter((n) => n.role === 'worker' && n.metadata.name !== node);
  const need = pod ? podRequests(pod) : { cpuMillis: 0, memoryMiB: 0 };
  // The chosen Node already counts this Pod; show what was free before it.
  const freeBefore = freeCapacity(cluster, node).cpuMillis + need.cpuMillis;
  events.push(
    {
      id: 'node-selected',
      title: 'Node selected',
      actor: 'kube-scheduler',
      detail: `${name} requests ${cpu(need.cpuMillis)}. ${node} had ${cpu(freeBefore)} free and fits${others
        .map((o) => `; ${o.metadata.name} had ${cpu(freeCapacity(cluster, o.metadata.name).cpuMillis)}${pod && fitsOnNode(cluster, pod, o.metadata.name) ? '' : ' and does not'}`)
        .join('')}.`,
      focus: { kind: 'node', node },
      hops: [
        ...others.map((o) => ({ from: SCHEDULER, to: { kind: 'node', node: o.metadata.name } as const, tone: 'no-fit' as const, label: 'does not fit' })),
        { from: SCHEDULER, to: { kind: 'node', node }, tone: 'fit', label: 'fits' },
      ],
    },
    {
      id: 'bound',
      title: 'Pod bound',
      actor: 'kube-scheduler → kube-apiserver',
      detail: `The scheduler posts a Binding through the API server, which stores spec.nodeName: ${node}. The Pod is scheduled — still Pending.`,
      focus: { kind: 'pod', podId: REQUEST_POD_UID },
      hops: [
        { from: SCHEDULER, to: API, tone: 'request', label: 'POST Binding' },
        { from: API, to: ETCD, tone: 'write', label: 'store spec.nodeName' },
      ],
    },
  );
  if (!reached(world, 'preparing')) return events;

  events.push({
    id: 'kubelet-processing',
    title: 'Kubelet processing Pod',
    actor: `kubelet on ${node}`,
    detail: `The kubelet on ${node}, watching the API server for Pods bound to its Node, picks up ${name} and asks the container runtime, through CRI, to create the Pod sandbox, pull ${req.image} and create the container.`,
    focus: { kind: 'agent', agent: 'kubelet', node },
    hops: [
      { from: API, to: kubelet(node), tone: 'watch', label: 'watch: Pod bound to this Node' },
      { from: kubelet(node), to: runtime(node), tone: 'cri', label: 'CRI: RunPodSandbox · PullImage · CreateContainer' },
    ],
  });
  if (!reached(world, 'running')) return events;

  events.push(
    {
      id: 'container-started',
      title: 'Container started',
      actor: `container runtime on ${node}`,
      detail: 'Asked through CRI (StartContainer), the runtime starts the container’s process.',
      focus: { kind: 'agent', agent: 'container-runtime', node },
      hops: [
        { from: kubelet(node), to: runtime(node), tone: 'cri', label: 'CRI: StartContainer' },
        { from: runtime(node), to: POD, tone: 'cri', label: 'process starts' },
      ],
    },
    {
      id: 'pod-running',
      title: 'Pod Running',
      actor: `kubelet on ${node} → kube-apiserver`,
      detail: 'The kubelet reports the Pod’s status through the API server: phase Running, condition Ready=True.',
      focus: { kind: 'pod', podId: REQUEST_POD_UID },
      hops: [
        { from: kubelet(node), to: API, tone: 'request', label: 'PATCH status: Running' },
        { from: API, to: ETCD, tone: 'write', label: 'store status' },
      ],
    },
  );
  return events;
};

/** Events that appeared between two worlds, so the scene can animate what just happened. */
export const newEvents = (before: TimelineEvent[], after: TimelineEvent[]): TimelineEvent[] => {
  const kept = new Set(after.map((e) => e.id));
  // A resubmitted request starts a fresh timeline.
  if (before.some((e) => !kept.has(e.id))) return after;
  const seen = new Set(before.map((e) => e.id));
  return after.filter((e) => !seen.has(e.id));
};
