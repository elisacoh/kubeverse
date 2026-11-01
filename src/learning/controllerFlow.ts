/**
 * Lesson 4: the messages behind each controller event, for short animations
 * in the world. Pure data, like Lesson 3's creation flow: controllers talk
 * only to the API server; the scheduler and kubelets act on what they watch.
 */
import type { ControllerEvent } from '../simulation/controllers';
import type { FlowHop } from './creationFlow';

const API = { kind: 'component', component: 'kube-apiserver' } as const;
const CM = { kind: 'component', component: 'kube-controller-manager' } as const;
const SCHEDULER = { kind: 'component', component: 'kube-scheduler' } as const;
const kubelet = (node: string) => ({ kind: 'agent', agent: 'kubelet', node }) as const;
const runtime = (node: string) => ({ kind: 'agent', agent: 'container-runtime', node }) as const;

export const eventHops = (e: ControllerEvent): FlowHop[] => {
  switch (e.reason) {
    case 'SuccessfulCreate':
      return [{ from: CM, to: API, tone: 'request', label: 'ReplicaSet controller: POST Pod' }];
    case 'SuccessfulDelete':
      return [{ from: CM, to: API, tone: 'request', label: 'ReplicaSet controller: DELETE Pod' }];
    case 'ScalingReplicaSet':
      return [{ from: CM, to: API, tone: 'request', label: 'Deployment controller: update ReplicaSet' }];
    case 'Scheduled':
      return e.node ? [{ from: SCHEDULER, to: { kind: 'node', node: e.node }, tone: 'fit', label: 'bind' }] : [];
    case 'FailedScheduling':
      return [{ from: SCHEDULER, to: SCHEDULER, tone: 'no-fit', label: 'no Node has room' }];
    case 'Pulling':
      return e.node ? [{ from: API, to: kubelet(e.node), tone: 'watch', label: 'watch: Pod bound here' }] : [];
    case 'Started':
      return e.node ? [{ from: kubelet(e.node), to: runtime(e.node), tone: 'cri', label: 'CRI: StartContainer' }] : [];
    case 'Killing':
      return e.node ? [{ from: kubelet(e.node), to: runtime(e.node), tone: 'cri', label: 'CRI: StopContainer' }] : [];
    case 'Delete':
    case 'Create':
    case 'Scale':
    case 'SetImage':
      return [{ from: { kind: 'client' }, to: API, tone: 'request', label: `kubectl ${e.reason === 'SetImage' ? 'set image' : e.reason.toLowerCase()}` }];
    default:
      return [];
  }
};

/** At most a few distinct messages per pass, so the animation keeps pace with the loop. */
export const passHops = (events: readonly ControllerEvent[], max = 3): FlowHop[] => {
  const seen = new Set<string>();
  const hops: FlowHop[] = [];
  for (const e of events) {
    const key = `${e.source}:${e.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hops.push(...eventHops(e));
    if (hops.length >= max) break;
  }
  return hops.slice(0, max);
};
