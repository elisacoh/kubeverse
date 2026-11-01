import type { Cluster, Pod, WorkloadController } from '../domain/types';
import { controllerRef, findWorkload, rootWorkload } from '../domain/selectors';
import { accentFor } from './palette';

/** Distinct, ordered colours for successive ReplicaSet revisions: old and new Pods never look alike. */
const REVISION_ACCENTS = ['#ffd38a', '#7fe8ff', '#ff9fb7', '#b7f59a', '#c6b6ff'];

export const revisionAccent = (revision: number) =>
  REVISION_ACCENTS[(Math.max(1, revision) - 1) % REVISION_ACCENTS.length]!;

/** A workload's accent: its revision's colour where revisions are modelled, else its root workload's. */
export const workloadAccent = (cluster: Cluster, w: WorkloadController): string => {
  if ((w.kind === 'ReplicaSet' || w.kind === 'Deployment') && w.revision !== undefined) return revisionAccent(w.revision);
  let root = w;
  for (let ref = controllerRef(root), guard = 0; ref && guard < 4; ref = controllerRef(root), guard++) {
    const owner = findWorkload(cluster, ref.uid);
    if (!owner) break;
    root = owner;
  }
  return accentFor(root.metadata.uid);
};

/** Pods share their controller's accent (per revision for ReplicaSets that record one). */
export const podAccent = (cluster: Cluster, pod: Pod): string => {
  const ref = controllerRef(pod);
  const owner = ref && findWorkload(cluster, ref.uid);
  if (owner?.kind === 'ReplicaSet' && owner.revision !== undefined) return revisionAccent(owner.revision);
  return accentFor(rootWorkload(cluster, pod)?.metadata.uid ?? pod.metadata.uid);
};
