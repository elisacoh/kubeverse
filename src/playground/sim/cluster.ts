/**
 * A small, deterministic imitation of a Kubernetes cluster for the Playground.
 *
 * The API part (`applyObject`, `deleteObject`) stores what manifests ask for,
 * with the same create / configure / reject rules as the API server for the
 * fields the lessons use. The controller part (`reconcile`) runs one pass of
 * simplified control loops — garbage collector, kubelets, scheduler, volume
 * provisioner, ReplicaSet and Deployment controllers — each moving objects at
 * most one step, so the learner can watch things happen.
 *
 * What is simulated, not real: there are no containers, no network and no
 * disks. Images always pull (if well-formed), applications listen on the
 * ports they declare (plus their image's usual port), and storage is
 * provisioned instantly by a pretend `standard` StorageClass.
 */
import { parseCpu, parseMemory } from './quantity';
import type {
  ContainerSpec,
  ContainerStatus,
  DeploymentObject,
  DesiredObject,
  KObject,
  Kind,
  Labels,
  ObjectMeta,
  ObjectOf,
  OwnerRef,
  PodCondition,
  PodObject,
  PodSpec,
  Probe,
  PvcObject,
  QoSClass,
  ReplicaSetObject,
  ServiceObject,
  SimEvent,
  SimNode,
  SimState,
} from './types';

export const NODES: readonly SimNode[] = [
  { name: 'control-plane-1', role: 'control-plane', cpuMillis: 3800, memoryMiB: 7680, internalIP: '192.168.49.2', podCIDR: '10.244.0.0/24' },
  { name: 'worker-1', role: 'worker', cpuMillis: 3800, memoryMiB: 7680, internalIP: '192.168.49.3', podCIDR: '10.244.1.0/24' },
  { name: 'worker-2', role: 'worker', cpuMillis: 3800, memoryMiB: 7680, internalIP: '192.168.49.4', podCIDR: '10.244.2.0/24' },
];

export const initialState = (): SimState => ({ time: 0, pass: 0, seq: 0, nodes: NODES, objects: [], events: [] });

/** Seconds a deleted Pod spends Terminating before it disappears. */
export const TERMINATION_SECONDS = 2;
const MAX_EVENTS = 300;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The characters Kubernetes uses for generated name suffixes. */
const ALPHABET = 'bcdfghjklmnpqrstvwxz2456789';

export const hashString = (seed: string, length: number) => {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  let out = '';
  for (let i = 0; i < length; i++) {
    h = (Math.imul(h, 1103515245) + 12345) >>> 0;
    out += ALPHABET[(h >>> 16) % ALPHABET.length];
  }
  return out;
};

/** JSON with sorted keys: equal values always give equal strings. */
export const stableStringify = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
};

export const matchesSelector = (labels: Labels, selector: Labels) =>
  Object.keys(selector).length > 0 && Object.entries(selector).every(([k, v]) => labels[k] === v);

export const controllerOf = (o: KObject): OwnerRef | undefined => o.metadata.ownerReferences.find((r) => r.controller);

export const findObject = <K extends Kind>(s: SimState, kind: K, name: string, namespace = 'default'): ObjectOf<K> | undefined =>
  s.objects.find((o) => o.kind === kind && o.metadata.name === name && o.metadata.namespace === namespace) as ObjectOf<K> | undefined;

export const objectsOf = <K extends Kind>(s: SimState, kind: K): ObjectOf<K>[] => s.objects.filter((o) => o.kind === kind) as ObjectOf<K>[];

export const isDeleting = (o: KObject) => o.metadata.deletionTime !== undefined;

export const qosClassOf = (spec: PodSpec): QoSClass => {
  const cs = spec.containers;
  const any = cs.some((c) => c.resources?.requests?.cpu || c.resources?.requests?.memory || c.resources?.limits?.cpu || c.resources?.limits?.memory);
  if (!any) return 'BestEffort';
  const guaranteed = cs.every((c) => {
    const l = c.resources?.limits;
    const r = c.resources?.requests ?? {};
    if (!l?.cpu || !l.memory) return false;
    const reqCpu = r.cpu ?? l.cpu;
    const reqMem = r.memory ?? l.memory;
    return parseCpu(reqCpu) === parseCpu(l.cpu) && parseMemory(reqMem) === parseMemory(l.memory);
  });
  return guaranteed ? 'Guaranteed' : 'Burstable';
};

/** What a container asks the scheduler to reserve; a limit without a request counts as the request. */
export const podRequests = (spec: PodSpec) =>
  spec.containers.reduce(
    (sum, c) => {
      const cpu = c.resources?.requests?.cpu ?? c.resources?.limits?.cpu;
      const mem = c.resources?.requests?.memory ?? c.resources?.limits?.memory;
      return { cpuMillis: sum.cpuMillis + (cpu ? (parseCpu(cpu) ?? 0) : 0), memoryMiB: sum.memoryMiB + (mem ? (parseMemory(mem) ?? 0) : 0) };
    },
    { cpuMillis: 0, memoryMiB: 0 },
  );

const IMAGE_REF = /^(?:[a-z0-9.-]+(?::\d+)?\/)?[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*(?::[\w][\w.-]{0,127})?(?:@sha256:[a-f0-9]{64})?$/;
export const isValidImage = (image: string) => IMAGE_REF.test(image);

/** The port an image's application usually listens on (simulated applications also listen on every declared port). */
const IMAGE_PORTS: Record<string, number> = { nginx: 80, httpd: 80, redis: 6379, postgres: 5432, mysql: 3306 };
const imageRepo = (image: string) => image.split('@')[0]!.split(':')[0]!.split('/').pop()!;
const isWebServer = (image: string) => ['nginx', 'httpd'].includes(imageRepo(image));

export const listeningPorts = (c: ContainerSpec): number[] => {
  const ports = (c.ports ?? []).map((p) => p.containerPort);
  const usual = IMAGE_PORTS[imageRepo(c.image)];
  return usual !== undefined ? [...new Set([...ports, usual])] : ports;
};

/** Resolves a probe or targetPort reference (number or port name) to a number. */
export const resolvePort = (c: ContainerSpec, port: number | string): number | undefined => {
  if (typeof port === 'number') return port;
  if (/^\d+$/.test(port)) return Number(port);
  return c.ports?.find((p) => p.name === port)?.containerPort;
};

/** Simulated probe outcome: null on success, else the failure message the kubelet would report. */
export const probeFailure = (c: ContainerSpec, probe: Probe): string | null => {
  if (probe.exec) return null;
  const target = probe.httpGet ?? probe.tcpSocket;
  if (!target) return null;
  const port = resolvePort(c, target.port);
  if (port === undefined || !listeningPorts(c).includes(port)) {
    const where = probe.httpGet ? `Get "http://10.244.0.0:${port ?? target.port}${probe.httpGet.path ?? '/'}"` : `dial tcp :${port ?? target.port}`;
    return `${probe.httpGet ? 'HTTP' : 'TCP'} probe failed: ${where}: connect: connection refused`;
  }
  if (probe.httpGet && isWebServer(c.image)) {
    const path = probe.httpGet.path ?? '/';
    if (!['/', '/index.html'].includes(path)) return `HTTP probe failed with statuscode: 404`;
  }
  return null;
};

// ---------------------------------------------------------------------------
// Drafts: one mutable copy per pass, with event recording
// ---------------------------------------------------------------------------

interface Draft {
  time: number;
  pass: number;
  seq: number;
  nodes: readonly SimNode[];
  objects: KObject[];
  events: SimEvent[];
  changed: boolean;
}

const draftOf = (s: SimState): Draft => ({
  time: s.time,
  pass: s.pass,
  seq: s.seq,
  nodes: s.nodes,
  objects: structuredClone(s.objects) as KObject[],
  events: [...s.events],
  changed: false,
});

const finish = (s: SimState, d: Draft): SimState =>
  d.changed ? { ...s, seq: d.seq, objects: d.objects, events: d.events.slice(-MAX_EVENTS) } : s;

const emit = (d: Draft, o: KObject, type: SimEvent['type'], reason: string, message: string, source: string) => {
  d.seq += 1;
  d.events.push({ seq: d.seq, time: d.time, type, reason, message, source, object: { kind: o.kind, name: o.metadata.name, namespace: o.metadata.namespace } });
  d.changed = true;
};

const nextSeq = (d: Draft) => (d.seq += 1);

const newMeta = (d: Draft, name: string, namespace: string, labels: Labels, annotations: Record<string, string> = {}): ObjectMeta => ({
  name,
  namespace,
  uid: `${hashString(`${name}#${nextSeq(d)}`, 8)}-${d.seq.toString(36).padStart(4, '0')}`,
  labels: { ...labels },
  annotations: { ...annotations },
  creationTime: d.time,
  generation: 1,
  ownerReferences: [],
});

const newPod = (meta: ObjectMeta, spec: PodSpec): PodObject => ({
  apiVersion: 'v1',
  kind: 'Pod',
  metadata: meta,
  spec: structuredClone(spec),
  status: { phase: 'Pending', stage: 'Pending', qosClass: qosClassOf(spec), conditions: [], containerStatuses: [] },
});

// ---------------------------------------------------------------------------
// API: apply and delete
// ---------------------------------------------------------------------------

export type ApplyAction = 'created' | 'configured' | 'unchanged';

export type ApplyResult =
  | { ok: true; state: SimState; action: ApplyAction; kind: Kind; name: string }
  | { ok: false; state: SimState; error: string; hint?: string };

const desiredContent = (o: DesiredObject | KObject) =>
  stableStringify({ labels: o.metadata.labels, annotations: o.metadata.annotations, body: 'data' in o ? o.data : stripServer(o) });

const specOf = (o: DesiredObject | KObject): unknown => ('spec' in o ? o.spec : undefined);

const stripServer = (o: DesiredObject | KObject) => {
  const spec = specOf(o) as Record<string, unknown> | undefined;
  if (!spec) return undefined;
  if (o.kind === 'Service') {
    const { clusterIP: _ip, ...rest } = spec as ServiceObject['spec'];
    return rest;
  }
  if (o.kind === 'PersistentVolumeClaim') {
    const { volumeName: _v, ...rest } = spec as PvcObject['spec'];
    return rest;
  }
  return spec;
};

const RESOURCE_NAME: Record<Kind, string> = {
  Pod: 'pod',
  ReplicaSet: 'replicaset.apps',
  Deployment: 'deployment.apps',
  Service: 'service',
  ConfigMap: 'configmap',
  PersistentVolumeClaim: 'persistentvolumeclaim',
};
export const resourceName = (kind: Kind) => RESOURCE_NAME[kind];

const PLURAL: Record<Kind, string> = {
  Pod: 'pods',
  ReplicaSet: 'replicasets.apps',
  Deployment: 'deployments.apps',
  Service: 'services',
  ConfigMap: 'configmaps',
  PersistentVolumeClaim: 'persistentvolumeclaims',
};
export const pluralName = (kind: Kind) => PLURAL[kind];

const allocateClusterIP = (d: Draft) => {
  const n = d.objects.filter((o) => o.kind === 'Service').length;
  return `10.96.${Math.floor(n / 200) + 10}.${(n % 200) + 20}`;
};

const createObject = (d: Draft, desired: DesiredObject): KObject => {
  const meta = newMeta(d, desired.metadata.name, desired.metadata.namespace, desired.metadata.labels, desired.metadata.annotations);
  switch (desired.kind) {
    case 'Pod':
      return newPod(meta, desired.spec);
    case 'ReplicaSet':
      return { apiVersion: 'apps/v1', kind: 'ReplicaSet', metadata: meta, spec: structuredClone(desired.spec), status: { replicas: 0, readyReplicas: 0, availableReplicas: 0 } };
    case 'Deployment':
      return {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: meta,
        spec: structuredClone(desired.spec),
        status: { replicas: 0, updatedReplicas: 0, readyReplicas: 0, availableReplicas: 0, observedGeneration: 0 },
      };
    case 'Service':
      return { apiVersion: 'v1', kind: 'Service', metadata: meta, spec: { ...structuredClone(desired.spec), clusterIP: allocateClusterIP(d) } };
    case 'ConfigMap':
      return { apiVersion: 'v1', kind: 'ConfigMap', metadata: meta, data: { ...desired.data } };
    case 'PersistentVolumeClaim':
      return { apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: meta, spec: structuredClone(desired.spec), status: { phase: 'Pending' } };
  }
};

const withoutImages = (spec: PodSpec) => stableStringify({ ...spec, containers: spec.containers.map((c) => ({ ...c, image: '' })) });

/** Why the API server would refuse this update, or null. */
const updateError = (existing: KObject, desired: DesiredObject): { error: string; hint?: string } | null => {
  const name = existing.metadata.name;
  if (existing.kind === 'Pod' && desired.kind === 'Pod') {
    if (withoutImages(existing.spec) !== withoutImages(desired.spec)) {
      return {
        error: `The Pod "${name}" is invalid: spec: Forbidden: pod updates may not change fields other than \`spec.containers[*].image\`, \`spec.initContainers[*].image\`, \`spec.activeDeadlineSeconds\`, \`spec.tolerations\` (only additions to existing tolerations), \`spec.terminationGracePeriodSeconds\``,
        hint: `A running Pod's spec is mostly immutable. Delete it first (kubectl delete pod ${name}), then apply again. Controllers like Deployments do exactly this for you.`,
      };
    }
  }
  if ((existing.kind === 'ReplicaSet' || existing.kind === 'Deployment') && (desired.kind === 'ReplicaSet' || desired.kind === 'Deployment')) {
    if (stableStringify(existing.spec.selector) !== stableStringify(desired.spec.selector)) {
      return {
        error: `The ${existing.kind} "${name}" is invalid: spec.selector: Invalid value: ${JSON.stringify(desired.spec.selector)}: field is immutable`,
        hint: `The selector cannot change after creation. Delete the ${existing.kind} first, or keep its selector.`,
      };
    }
  }
  if (existing.kind === 'PersistentVolumeClaim' && desired.kind === 'PersistentVolumeClaim') {
    const { resources: _a, ...a } = existing.spec;
    const { resources: _b, ...b } = desired.spec;
    const { volumeName: _vn, ...aRest } = a;
    if (stableStringify(aRest) !== stableStringify(b)) {
      return { error: `persistentvolumeclaims "${name}" is forbidden: spec is immutable after creation except resources.requests and volumeAttributesClassName for bound claims` };
    }
  }
  if (existing.kind === 'Service' && desired.kind === 'Service' && existing.spec.type !== desired.spec.type && desired.spec.type === 'ClusterIP') {
    return null;
  }
  return null;
};

/** `kubectl apply` for one object: create it, update it, or report why not. */
export const applyObject = (s: SimState, desired: DesiredObject): ApplyResult => {
  const existing = findObject(s, desired.kind, desired.metadata.name, desired.metadata.namespace);
  if (!existing) {
    const d = draftOf(s);
    d.objects.push(createObject(d, desired));
    d.changed = true;
    return { ok: true, state: finish(s, d), action: 'created', kind: desired.kind, name: desired.metadata.name };
  }
  if (isDeleting(existing)) {
    return {
      ok: false,
      state: s,
      error: `Error from server (Conflict): error when applying patch: Operation cannot be fulfilled on ${pluralName(desired.kind)} "${desired.metadata.name}": the object has been modified; it is being deleted`,
      hint: 'The previous object is still terminating. Wait a second and apply again.',
    };
  }
  if (desiredContent(existing) === desiredContent(desired)) {
    return { ok: true, state: s, action: 'unchanged', kind: desired.kind, name: desired.metadata.name };
  }
  const err = updateError(existing, desired);
  if (err) return { ok: false, state: s, ...err };

  const d = draftOf(s);
  const target = d.objects.find((o) => o.metadata.uid === existing.metadata.uid)!;
  const specChanged = stableStringify(specOf(target) ?? (target.kind === 'ConfigMap' ? target.data : null)) !== stableStringify(specOf(desired) ?? (desired.kind === 'ConfigMap' ? desired.data : null));
  target.metadata.labels = { ...desired.metadata.labels };
  target.metadata.annotations = { ...desired.metadata.annotations };
  if (specChanged) target.metadata.generation += 1;
  switch (target.kind) {
    case 'Pod': {
      const spec = (desired as Extract<DesiredObject, { kind: 'Pod' }>).spec;
      const changedImages = target.spec.containers.filter((c, i) => c.image !== spec.containers[i]?.image).map((c) => c.name);
      target.spec = structuredClone(spec);
      if (changedImages.length && target.status.stage === 'Running') {
        // The kubelet restarts the containers whose image changed.
        target.status.stage = 'ContainerCreating';
        target.status.containerStatuses = target.status.containerStatuses.map((cs) =>
          changedImages.includes(cs.name)
            ? { ...cs, image: spec.containers.find((c) => c.name === cs.name)?.image ?? cs.image, ready: false, state: 'waiting', reason: 'ContainerCreating', restartCount: cs.restartCount + 1 }
            : cs,
        );
      }
      break;
    }
    case 'ReplicaSet':
    case 'Deployment':
      target.spec = structuredClone((desired as Extract<DesiredObject, { kind: 'Deployment' | 'ReplicaSet' }>).spec) as never;
      break;
    case 'Service':
      target.spec = { ...structuredClone((desired as Extract<DesiredObject, { kind: 'Service' }>).spec), clusterIP: target.spec.clusterIP };
      break;
    case 'ConfigMap':
      target.data = { ...(desired as Extract<DesiredObject, { kind: 'ConfigMap' }>).data };
      break;
    case 'PersistentVolumeClaim':
      target.spec = { ...structuredClone((desired as Extract<DesiredObject, { kind: 'PersistentVolumeClaim' }>).spec), volumeName: target.spec.volumeName };
      break;
  }
  d.changed = true;
  return { ok: true, state: finish(s, d), action: 'configured', kind: desired.kind, name: desired.metadata.name };
};

export type DeleteResult = { ok: true; state: SimState; kind: Kind; name: string } | { ok: false; state: SimState; error: string };

/** `kubectl delete`: Pods start terminating; other objects go at once and the garbage collector removes what they owned. */
export const deleteObject = (s: SimState, kind: Kind, name: string, namespace = 'default'): DeleteResult => {
  const existing = findObject(s, kind, name, namespace);
  if (!existing) return { ok: false, state: s, error: `Error from server (NotFound): ${pluralName(kind)} "${name}" not found` };
  const d = draftOf(s);
  if (kind === 'Pod') {
    const pod = d.objects.find((o) => o.metadata.uid === existing.metadata.uid)!;
    if (pod.metadata.deletionTime === undefined) {
      pod.metadata.deletionTime = d.time;
      emit(d, pod, 'Normal', 'Killing', `Stopping container ${(pod as PodObject).spec.containers.map((c) => c.name).join(', ')}`, `kubelet`);
    }
  } else {
    d.objects = d.objects.filter((o) => o.metadata.uid !== existing.metadata.uid);
  }
  d.changed = true;
  return { ok: true, state: finish(s, d), kind, name };
};

/** Simulated seconds pass without any control loop running. */
export const advanceClock = (s: SimState, seconds: number): SimState => ({ ...s, time: s.time + seconds });

// ---------------------------------------------------------------------------
// Control loops
// ---------------------------------------------------------------------------

const pods = (d: Draft) => d.objects.filter((o): o is PodObject => o.kind === 'Pod');

const garbageCollect = (d: Draft) => {
  const uids = new Set(d.objects.map((o) => o.metadata.uid));
  const orphans = d.objects.filter((o) => {
    const ref = controllerOf(o);
    return ref && !uids.has(ref.uid);
  });
  for (const o of orphans) {
    if (o.kind === 'Pod') {
      if (o.metadata.deletionTime === undefined) {
        o.metadata.deletionTime = d.time;
        emit(d, o, 'Normal', 'Killing', `Stopping container ${o.spec.containers.map((c) => c.name).join(', ')} (owner ${controllerOf(o)!.kind} ${controllerOf(o)!.name} was deleted)`, 'kubelet');
      }
    } else {
      d.objects = d.objects.filter((x) => x !== o);
      d.changed = true;
    }
  }
};

const conditionsFor = (pod: PodObject): PodCondition[] => {
  const st = pod.status;
  if (!st.nodeName) {
    return st.reason === 'Unschedulable' ? [{ type: 'PodScheduled', status: 'False', reason: 'Unschedulable', message: st.message }] : [];
  }
  const ready = st.stage === 'Running' && st.containerStatuses.length > 0 && st.containerStatuses.every((c) => c.ready);
  return [
    { type: 'PodScheduled', status: 'True' },
    { type: 'Initialized', status: 'True' },
    { type: 'ContainersReady', status: ready ? 'True' : 'False', ...(ready ? {} : { reason: 'ContainersNotReady' }) },
    { type: 'Ready', status: ready ? 'True' : 'False', ...(ready ? {} : { reason: 'ContainersNotReady' }) },
  ];
};

const setConditions = (d: Draft, pod: PodObject) => {
  const next = conditionsFor(pod);
  if (stableStringify(next) !== stableStringify(pod.status.conditions)) {
    pod.status.conditions = next;
    d.changed = true;
  }
};

const podIPFor = (d: Draft, nodeName: string) => {
  const node = d.nodes.find((n) => n.name === nodeName)!;
  const used = new Set(pods(d).map((p) => p.status.podIP).filter(Boolean));
  for (let host = 5; host < 250; host++) {
    const ip = node.podCIDR.replace(/\.0\/\d+$/, `.${host}`);
    if (!used.has(ip)) return ip;
  }
  return node.podCIDR.replace(/\.0\/\d+$/, '.250');
};

/** Why a container cannot be created yet (missing configuration), or null. */
const configProblem = (d: Draft, pod: PodObject, c: ContainerSpec): string | null => {
  const cm = (name: string) => d.objects.find((o) => o.kind === 'ConfigMap' && o.metadata.name === name && o.metadata.namespace === pod.metadata.namespace);
  for (const e of c.env ?? []) {
    const ref = e.valueFrom?.configMapKeyRef;
    if (!ref) continue;
    const found = cm(ref.name);
    if (!found) return `configmap "${ref.name}" not found`;
    if (found.kind === 'ConfigMap' && !(ref.key in found.data)) return `couldn't find key ${ref.key} in ConfigMap ${pod.metadata.namespace}/${ref.name}`;
  }
  for (const src of c.envFrom ?? []) {
    if (src.configMapRef && !cm(src.configMapRef.name)) return `configmap "${src.configMapRef.name}" not found`;
  }
  return null;
};

const kubelets = (d: Draft) => {
  for (const pod of pods(d)) {
    if (pod.metadata.deletionTime !== undefined) {
      if (d.time - pod.metadata.deletionTime >= TERMINATION_SECONDS) {
        d.objects = d.objects.filter((o) => o !== pod);
        d.changed = true;
      }
      continue;
    }
    const st = pod.status;
    if (st.stage === 'Scheduled') {
      const missingCm = (pod.spec.volumes ?? []).find((v) => v.configMap && !d.objects.some((o) => o.kind === 'ConfigMap' && o.metadata.name === v.configMap!.name));
      if (missingCm) {
        const message = `MountVolume.SetUp failed for volume "${missingCm.name}" : configmap "${missingCm.configMap!.name}" not found`;
        if (st.message !== message) {
          st.message = message;
          emit(d, pod, 'Warning', 'FailedMount', message, 'kubelet');
        }
        st.containerStatuses = pod.spec.containers.map((c) => ({ name: c.name, image: c.image, ready: false, restartCount: 0, state: 'waiting', reason: 'ContainerCreating' }));
        continue;
      }
      st.stage = 'ContainerCreating';
      st.message = undefined;
      st.podIP = podIPFor(d, st.nodeName!);
      st.startTime = d.time;
      st.containerStatuses = pod.spec.containers.map((c) => ({ name: c.name, image: c.image, ready: false, restartCount: 0, state: 'waiting', reason: 'ContainerCreating' }));
      for (const c of pod.spec.containers) emit(d, pod, 'Normal', 'Pulling', `Pulling image "${c.image}"`, 'kubelet');
    } else if (st.stage === 'ContainerCreating') {
      let allStarted = true;
      st.containerStatuses = pod.spec.containers.map((c) => {
        const prev = st.containerStatuses.find((x) => x.name === c.name);
        const restarts = prev?.restartCount ?? 0;
        if (!isValidImage(c.image)) {
          allStarted = false;
          if (prev?.reason !== 'InvalidImageName') emit(d, pod, 'Warning', 'InspectFailed', `Failed to apply default image tag "${c.image}": couldn't parse image name "${c.image}": invalid reference format`, 'kubelet');
          return { name: c.name, image: c.image, ready: false, restartCount: restarts, state: 'waiting', reason: 'InvalidImageName', message: `couldn't parse image name "${c.image}": invalid reference format` };
        }
        const problem = configProblem(d, pod, c);
        if (problem) {
          allStarted = false;
          if (prev?.reason !== 'CreateContainerConfigError' || prev.message !== problem) emit(d, pod, 'Warning', 'Failed', `Error: ${problem}`, 'kubelet');
          return { name: c.name, image: c.image, ready: false, restartCount: restarts, state: 'waiting', reason: 'CreateContainerConfigError', message: problem };
        }
        if (prev?.state === 'running') return prev;
        emit(d, pod, 'Normal', 'Pulled', `Successfully pulled image "${c.image}" (simulated registry)`, 'kubelet');
        emit(d, pod, 'Normal', 'Created', `Created container: ${c.name}`, 'kubelet');
        emit(d, pod, 'Normal', 'Started', `Started container ${c.name}`, 'kubelet');
        return { name: c.name, image: c.image, ready: false, restartCount: restarts, state: 'running', startedAt: d.time };
      });
      d.changed = true;
      if (allStarted) {
        st.stage = 'Running';
        st.phase = 'Running';
      }
    } else if (st.stage === 'Running') {
      const next: ContainerStatus[] = pod.spec.containers.map((c) => {
        const cs = { ...(st.containerStatuses.find((x) => x.name === c.name) ?? { name: c.name, image: c.image, ready: false, restartCount: 0, state: 'running' as const, startedAt: d.time }) };
        const up = d.time - (cs.startedAt ?? d.time);
        if (c.livenessProbe && up >= (c.livenessProbe.initialDelaySeconds ?? 0)) {
          const failure = probeFailure(c, c.livenessProbe);
          if (failure) {
            cs.livenessFailures = (cs.livenessFailures ?? 0) + 1;
            emit(d, pod, 'Warning', 'Unhealthy', `Liveness probe failed: ${failure}`, 'kubelet');
            if (cs.livenessFailures >= (c.livenessProbe.failureThreshold ?? 3)) {
              emit(d, pod, 'Normal', 'Killing', `Container ${c.name} failed liveness probe, will be restarted`, 'kubelet');
              return { ...cs, ready: false, restartCount: cs.restartCount + 1, startedAt: d.time, livenessFailures: 0 };
            }
          } else if (cs.livenessFailures) {
            cs.livenessFailures = 0;
          }
        }
        let ready = true;
        if (c.readinessProbe) {
          const failure = probeFailure(c, c.readinessProbe);
          if (failure) {
            ready = false;
            if (cs.ready || (up > 0 && up % 5 === 1)) emit(d, pod, 'Warning', 'Unhealthy', `Readiness probe failed: ${failure}`, 'kubelet');
          } else {
            ready = up >= Math.max(1, c.readinessProbe.initialDelaySeconds ?? 0);
          }
        }
        return { ...cs, ready };
      });
      if (stableStringify(next) !== stableStringify(st.containerStatuses)) {
        st.containerStatuses = next;
        d.changed = true;
      }
    }
    setConditions(d, pod);
  }
};

const scheduler = (d: Draft) => {
  const workers = d.nodes.filter((n) => n.role === 'worker');
  for (const pod of pods(d)) {
    if (pod.status.stage !== 'Pending' || pod.metadata.deletionTime !== undefined) continue;
    const fail = (message: string) => {
      if (pod.status.message !== message) {
        pod.status.reason = 'Unschedulable';
        pod.status.message = message;
        emit(d, pod, 'Warning', 'FailedScheduling', message, 'default-scheduler');
      }
      setConditions(d, pod);
    };
    const claims = (pod.spec.volumes ?? []).map((v) => v.persistentVolumeClaim?.claimName).filter((c): c is string => !!c);
    const missing = claims.find((c) => !d.objects.some((o) => o.kind === 'PersistentVolumeClaim' && o.metadata.name === c));
    if (missing) {
      fail(`0/${d.nodes.length} nodes are available: persistentvolumeclaim "${missing}" not found. preemption: 0/${d.nodes.length} nodes are available: ${d.nodes.length} Preemption is not helpful for scheduling.`);
      continue;
    }
    if (claims.some((c) => d.objects.some((o) => o.kind === 'PersistentVolumeClaim' && o.metadata.name === c && o.status.phase !== 'Bound'))) {
      fail(`0/${d.nodes.length} nodes are available: pod has unbound immediate PersistentVolumeClaims. preemption: 0/${d.nodes.length} nodes are available: ${d.nodes.length} Preemption is not helpful for scheduling.`);
      continue;
    }
    const need = podRequests(pod.spec);
    const fits = workers
      .map((n) => {
        const used = pods(d)
          .filter((p) => p.status.nodeName === n.name)
          .reduce((u, p) => {
            const r = podRequests(p.spec);
            return { cpu: u.cpu + r.cpuMillis, mem: u.mem + r.memoryMiB };
          }, { cpu: 0, mem: 0 });
        return { node: n, freeCpu: n.cpuMillis - used.cpu, freeMem: n.memoryMiB - used.mem };
      });
    const candidates = fits.filter((x) => x.freeCpu >= need.cpuMillis && x.freeMem >= need.memoryMiB);
    if (candidates.length === 0) {
      const cpuShort = fits.filter((x) => x.freeCpu < need.cpuMillis).length;
      const memShort = fits.filter((x) => x.freeMem < need.memoryMiB).length;
      const reasons = [
        `1 node(s) had untolerated taint {node-role.kubernetes.io/control-plane: }`,
        ...(cpuShort ? [`${cpuShort} Insufficient cpu`] : []),
        ...(memShort ? [`${memShort} Insufficient memory`] : []),
      ];
      fail(`0/${d.nodes.length} nodes are available: ${reasons.join(', ')}.`);
      continue;
    }
    const choice = candidates.sort((a, b) => b.freeCpu - a.freeCpu || a.node.name.localeCompare(b.node.name))[0]!.node;
    pod.status.stage = 'Scheduled';
    pod.status.nodeName = choice.name;
    pod.status.hostIP = choice.internalIP;
    pod.status.reason = undefined;
    pod.status.message = undefined;
    emit(d, pod, 'Normal', 'Scheduled', `Successfully assigned ${pod.metadata.namespace}/${pod.metadata.name} to ${choice.name}`, 'default-scheduler');
    setConditions(d, pod);
  }
};

const provisioner = (d: Draft) => {
  for (const pvc of d.objects) {
    if (pvc.kind !== 'PersistentVolumeClaim' || pvc.status.phase === 'Bound') continue;
    if (pvc.spec.storageClassName !== 'standard') {
      const message = `storageclass.storage.k8s.io "${pvc.spec.storageClassName}" not found`;
      if (!d.events.some((e) => e.object.name === pvc.metadata.name && e.message === message)) {
        emit(d, pvc, 'Warning', 'ProvisioningFailed', message, 'persistentvolume-controller');
      }
      continue;
    }
    pvc.spec.volumeName = `pvc-${pvc.metadata.uid}`;
    pvc.status = { phase: 'Bound', capacity: pvc.spec.resources.requests.storage };
    emit(d, pvc, 'Normal', 'ProvisioningSucceeded', `Successfully provisioned volume ${pvc.spec.volumeName} (simulated: no real disk is created)`, 'standard-provisioner');
  }
};

export const isPodReady = (p: PodObject) => p.status.conditions.some((c) => c.type === 'Ready' && c.status === 'True');

/** Removal order when scaling down: unscheduled, then not ready, then ready; newest first. */
const deletionRank = (p: PodObject) => (!p.status.nodeName ? 0 : !isPodReady(p) ? 1 : 2);

const ownerRefFor = (o: ReplicaSetObject | DeploymentObject): OwnerRef => ({ apiVersion: 'apps/v1', kind: o.kind, name: o.metadata.name, uid: o.metadata.uid, controller: true });

const replicaSetController = (d: Draft) => {
  for (const rs of d.objects) {
    if (rs.kind !== 'ReplicaSet') continue;
    const candidates = pods(d).filter((p) => p.metadata.namespace === rs.metadata.namespace && p.metadata.deletionTime === undefined);
    for (const p of candidates) {
      const ref = controllerOf(p);
      const matches = matchesSelector(p.metadata.labels, rs.spec.selector.matchLabels);
      if (ref?.uid === rs.metadata.uid && !matches) {
        p.metadata.ownerReferences = p.metadata.ownerReferences.filter((r) => r.uid !== rs.metadata.uid);
        d.changed = true;
      } else if (!ref && matches) {
        p.metadata.ownerReferences = [...p.metadata.ownerReferences, ownerRefFor(rs)];
        emit(d, rs, 'Normal', 'Adopted', `Adopted existing pod: ${p.metadata.name} (its labels match the selector)`, 'replicaset-controller');
      }
    }
    const active = candidates.filter((p) => controllerOf(p)?.uid === rs.metadata.uid);
    const diff = rs.spec.replicas - active.length;
    if (diff > 0) {
      for (let i = 0; i < diff; i++) {
        let name = '';
        do name = `${rs.metadata.name}-${hashString(`${rs.metadata.uid}#${nextSeq(d)}`, 5)}`;
        while (d.objects.some((o) => o.kind === 'Pod' && o.metadata.name === name));
        const meta = newMeta(d, name, rs.metadata.namespace, rs.spec.template.metadata.labels, rs.spec.template.metadata.annotations);
        meta.ownerReferences = [ownerRefFor(rs)];
        d.objects.push(newPod(meta, rs.spec.template.spec));
        emit(d, rs, 'Normal', 'SuccessfulCreate', `Created pod: ${name}`, 'replicaset-controller');
      }
    } else if (diff < 0) {
      const victims = [...active].sort((a, b) => deletionRank(a) - deletionRank(b) || b.metadata.creationTime - a.metadata.creationTime || b.metadata.name.localeCompare(a.metadata.name)).slice(0, -diff);
      for (const v of victims) {
        v.metadata.deletionTime = d.time;
        emit(d, rs, 'Normal', 'SuccessfulDelete', `Deleted pod: ${v.metadata.name}`, 'replicaset-controller');
      }
    }
    const owned = pods(d).filter((p) => controllerOf(p)?.uid === rs.metadata.uid && p.metadata.deletionTime === undefined);
    const status = { replicas: owned.length, readyReplicas: owned.filter(isPodReady).length, availableReplicas: owned.filter(isPodReady).length };
    if (stableStringify(status) !== stableStringify(rs.status)) {
      rs.status = status;
      d.changed = true;
    }
  }
};

export const templateHash = (template: unknown) => hashString(stableStringify(template), 10);

const deploymentController = (d: Draft) => {
  for (const dep of d.objects) {
    if (dep.kind !== 'Deployment') continue;
    const hash = templateHash(dep.spec.template);
    const owned = d.objects.filter((o): o is ReplicaSetObject => o.kind === 'ReplicaSet' && controllerOf(o)?.uid === dep.metadata.uid);
    let current = owned.find((rs) => rs.metadata.labels['pod-template-hash'] === hash);
    const scale = (rs: ReplicaSetObject, to: number) => {
      if (rs.spec.replicas === to) return;
      const from = rs.spec.replicas;
      rs.spec.replicas = to;
      rs.metadata.generation += 1;
      emit(d, dep, 'Normal', 'ScalingReplicaSet', `Scaled ${to > from ? 'up' : 'down'} replica set ${rs.metadata.name} from ${from} to ${to}`, 'deployment-controller');
    };
    if (!current) {
      const withHash = (l: Labels) => ({ ...l, 'pod-template-hash': hash });
      const meta = newMeta(d, `${dep.metadata.name}-${hash}`, dep.metadata.namespace, withHash(dep.spec.template.metadata.labels));
      meta.ownerReferences = [ownerRefFor(dep)];
      current = {
        apiVersion: 'apps/v1',
        kind: 'ReplicaSet',
        metadata: meta,
        spec: {
          replicas: 0,
          selector: { matchLabels: withHash(dep.spec.selector.matchLabels) },
          template: { metadata: { ...dep.spec.template.metadata, labels: withHash(dep.spec.template.metadata.labels) }, spec: structuredClone(dep.spec.template.spec) },
        },
        status: { replicas: 0, readyReplicas: 0, availableReplicas: 0 },
      };
      d.objects.push(current);
      d.changed = true;
    }
    const desired = dep.spec.replicas;
    const old = owned.filter((rs) => rs !== current);
    const podsOf = (rs: ReplicaSetObject) => pods(d).filter((p) => controllerOf(p)?.uid === rs.metadata.uid && p.metadata.deletionTime === undefined);
    const oldActive = old.filter((rs) => rs.spec.replicas > 0 || podsOf(rs).length > 0);
    if (oldActive.length === 0) {
      scale(current, desired);
    } else if (dep.spec.strategy.type === 'Recreate') {
      old.forEach((rs) => scale(rs, 0));
      if (old.every((rs) => pods(d).every((p) => controllerOf(p)?.uid !== rs.metadata.uid))) scale(current, desired);
    } else {
      const maxSurge = Math.max(1, Math.ceil(desired * 0.25));
      const oldReplicas = old.reduce((n, rs) => n + rs.spec.replicas, 0);
      const room = desired + maxSurge - oldReplicas - current.spec.replicas;
      if (room > 0) scale(current, Math.min(desired, current.spec.replicas + room));
      const newReady = podsOf(current).filter(isPodReady).length;
      let allowedOld = Math.max(0, desired - newReady);
      for (const rs of [...old].sort((a, b) => b.metadata.creationTime - a.metadata.creationTime)) {
        const keep = Math.min(rs.spec.replicas, allowedOld);
        scale(rs, keep);
        allowedOld -= keep;
      }
    }
    const all = owned.includes(current) ? owned : [...owned, current];
    const allPods = all.flatMap(podsOf);
    const status = {
      replicas: allPods.length,
      updatedReplicas: podsOf(current).length,
      readyReplicas: allPods.filter(isPodReady).length,
      availableReplicas: allPods.filter(isPodReady).length,
      observedGeneration: dep.metadata.generation,
    };
    if (stableStringify(status) !== stableStringify(dep.status)) {
      dep.status = status;
      d.changed = true;
    }
  }
};

/**
 * One pass of every control loop. Returns the same state object when nothing
 * had anything to do, so callers can tell when the cluster has settled.
 */
export const reconcile = (s: SimState): SimState => {
  const d = draftOf(s);
  garbageCollect(d);
  kubelets(d);
  scheduler(d);
  provisioner(d);
  replicaSetController(d);
  deploymentController(d);
  return d.changed ? { ...finish(s, d), pass: s.pass + 1 } : s;
};

/** One simulated second: the clock moves, then every loop runs once. */
export const tick = (s: SimState): SimState => reconcile(advanceClock(s, 1));

/**
 * Ticks until nothing has changed for `quiet` ticks in a row (some steps only
 * wait for time to pass: termination, probe delays), or a bound is reached
 * (e.g. a container restarting forever).
 */
export const settle = (s: SimState, maxTicks = 120, quiet = 12): SimState => {
  let current = s;
  let idle = 0;
  for (let i = 0; i < maxTicks && idle < quiet; i++) {
    const next = tick(current);
    idle = next.objects === current.objects && next.events === current.events ? idle + 1 : 0;
    current = next;
  }
  return current;
};

export const isSettled = (s: SimState) => reconcile(s) === s;

// ---------------------------------------------------------------------------
// Derived views
// ---------------------------------------------------------------------------

export interface Endpoint {
  ip: string;
  port: number;
  podName: string;
  nodeName?: string;
  ready: boolean;
}

/** What the endpoints controller would record for a Service: matching Pods with an IP, ready or not. */
export const serviceEndpoints = (s: SimState, svc: ServiceObject): Endpoint[] => {
  if (!svc.spec.selector) return [];
  const port = svc.spec.ports[0];
  return objectsOf(s, 'Pod')
    .filter((p) => p.metadata.namespace === svc.metadata.namespace && !isDeleting(p) && p.status.podIP && matchesSelector(p.metadata.labels, svc.spec.selector!))
    .map((p) => {
      const target = port ? (typeof port.targetPort === 'number' ? port.targetPort : p.spec.containers.map((c) => resolvePort(c, port.targetPort)).find((x) => x !== undefined)) : undefined;
      return { ip: p.status.podIP!, port: target ?? 0, podName: p.metadata.name, nodeName: p.status.nodeName, ready: isPodReady(p) };
    });
};

/** Resolved environment of a container, as `env` would print it inside. */
export const containerEnv = (s: SimState, pod: PodObject, c: ContainerSpec): Record<string, string> => {
  const env: Record<string, string> = {
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    HOSTNAME: pod.metadata.name,
    KUBERNETES_SERVICE_HOST: '10.96.0.1',
    KUBERNETES_SERVICE_PORT: '443',
  };
  for (const src of c.envFrom ?? []) {
    const cm = src.configMapRef && findObject(s, 'ConfigMap', src.configMapRef.name, pod.metadata.namespace);
    if (cm) Object.assign(env, cm.data);
  }
  for (const e of c.env ?? []) {
    if (e.value !== undefined) env[e.name] = e.value;
    const ref = e.valueFrom?.configMapKeyRef;
    if (ref) {
      const cm = findObject(s, 'ConfigMap', ref.name, pod.metadata.namespace);
      if (cm && ref.key in cm.data) env[e.name] = cm.data[ref.key]!;
    }
  }
  return env;
};

/** The resource a Pod belongs to at the top of its owner chain (Deployment, ReplicaSet), if any. */
export const ownerChain = (s: SimState, o: KObject): KObject[] => {
  const chain: KObject[] = [];
  let ref = controllerOf(o);
  while (ref) {
    const owner = s.objects.find((x) => x.metadata.uid === ref!.uid);
    if (!owner || chain.includes(owner)) break;
    chain.push(owner);
    ref = controllerOf(owner);
  }
  return chain;
};
