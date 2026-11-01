import type { ContainerRole, ControlPlaneComponentType, NodeRole } from '../domain/types';
import type { NodeAgent } from '../state/presentation';
import type { BuildActionKind, HighlightTarget } from './types';

/** A scene object, described semantically, that a highlight may apply to. */
export type HighlightSubject =
  | { kind: 'node'; role: NodeRole }
  | { kind: 'build-site'; action: BuildActionKind }
  | { kind: 'pod'; podId: string }
  | { kind: 'container'; podId: string; role: ContainerRole }
  | { kind: 'component'; component: ControlPlaneComponentType }
  | { kind: 'agent'; agent: NodeAgent; nodeId: string }
  | { kind: 'workload'; workloadKind: 'Deployment' | 'ReplicaSet' };

export const highlightMatches = (target: HighlightTarget | null | undefined, subject: HighlightSubject): boolean => {
  if (!target) return false;
  switch (target.kind) {
    case 'node':
      return subject.kind === 'node' && (!target.role || target.role === subject.role);
    case 'build-site':
      return subject.kind === 'build-site' && target.action === subject.action;
    case 'pod':
      return subject.kind === 'pod' && target.podId === subject.podId;
    case 'container':
      if (subject.kind === 'pod') return target.podId === subject.podId;
      return subject.kind === 'container' && target.podId === subject.podId && (!target.role || target.role === subject.role);
    case 'component':
      return subject.kind === 'component' && target.component === subject.component;
    case 'agent':
      return subject.kind === 'agent' && target.agent === subject.agent && (!target.nodeId || target.nodeId === subject.nodeId);
    case 'workload':
      return subject.kind === 'workload' && target.workloadKind === subject.workloadKind;
  }
};
