/** How kubectl prints things: tables, ages, statuses, YAML. Pure functions of the cluster state. */
import { stringify } from 'yaml';
import { controllerOf, isDeleting, isPodReady, serviceEndpoints } from '../sim/cluster';
import { isoAt } from '../sim/toCluster';
import type { KObject, PodObject, ServiceObject, SimState } from '../sim/types';

/** kubectl's HumanDuration: 45s, 3m20s, 12m, 2h5m, 3d… */
export const humanAge = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 120) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 10) return s % 60 === 0 ? `${m}m` : `${m}m${s % 60}s`;
  if (m < 180) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 8) return m % 60 === 0 ? `${h}h` : `${h}h${m % 60}m`;
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};

export const ageOf = (s: SimState, o: KObject) => humanAge(s.time - o.metadata.creationTime);

/** Columns separated by three spaces, padded to the widest cell, like kubectl. */
export const table = (header: string[], rows: string[][]): string[] => {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[]) =>
    cells
      .map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]!)))
      .join('   ')
      .trimEnd();
  return [line(header), ...rows.map(line)];
};

export const podStatus = (p: PodObject): string => {
  if (isDeleting(p)) return 'Terminating';
  const waiting = p.status.containerStatuses.find((c) => c.state === 'waiting');
  if (waiting?.reason) return waiting.reason;
  if (p.status.stage === 'Pending' || p.status.stage === 'Scheduled') return 'Pending';
  return p.status.phase;
};

export const podReady = (p: PodObject) => `${p.status.containerStatuses.filter((c) => c.ready).length}/${p.spec.containers.length}`;

export const podRestarts = (p: PodObject) => p.status.containerStatuses.reduce((n, c) => n + c.restartCount, 0);

export const labelsText = (labels: Record<string, string>) => {
  const entries = Object.entries(labels);
  return entries.length ? entries.map(([k, v]) => `${k}=${v}`).join(',') : '<none>';
};

export const servicePorts = (svc: ServiceObject) =>
  svc.spec.ports.map((p) => `${p.port}${p.nodePort ? `:${p.nodePort}` : ''}/${p.protocol}`).join(',');

export const endpointsText = (s: SimState, svc: ServiceObject) => {
  const ready = serviceEndpoints(s, svc).filter((e) => e.ready);
  if (ready.length === 0) return '<none>';
  const shown = ready.slice(0, 3).map((e) => `${e.ip}:${e.port}`);
  return ready.length > 3 ? `${shown.join(',')} + ${ready.length - 3} more...` : shown.join(',');
};

export const ACCESS_MODE_SHORT: Record<string, string> = {
  ReadWriteOnce: 'RWO',
  ReadOnlyMany: 'ROX',
  ReadWriteMany: 'RWX',
  ReadWriteOncePod: 'RWOP',
};

/** The object as the API would return it (`kubectl get -o yaml`). */
export const toApiObject = (o: KObject): Record<string, unknown> => {
  const meta: Record<string, unknown> = {
    ...(Object.keys(o.metadata.annotations).length ? { annotations: o.metadata.annotations } : {}),
    creationTimestamp: isoAt(o.metadata.creationTime),
    ...(o.metadata.deletionTime !== undefined ? { deletionTimestamp: isoAt(o.metadata.deletionTime + 30) } : {}),
    ...(o.kind !== 'Pod' && o.kind !== 'ConfigMap' ? { generation: o.metadata.generation } : {}),
    ...(Object.keys(o.metadata.labels).length ? { labels: o.metadata.labels } : {}),
    name: o.metadata.name,
    namespace: o.metadata.namespace,
    ...(o.metadata.ownerReferences.length
      ? { ownerReferences: o.metadata.ownerReferences.map((r) => ({ apiVersion: r.apiVersion, blockOwnerDeletion: true, controller: true, kind: r.kind, name: r.name, uid: r.uid })) }
      : {}),
    uid: o.metadata.uid,
  };
  const base = { apiVersion: o.apiVersion, kind: o.kind, metadata: meta };
  switch (o.kind) {
    case 'Pod': {
      const st = o.status;
      return {
        ...base,
        spec: { ...o.spec, ...(st.nodeName ? { nodeName: st.nodeName } : {}), restartPolicy: o.spec.restartPolicy ?? 'Always', schedulerName: 'default-scheduler', serviceAccountName: 'default' },
        status: {
          conditions: st.conditions.map((c) => ({ type: c.type, status: c.status, ...(c.reason ? { reason: c.reason } : {}), ...(c.message ? { message: c.message } : {}) })),
          ...(st.containerStatuses.length
            ? {
                containerStatuses: st.containerStatuses.map((c) => ({
                  image: c.image,
                  name: c.name,
                  ready: c.ready,
                  restartCount: c.restartCount,
                  started: c.state === 'running',
                  state: c.state === 'running' ? { running: { startedAt: isoAt(c.startedAt ?? 0) } } : { waiting: { reason: c.reason, ...(c.message ? { message: c.message } : {}) } },
                })),
              }
            : {}),
          ...(st.hostIP ? { hostIP: st.hostIP } : {}),
          phase: st.phase,
          ...(st.podIP ? { podIP: st.podIP } : {}),
          qosClass: st.qosClass,
          ...(st.startTime !== undefined ? { startTime: isoAt(st.startTime) } : {}),
        },
      };
    }
    case 'ReplicaSet':
      return { ...base, spec: o.spec, status: { ...o.status, fullyLabeledReplicas: o.status.replicas, observedGeneration: o.metadata.generation } };
    case 'Deployment':
      return { ...base, spec: o.spec, status: o.status };
    case 'Service':
      return { ...base, spec: { ...o.spec, clusterIPs: [o.spec.clusterIP] }, status: { loadBalancer: {} } };
    case 'ConfigMap':
      return { ...base, data: o.data };
    case 'PersistentVolumeClaim':
      return {
        ...base,
        spec: o.spec,
        status: { phase: o.status.phase, ...(o.status.capacity ? { accessModes: o.spec.accessModes, capacity: { storage: o.status.capacity } } : {}) },
      };
  }
};

export const toYaml = (value: unknown) => stringify(value, { lineWidth: 0 }).trimEnd();

export const ownerText = (o: KObject) => {
  const ref = controllerOf(o);
  return ref ? `${ref.kind}/${ref.name}` : undefined;
};

export const readyPods = (pods: PodObject[]) => pods.filter(isPodReady).length;
