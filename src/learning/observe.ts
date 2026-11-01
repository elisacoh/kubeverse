/**
 * Translates what the learner does in the app store (picks, entering a Pod)
 * into learner actions. Pure: (cluster, previous, next) → actions. Visual
 * components never emit learning actions themselves.
 */
import type { Cluster, ControlPlaneComponentType, ReplicaSet } from '../domain/types';
import { controllerRef, findComponent, findNode, findPod, findWorkload, fitsOnNode, unscheduledPod } from '../domain/selectors';
import type { EntityPick, View } from '../state/useAppStore';
import type { LearnerAction } from './types';

const COMPONENT_INSPECTED: Partial<Record<ControlPlaneComponentType, LearnerAction>> = {
  'kube-apiserver': { type: 'API_SERVER_INSPECTED' },
  etcd: { type: 'ETCD_STATE_INSPECTED' },
  'kube-scheduler': { type: 'SCHEDULER_INSPECTED' },
  'kube-controller-manager': { type: 'CONTROLLER_MANAGER_INSPECTED' },
};

/** Lesson facts the cluster itself does not record. */
export interface ObserveContext {
  /** Pods a ReplicaSet created to replace one deleted from outside. */
  replacements?: ReadonlySet<string>;
}

/** A ReplicaSet a finished rollout left behind: an older revision, scaled to zero, with no Pods left. */
const isSupersededReplicaSet = (cluster: Cluster, rs: ReplicaSet) => {
  const owner = controllerRef(rs);
  const dep = owner && findWorkload(cluster, owner.uid);
  if (!dep || dep.kind !== 'Deployment' || dep.revision === undefined || rs.revision === undefined) return false;
  const finished =
    !!dep.status &&
    dep.status.updatedReplicas === dep.replicas &&
    dep.status.availableReplicas === dep.replicas &&
    dep.status.replicas === dep.replicas;
  const hasPods = cluster.pods.some((p) => controllerRef(p)?.uid === rs.metadata.uid);
  return finished && rs.revision < dep.revision && rs.replicas === 0 && !hasPods;
};

export const deriveActions = (
  cluster: Cluster,
  prev: EntityPick | null,
  next: EntityPick | null,
  context: ObserveContext = {},
): LearnerAction[] => {
  if (!next || next.seq === prev?.seq) return [];
  switch (next.kind) {
    case 'workload': {
      const w = findWorkload(cluster, next.id);
      if (!w) return [];
      const actions: LearnerAction[] = [{ type: 'ENTITY_SELECTED', entityId: next.id, entityKind: 'workload' }];
      if (w.kind === 'Deployment') actions.push({ type: 'DEPLOYMENT_INSPECTED', deploymentId: next.id });
      if (w.kind === 'ReplicaSet') {
        actions.push({ type: 'REPLICASET_INSPECTED', replicaSetId: next.id, revision: w.revision ?? 1 });
        if (isSupersededReplicaSet(cluster, w)) actions.push({ type: 'ROLLING_UPDATE_OBSERVED', replicaSetId: next.id });
      }
      return actions;
    }
    case 'node': {
      const node = findNode(cluster, next.id);
      if (!node) return [];
      const actions: LearnerAction[] = [
        {
          type: 'ENTITY_SELECTED',
          entityId: node.metadata.name,
          entityKind: node.role === 'control-plane' ? 'control-plane' : 'worker-node',
        },
      ];
      // Looking at a worker while a Pod waits for a Node is weighing it as a candidate.
      const waiting = unscheduledPod(cluster);
      if (waiting && node.role === 'worker') {
        actions.push({
          type: 'NODE_ELIGIBILITY_EVALUATED',
          podId: waiting.metadata.uid,
          nodeId: node.metadata.name,
          eligible: fitsOnNode(cluster, waiting, node.metadata.name),
        });
      }
      return actions;
    }
    case 'component': {
      const component = findComponent(cluster, next.id);
      if (!component) return [];
      const specific = COMPONENT_INSPECTED[component.type];
      return [
        { type: 'ENTITY_SELECTED', entityId: next.id, entityKind: 'control-plane-component' },
        ...(specific ? [specific] : []),
      ];
    }
    case 'agent':
      if (!findNode(cluster, next.id)) return [];
      return [
        next.agent === 'kubelet'
          ? { type: 'KUBELET_INSPECTED', nodeId: next.id }
          : { type: 'CONTAINER_RUNTIME_INSPECTED', nodeId: next.id },
      ];
    case 'pod': {
      const pod = findPod(cluster, next.id);
      if (!pod) return [];
      const actions: LearnerAction[] = [{ type: 'ENTITY_SELECTED', entityId: next.id, entityKind: 'pod' }];
      if (pod.phase === 'Running') actions.push({ type: 'POD_RUNNING_OBSERVED', podId: next.id });
      if (pod.phase === 'Running' && !pod.terminating && context.replacements?.has(next.id)) {
        actions.push({ type: 'RECONCILIATION_OBSERVED', podId: next.id });
      }
      if (pod.conditions?.some((c) => c.type === 'PodScheduled' && c.reason === 'Unschedulable')) {
        actions.push({ type: 'UNSCHEDULABLE_POD_INSPECTED', podId: next.id });
      }
      return actions;
    }
    case 'container': {
      const pod = findPod(cluster, next.id);
      const c = pod && [...pod.containers, ...pod.initContainers].find((x) => x.name === next.container);
      if (!pod || !c) return [];
      return [
        {
          type: 'CONTAINER_INSPECTED',
          podId: next.id,
          containerName: c.name,
          containerRole: c.role,
          containerState: c.status.state,
        },
      ];
    }
  }
};

export const deriveViewActions = (cluster: Cluster, prev: View, next: View): LearnerAction[] => {
  if (next.kind !== 'pod' || (prev.kind === 'pod' && prev.podUid === next.podUid)) return [];
  return findPod(cluster, next.podUid) ? [{ type: 'POD_ANATOMY_ENTERED', podId: next.podUid }] : [];
};
