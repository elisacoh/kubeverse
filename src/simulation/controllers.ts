/**
 * A deterministic, simplified model of the Deployment and ReplicaSet
 * controllers (loops inside kube-controller-manager), and of what the
 * scheduler and the kubelets then do to the Pods those controllers create.
 *
 * Pure data, no time: the world advances one controller pass at a time, and
 * the same state and intents always produce the same events. Each object
 * moves at most one step per pass, so nothing happens instantly.
 */

export const WEB_IMAGES = ['kubeverse/web:1.0', 'kubeverse/web:2.0'] as const;
export type WebImage = (typeof WEB_IMAGES)[number];

/** What every web Pod asks the scheduler to reserve. */
export const WEB_POD_REQUESTS = { cpuMillis: 1000, memoryMiB: 256 };
export const MAX_REPLICAS = 6;

/**
 * A Pod made by a ReplicaSet, as far as it has gone:
 * pending (no Node) → bound (scheduled) → creating (kubelet asked the runtime)
 * → running (Ready) → terminating (deletion requested) → gone.
 */
export type ManagedPodStage = 'pending' | 'bound' | 'creating' | 'running' | 'terminating';

export interface ManagedPod {
  name: string;
  /** Creation order; never reused, so a replacement always has a new identity. */
  serial: number;
  replicaSet: string;
  stage: ManagedPodStage;
  /** Stage reached before deletion was requested. */
  stoppedFrom?: Exclude<ManagedPodStage, 'terminating'>;
  nodeName?: string;
  /** The scheduler found no Node with room; it keeps retrying on each pass. */
  unschedulable?: boolean;
  /** The deleted Pod whose place it takes (not a Kubernetes field: a teaching aid). */
  replaces?: string;
  createdPass: number;
}

export interface ManagedReplicaSet {
  name: string;
  /** pod-template-hash: derived from the Pod template, so one template ↔ one ReplicaSet. */
  hash: string;
  revision: number;
  image: WebImage;
  /** Desired Pods (spec.replicas), set by the Deployment controller. */
  replicas: number;
  /** Pods deleted from outside that have not been replaced yet. */
  lost: readonly string[];
  createdPass: number;
}

export interface ManagedDeployment {
  name: string;
  /** spec.replicas: the desired state. */
  replicas: number;
  /** The Pod template's only field the learner can change. */
  image: WebImage;
  createdPass: number;
}

export type EventSource = 'kubectl' | 'deployment-controller' | 'replicaset-controller' | 'default-scheduler' | 'kubelet';

export interface ControllerEvent {
  id: number;
  pass: number;
  source: EventSource;
  /** Kubernetes event reason (or the kubectl verb). */
  reason: string;
  object: { kind: 'Deployment' | 'ReplicaSet' | 'Pod'; name: string };
  message: string;
  node?: string;
  warning?: boolean;
}

export interface ControllersState {
  /** Controller passes run so far. */
  pass: number;
  /** The standalone Pod left by Lesson 3: no controller owns it. */
  standalone: { name: string; nodeName: string; stage: 'present' | 'terminating' | 'gone' };
  deployment: ManagedDeployment | null;
  /** In creation order. */
  replicaSets: readonly ManagedReplicaSet[];
  pods: readonly ManagedPod[];
  events: readonly ControllerEvent[];
  /** Last Pod serial handed out. */
  serial: number;
}

/** Free CPU of a worker Node, before counting the Pods this model manages. */
export interface NodeRoom {
  name: string;
  freeCpuMillis: number;
}

export const initialControllers = (standalone: { name: string; nodeName: string }): ControllersState => ({
  pass: 0,
  standalone: { ...standalone, stage: 'present' },
  deployment: null,
  replicaSets: [],
  pods: [],
  events: [],
  serial: 0,
});

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** The characters Kubernetes uses for generated name suffixes (no vowels, no look-alikes). */
const ALPHABET = 'bcdfghjklmnpqrstvwxz2456789';

const randomish = (seed: string, length: number) => {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  let out = '';
  for (let i = 0; i < length; i++) {
    h = (Math.imul(h, 1103515245) + 12345) >>> 0;
    out += ALPHABET[(h >>> 16) % ALPHABET.length];
  }
  return out;
};

export const templateHash = (deployment: string, image: string) => randomish(`${deployment}|${image}`, 10);
const podSuffix = (replicaSet: string, serial: number) => randomish(`${replicaSet}#${serial}`, 5);

// ---------------------------------------------------------------------------
// Derived state
// ---------------------------------------------------------------------------

/**
 * Rolling-update bounds from the defaults (25% each): surge rounds up,
 * unavailability rounds down. With 2 replicas: at most 3 Pods, at least 2 available.
 */
export const rollingLimits = (replicas: number) => {
  const maxSurge = Math.ceil(replicas * 0.25);
  const maxUnavailable = Math.floor(replicas * 0.25);
  // Kubernetes refuses 0/0: it could never make progress.
  return maxSurge === 0 && maxUnavailable === 0 ? { maxSurge: 0, maxUnavailable: 1 } : { maxSurge, maxUnavailable };
};

/** The ReplicaSet whose template matches the Deployment's current template. */
export const currentReplicaSet = (s: ControllersState): ManagedReplicaSet | undefined =>
  s.deployment ? s.replicaSets.find((rs) => rs.image === s.deployment!.image) : undefined;

const isActive = (p: ManagedPod) => p.stage !== 'terminating';
const isAvailable = (p: ManagedPod) => p.stage === 'running';

export const podsOf = (s: ControllersState, replicaSet: string) => s.pods.filter((p) => p.replicaSet === replicaSet);

export interface ReplicaCounts {
  /** spec.replicas */
  desired: number;
  /** Pod objects that exist and are not terminating, Pending included. */
  current: number;
  ready: number;
  available: number;
  terminating: number;
  unschedulable: number;
}

export const replicaSetCounts = (s: ControllersState, rs: ManagedReplicaSet): ReplicaCounts => {
  const pods = podsOf(s, rs.name);
  return {
    desired: rs.replicas,
    current: pods.filter(isActive).length,
    ready: pods.filter(isAvailable).length,
    available: pods.filter(isAvailable).length,
    terminating: pods.filter((p) => !isActive(p)).length,
    unschedulable: pods.filter((p) => isActive(p) && p.unschedulable).length,
  };
};

export interface DeploymentCounts extends ReplicaCounts {
  /** Pods from the current template. */
  updated: number;
  /** Pods from older templates, still active. */
  old: number;
}

export const deploymentCounts = (s: ControllersState): DeploymentCounts | null => {
  if (!s.deployment) return null;
  const current = currentReplicaSet(s);
  const active = s.pods.filter(isActive);
  return {
    desired: s.deployment.replicas,
    current: active.length,
    ready: active.filter(isAvailable).length,
    available: active.filter(isAvailable).length,
    terminating: s.pods.length - active.length,
    unschedulable: active.filter((p) => p.unschedulable).length,
    updated: active.filter((p) => p.replicaSet === current?.name).length,
    old: active.filter((p) => p.replicaSet !== current?.name).length,
  };
};

/** Older ReplicaSets still have desired or existing Pods. */
export const rolloutInProgress = (s: ControllersState): boolean => {
  const current = currentReplicaSet(s);
  if (!s.deployment) return false;
  if (!current) return true;
  return s.replicaSets.some((rs) => rs !== current && (rs.replicas > 0 || podsOf(s, rs.name).length > 0));
};

/** The rollout is finished: only the current template's Pods remain, all available. */
export const rolloutComplete = (s: ControllersState): boolean => {
  const counts = deploymentCounts(s);
  const current = currentReplicaSet(s);
  return (
    !!counts &&
    !!current &&
    !rolloutInProgress(s) &&
    current.replicas === counts.desired &&
    counts.updated === counts.desired &&
    counts.available === counts.desired &&
    counts.terminating === 0
  );
};

export const findManagedPod = (s: ControllersState, name: string) => s.pods.find((p) => p.name === name);

// ---------------------------------------------------------------------------
// Intents, each recorded the way kubectl would send it
// ---------------------------------------------------------------------------

type Draft = Omit<ControllersState, 'events'> & { events: ControllerEvent[] };

const record = (d: Draft, e: Omit<ControllerEvent, 'id' | 'pass'>, pass = d.pass) => {
  d.events.push({ ...e, id: d.events.length + 1, pass });
};

const withEvent = (s: ControllersState, patch: Partial<ControllersState>, e: Omit<ControllerEvent, 'id' | 'pass'>) => {
  const d: Draft = { ...s, ...patch, events: [...s.events] };
  record(d, e);
  return d as ControllersState;
};

/** `kubectl delete pod` on the standalone Pod: its deletion starts; nothing will recreate it. */
export const deleteStandalone = (s: ControllersState): ControllersState => {
  if (s.standalone.stage !== 'present') return s;
  return withEvent(
    s,
    { standalone: { ...s.standalone, stage: 'terminating' } },
    {
      source: 'kubectl',
      reason: 'Delete',
      object: { kind: 'Pod', name: s.standalone.name },
      message: `kubectl delete pod ${s.standalone.name}: the API server marks it for deletion.`,
    },
  );
};

export const createDeployment = (s: ControllersState, name: string, image: WebImage, replicas: number): ControllersState => {
  if (s.deployment) return s;
  return withEvent(
    s,
    { deployment: { name, image, replicas, createdPass: s.pass } },
    {
      source: 'kubectl',
      reason: 'Create',
      object: { kind: 'Deployment', name },
      message: `kubectl apply: Deployment ${name} stored (replicas: ${replicas}, image: ${image}).`,
    },
  );
};

/** `kubectl delete pod` on a Pod owned by a ReplicaSet. */
export const deleteManagedPod = (s: ControllersState, name: string): ControllersState => {
  const pod = findManagedPod(s, name);
  if (!pod || pod.stage === 'terminating') return s;
  const stoppedFrom = pod.stage;
  return withEvent(
    s,
    {
      pods: s.pods.map((p) => (p === pod ? { ...p, stage: 'terminating' as const, stoppedFrom } : p)),
      replicaSets: s.replicaSets.map((rs) => (rs.name === pod.replicaSet ? { ...rs, lost: [...rs.lost, name] } : rs)),
    },
    {
      source: 'kubectl',
      reason: 'Delete',
      object: { kind: 'Pod', name },
      message: `kubectl delete pod ${name}: the API server marks it for deletion.`,
    },
  );
};

/** `kubectl scale`: only spec.replicas changes — the template, and so the ReplicaSet, stay the same. */
export const scaleDeployment = (s: ControllersState, replicas: number): ControllersState => {
  if (!s.deployment || s.deployment.replicas === replicas) return s;
  return withEvent(
    s,
    { deployment: { ...s.deployment, replicas } },
    {
      source: 'kubectl',
      reason: 'Scale',
      object: { kind: 'Deployment', name: s.deployment.name },
      message: `kubectl scale: desired replicas ${s.deployment.replicas} → ${replicas}. The template is unchanged.`,
    },
  );
};

/** `kubectl set image`: the Pod template changes, which calls for a ReplicaSet with that template. */
export const updateImage = (s: ControllersState, image: WebImage): ControllersState => {
  if (!s.deployment || s.deployment.image === image) return s;
  return withEvent(
    s,
    { deployment: { ...s.deployment, image } },
    {
      source: 'kubectl',
      reason: 'SetImage',
      object: { kind: 'Deployment', name: s.deployment.name },
      message: `kubectl set image: Pod template image ${s.deployment.image} → ${image}.`,
    },
  );
};

// ---------------------------------------------------------------------------
// One pass of every loop
// ---------------------------------------------------------------------------

/** Which Pods a ReplicaSet removes first: unscheduled, then not ready, then ready; newest first. */
const deletionRank = (p: ManagedPod) => (!p.nodeName ? 0 : p.stage !== 'running' ? 1 : 2);

/**
 * Runs, in order, the kubelets, the scheduler, the ReplicaSet controller and
 * the Deployment controller once. Returns the same object when every loop
 * found nothing to do, so callers can tell when the world has settled.
 */
export const syncControllers = (s: ControllersState, rooms: readonly NodeRoom[]): ControllersState => {
  const pass = s.pass + 1;
  const d: Draft = {
    ...s,
    pass,
    pods: s.pods.map((p) => ({ ...p })),
    replicaSets: s.replicaSets.map((rs) => ({ ...rs })),
    events: [...s.events],
  };
  const pods = d.pods as ManagedPod[];
  const replicaSets = d.replicaSets as ManagedReplicaSet[];
  let changed = false;
  const emit = (e: Omit<ControllerEvent, 'id' | 'pass'>) => {
    record(d, e, pass);
    changed = true;
  };

  // 1. Kubelets: each one acts on the Pods bound to its own Node.
  if (s.standalone.stage === 'terminating') {
    d.standalone = { ...s.standalone, stage: 'gone' };
    emit({
      source: 'kubelet',
      reason: 'Killing',
      object: { kind: 'Pod', name: s.standalone.name },
      node: s.standalone.nodeName,
      message: `Stopped container web. Pod ${s.standalone.name} is removed from the API. No controller owns it: nothing recreates it.`,
    });
  }
  for (let i = pods.length - 1; i >= 0; i--) {
    const p = pods[i]!;
    if (p.stage !== 'terminating') continue;
    pods.splice(i, 1);
    emit({
      source: 'kubelet',
      reason: 'Killing',
      object: { kind: 'Pod', name: p.name },
      node: p.nodeName,
      message: p.stoppedFrom === 'running' || p.stoppedFrom === 'creating'
        ? `Stopped container web. Pod ${p.name} is gone.`
        : `Pod ${p.name} is gone (no container was running).`,
    });
  }
  for (const p of pods) {
    if (p.stage === 'creating') {
      p.stage = 'running';
      emit({ source: 'kubelet', reason: 'Started', object: { kind: 'Pod', name: p.name }, node: p.nodeName, message: 'Started container web. The Pod is Ready.' });
    } else if (p.stage === 'bound') {
      p.stage = 'creating';
      const image = replicaSets.find((rs) => rs.name === p.replicaSet)?.image ?? '';
      emit({
        source: 'kubelet',
        reason: 'Pulling',
        object: { kind: 'Pod', name: p.name },
        node: p.nodeName,
        message: `Noticed a Pod bound to this Node. Asked the runtime, through CRI, to pull ${image} and create the container.`,
      });
    }
  }

  // 2. Scheduler: Pods without a Node, oldest first. Pods still terminating hold their room.
  const used = new Map<string, number>();
  for (const p of pods) if (p.nodeName) used.set(p.nodeName, (used.get(p.nodeName) ?? 0) + WEB_POD_REQUESTS.cpuMillis);
  for (const p of pods) {
    if (p.stage !== 'pending') continue;
    const choice = rooms
      .map((r) => ({ name: r.name, free: r.freeCpuMillis - (used.get(r.name) ?? 0) }))
      .filter((r) => r.free >= WEB_POD_REQUESTS.cpuMillis)
      .sort((a, b) => b.free - a.free || a.name.localeCompare(b.name))[0];
    if (!choice) {
      if (!p.unschedulable) {
        p.unschedulable = true;
        emit({
          source: 'default-scheduler',
          reason: 'FailedScheduling',
          object: { kind: 'Pod', name: p.name },
          warning: true,
          message: `0/${rooms.length} worker Nodes are available: Insufficient cpu. The Pod stays Pending; the scheduler will retry.`,
        });
      }
      continue;
    }
    p.stage = 'bound';
    p.nodeName = choice.name;
    p.unschedulable = false;
    used.set(choice.name, (used.get(choice.name) ?? 0) + WEB_POD_REQUESTS.cpuMillis);
    emit({
      source: 'default-scheduler',
      reason: 'Scheduled',
      object: { kind: 'Pod', name: p.name },
      node: choice.name,
      message: `Successfully assigned default/${p.name} to ${choice.name}.`,
    });
  }

  // 3. ReplicaSet controller: Pod objects, through the API server. It starts no container.
  for (const rs of replicaSets) {
    const active = pods.filter((p) => p.replicaSet === rs.name && isActive(p));
    const diff = rs.replicas - active.length;
    if (diff > 0) {
      const lost = [...rs.lost];
      for (let i = 0; i < diff; i++) {
        d.serial += 1;
        const name = `${rs.name}-${podSuffix(rs.name, d.serial)}`;
        const replaces = lost.shift();
        pods.push({ name, serial: d.serial, replicaSet: rs.name, stage: 'pending', createdPass: pass, ...(replaces ? { replaces } : {}) });
        emit({
          source: 'replicaset-controller',
          reason: 'SuccessfulCreate',
          object: { kind: 'ReplicaSet', name: rs.name },
          message: replaces
            ? `Created pod: ${name} (desired ${rs.replicas}, found ${active.length + i}). A new Pod — ${replaces} is not coming back.`
            : `Created pod: ${name} (desired ${rs.replicas}, found ${active.length + i}).`,
        });
      }
      rs.lost = lost;
    } else {
      if (rs.lost.length) {
        rs.lost = [];
        changed = true;
      }
      if (diff < 0) {
        const victims = [...active].sort((a, b) => deletionRank(a) - deletionRank(b) || b.serial - a.serial).slice(0, -diff);
        for (const v of victims) {
          v.stoppedFrom = v.stage === 'terminating' ? v.stoppedFrom : v.stage;
          v.stage = 'terminating';
          emit({
            source: 'replicaset-controller',
            reason: 'SuccessfulDelete',
            object: { kind: 'ReplicaSet', name: rs.name },
            message: `Deleted pod: ${v.name} (desired ${rs.replicas}, found ${active.length}).`,
          });
        }
      }
    }
  }

  // 4. Deployment controller: ReplicaSets, never Pods.
  const dep = d.deployment;
  if (dep) {
    const scaled = (rs: ManagedReplicaSet, to: number) => {
      const from = rs.replicas;
      rs.replicas = to;
      emit({
        source: 'deployment-controller',
        reason: 'ScalingReplicaSet',
        object: { kind: 'Deployment', name: dep.name },
        message: `Scaled ${to > from ? 'up' : 'down'} replica set ${rs.name} from ${from} to ${to}.`,
      });
    };
    const maxRevision = replicaSets.reduce((m, rs) => Math.max(m, rs.revision), 0);
    let current = replicaSets.find((rs) => rs.image === dep.image);
    const others = () => replicaSets.filter((rs) => rs !== current);
    if (!current) {
      const hash = templateHash(dep.name, dep.image);
      const first = others().every((rs) => rs.replicas === 0 && !pods.some((p) => p.replicaSet === rs.name));
      current = { name: `${dep.name}-${hash}`, hash, revision: maxRevision + 1, image: dep.image, replicas: 0, lost: [], createdPass: pass };
      replicaSets.push(current);
      emit({
        source: 'deployment-controller',
        reason: 'ScalingReplicaSet',
        object: { kind: 'Deployment', name: dep.name },
        message: `New Pod template: created replica set ${current.name} (revision ${current.revision}).`,
      });
      if (first) scaled(current, dep.replicas);
    } else if (current.revision < maxRevision) {
      // Going back to an earlier template reuses its ReplicaSet as the newest revision.
      current.revision = maxRevision + 1;
      emit({
        source: 'deployment-controller',
        reason: 'ScalingReplicaSet',
        object: { kind: 'Deployment', name: dep.name },
        message: `The template matches replica set ${current.name} again: it becomes revision ${current.revision}.`,
      });
    }

    const old = others().filter((rs) => rs.replicas > 0);
    if (old.length === 0) {
      if (current.replicas !== dep.replicas) scaled(current, dep.replicas);
    } else {
      const { maxSurge, maxUnavailable } = rollingLimits(dep.replicas);
      const total = replicaSets.reduce((n, rs) => n + rs.replicas, 0);
      const up = Math.min(dep.replicas + maxSurge - total, dep.replicas - current.replicas);
      if (up > 0) scaled(current, current.replicas + up);
      else if (current.replicas > dep.replicas) scaled(current, dep.replicas);

      const ours = pods.filter((p) => isActive(p) && replicaSets.some((rs) => rs.name === p.replicaSet));
      const available = ours.filter(isAvailable).length;
      const newUnavailable = current.replicas - ours.filter((p) => p.replicaSet === current!.name && isAvailable(p)).length;
      const minAvailable = dep.replicas - maxUnavailable;
      const allReplicas = replicaSets.reduce((n, rs) => n + rs.replicas, 0);
      let down = Math.min(allReplicas - minAvailable - newUnavailable, available - minAvailable);
      for (const rs of [...old].sort((a, b) => a.createdPass - b.createdPass)) {
        if (down <= 0) break;
        const by = Math.min(down, rs.replicas);
        scaled(rs, rs.replicas - by);
        down -= by;
      }
    }
  }

  return changed ? (d as ControllersState) : s;
};

/** Every loop agrees with what it sees: nothing left to do until something changes. */
export const isSettled = (s: ControllersState, rooms: readonly NodeRoom[]) => syncControllers(s, rooms) === s;
