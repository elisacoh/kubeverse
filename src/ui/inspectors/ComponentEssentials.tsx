import { useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight, Cog, Database, Network, Play, X } from 'lucide-react';
import type { ControlPlaneComponent } from '../../domain/types';
import { buildManifest } from '../../domain/manifest';
import { findPod, fitsOnNode, podRequests, unscheduledPod } from '../../domain/selectors';
import { buildActionLabel, canPerform } from '../../learning/engine';
import { requestManifestYaml, storedLineMark } from '../../learning/podRequest';
import { REQUEST_POD_UID, podNameError, schedulerChoice } from '../../learning/sandbox';
import { useLearningStore } from '../../learning/useLearningStore';
import type { BuildActionKind } from '../../learning/types';
import { useAppStore } from '../../state/useAppStore';
import { conditionColor, palette } from '../../scene/palette';
import { currentReplicaSet, deploymentCounts } from '../../simulation/controllers';
import { PanelHeader, Section } from './parts';
import { YamlBlock } from './ManifestView';

const ROLE: Record<ControlPlaneComponent['type'], { kind: string; icon: ReactNode; accent: string; text: ReactNode }> = {
  'kube-apiserver': {
    kind: 'Control plane · API server',
    icon: <Network className="size-5" />,
    accent: palette.gold,
    text: (
      <>
        The <b className="text-gold">entry point to the Kubernetes API</b>. kubectl, the scheduler and every kubelet read
        and write cluster state through it. It processes API requests — it never runs containers.
      </>
    ),
  },
  etcd: {
    kind: 'Control plane · state store',
    icon: <Database className="size-5" />,
    accent: palette.lavender,
    text: (
      <>
        A consistent <b className="text-lavender">key-value store</b> holding the cluster’s state. Only the API server
        reads and writes it. It stores — it never schedules or launches anything.
      </>
    ),
  },
  'kube-scheduler': {
    kind: 'Control plane · scheduler',
    icon: <Cog className="size-5" />,
    accent: palette.cyan,
    text: (
      <>
        Watches the API server for Pods <b className="text-cyan">without a Node</b> and picks one for each. It records
        its choice through the API server. It never starts containers.
      </>
    ),
  },
  'kube-controller-manager': {
    kind: 'Control plane · controllers',
    icon: <Cog className="size-5" />,
    accent: palette.teal,
    text: (
      <>
        Runs the <b className="text-teal">controllers</b>: control loops that watch objects through the API server and act
        until what exists matches what was asked for. They are loops inside this one process — not Pods.
      </>
    ),
  },
  'cloud-controller-manager': {
    kind: 'Control plane · cloud',
    icon: <Cog className="size-5" />,
    accent: palette.teal,
    text: <>Connects the cluster to a cloud provider’s APIs.</>,
  },
};

/** The control-plane component, as Lesson 3 introduces it: what it does, and what it is doing to your Pod. */
export function ComponentEssentials({ component }: { component: ControlPlaneComponent }) {
  const role = ROLE[component.type];
  return (
    <>
      <PanelHeader kind={role.kind} title={component.type} icon={role.icon} accent={role.accent}>
        <span className="chip">part of the control plane</span>
      </PanelHeader>
      <p className="text-[12px] leading-relaxed text-lavender/85">{role.text}</p>
      {component.type === 'kube-apiserver' && <ApiServerWork />}
      {component.type === 'etcd' && <EtcdContents />}
      {component.type === 'kube-scheduler' && <SchedulerWork />}
      {component.type === 'kube-controller-manager' && <ControllerManagerWork />}
      <HowItRuns component={component} />
    </>
  );
}

/** Lesson 4: which loops act on what — and that nothing owned the standalone Pod. */
function ControllerManagerWork() {
  const controllers = useLearningStore((s) => s.session?.world.controllers);
  if (!controllers) return null;
  const counts = deploymentCounts(controllers);
  const current = currentReplicaSet(controllers);
  const standalone = controllers.standalone;
  return (
    <Section title="Its control loops, right now">
      <ul className="space-y-2">
        <Step state={counts ? 'done' : 'todo'} title="Deployment controller">
          {controllers.deployment
            ? `Watches Deployment ${controllers.deployment.name}: wants template revision ${current?.revision ?? '…'}, manages its ReplicaSets.`
            : 'Watches Deployments. There are none.'}
        </Step>
        <Step state={counts ? 'done' : 'todo'} title="ReplicaSet controller">
          {current && counts
            ? `Watches ReplicaSet ${current.name}: desired ${current.replicas}, ${counts.updated} Pod${counts.updated === 1 ? '' : 's'} found.`
            : 'Watches ReplicaSets and the Pods they own. There are none.'}
        </Step>
        <Step state="todo" title="…and many more">Node, Job, EndpointSlice, namespace and garbage-collection controllers, among others.</Step>
      </ul>
      <p className="mt-2.5 rounded-lg border border-warn/25 bg-warn/[0.06] px-2.5 py-2 text-[11.5px] leading-relaxed text-lavender/85">
        {standalone.stage === 'present'
          ? `${standalone.name} has no ownerReferences: none of these loops is responsible for it.`
          : `${standalone.name} had no ownerReferences: no loop was responsible for it, so none recreated it. What if you could tell Kubernetes how many Pods you always want?`}
      </p>
    </Section>
  );
}

function ActionButton({ kind }: { kind: BuildActionKind }) {
  const lesson = useLearningStore((s) => s.lesson);
  const session = useLearningStore((s) => s.session);
  const perform = useLearningStore((s) => s.perform);
  if (!lesson || !session || !canPerform(lesson, session, kind)) return null;
  return (
    <button type="button" className="primary-btn mt-2.5 w-full justify-center" onClick={() => perform(kind)}>
      <Play className="size-3.5" />
      {buildActionLabel(session, kind)}
    </button>
  );
}

type StepState = 'done' | 'failed' | 'todo';

function Step({ state, title, children }: { state: StepState; title: string; children?: ReactNode }) {
  const color = state === 'done' ? conditionColor.ok : state === 'failed' ? conditionColor.failed : 'rgb(179 164 255 / 0.45)';
  return (
    <li className="flex gap-2">
      <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full" style={{ border: `1.5px solid ${color}` }}>
        {state === 'done' && <Check className="size-2.5" style={{ color }} />}
        {state === 'failed' && <X className="size-2.5" style={{ color }} />}
      </span>
      <div className="min-w-0">
        <div className={`text-[12px] ${state === 'todo' ? 'text-lavender/60' : 'text-white'}`}>{title}</div>
        {children && <div className="text-[11px] leading-snug text-lavender/65">{children}</div>}
      </div>
    </li>
  );
}

function ApiServerWork() {
  const req = useLearningStore((s) => s.session?.world.request);
  if (!req) {
    return (
      <Section title="Requests">
        <p className="text-[11.5px] text-lavender/70">No request from you yet.</p>
      </Section>
    );
  }
  const processed = req.stage !== 'submitted';
  const rejected = req.stage === 'rejected';
  const error = podNameError(req.name);
  const pass: StepState = processed ? 'done' : 'todo';

  return (
    <Section title={processed ? 'Your request' : 'Incoming request'}>
      <div className="rounded-lg bg-black/25 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-white/90">
        <div>
          <span className="text-gold">POST</span> /api/v1/namespaces/default/pods
        </div>
        <div className="text-lavender/70">
          from kubectl · Pod <span className="text-white">{req.name}</span> · {req.image}
        </div>
      </div>
      <ol className="mt-2.5 space-y-1.5">
        <Step state={pass} title="Authentication">Who is calling?</Step>
        <Step state={pass} title="Authorization">May they create Pods here?</Step>
        <Step state={pass} title="Admission control">Do policies adjust or refuse it?</Step>
        <Step state={processed ? (rejected ? 'failed' : 'done') : 'todo'} title="Validation">
          {rejected ? error : 'Is this a well-formed Pod?'}
        </Step>
        <Step state={processed && !rejected ? 'done' : rejected ? 'failed' : 'todo'} title="Store in etcd">
          {rejected ? 'Nothing was stored.' : 'Only accepted requests are persisted.'}
        </Step>
      </ol>
      {rejected && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-[#ff9b9b]">
          Error from server (Invalid). Fix the name in your Pod definition and apply it again.
        </p>
      )}
      <ActionButton kind="process-request" />
      <p className="mt-2 text-[11px] leading-relaxed text-lavender/60">
        Authentication, authorization (RBAC) and admission are only acknowledged here; later lessons cover them.
      </p>
    </Section>
  );
}

function EtcdContents() {
  const cluster = useAppStore((s) => s.cluster);
  const req = useLearningStore((s) => s.session?.world.request);
  const [view, setView] = useState<'stored' | 'sent'>('stored');
  const pod = findPod(cluster, REQUEST_POD_UID);
  const stored = pod ? buildManifest(cluster, { kind: 'pod', uid: pod.metadata.uid }) : null;

  if (!req || !pod || !stored) {
    return (
      <Section title="Stored objects">
        <p className="text-[11.5px] leading-relaxed text-lavender/70">
          Every Node, Pod and other API object lives here — {cluster.pods.length} Pods so far.{' '}
          {req ? 'Your Pod is not stored: the API server has not accepted it.' : ''}
        </p>
      </Section>
    );
  }
  const sent = requestManifestYaml(req.name, req.image);

  return (
    <Section title="Your Pod, as stored">
      <div className="mb-2 font-mono text-[11px] text-lavender/80">/registry/pods/default/{pod.metadata.name}</div>
      <div role="tablist" className="mb-2 flex gap-1 rounded-lg bg-white/[0.04] p-0.5">
        {(
          [
            ['stored', 'Stored in etcd'],
            ['sent', 'What you sent'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            onClick={() => setView(id)}
            className={`flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition ${
              view === id ? 'bg-white/[0.1] text-white' : 'text-lavender/65 hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {view === 'stored' ? <YamlBlock yaml={stored.yaml} mark={storedLineMark(sent)} /> : <YamlBlock yaml={sent} />}
      {view === 'stored' && (
        <ul className="mt-2 space-y-1 text-[11px] leading-snug text-lavender/75">
          <li>
            <span className="mr-1.5 inline-block size-2 rounded-sm bg-gold/70" />
            Added by the API server: identity (uid, timestamp) and defaults.
          </li>
          <li>
            <span className="mr-1.5 inline-block size-2 rounded-sm bg-cyan/70" />
            <b className="text-white">status</b> — what has been observed. <b className="text-white">spec</b> — what you
            want.
          </li>
        </ul>
      )}
      <p className="mt-2 text-[11.5px] leading-relaxed text-white/90">
        {pod.nodeName
          ? pod.phase === 'Running'
            ? `Now bound to ${pod.nodeName} and reported Running by its kubelet.`
            : `Now bound to ${pod.nodeName} (spec.nodeName), still Pending.`
          : 'Phase Pending, no spec.nodeName: stored is not running. No container exists yet.'}
      </p>
      <p className="mt-1.5 text-[11px] text-lavender/55">Shown as YAML for readability; etcd stores a binary encoding.</p>
    </Section>
  );
}

function SchedulerWork() {
  const cluster = useAppStore((s) => s.cluster);
  const dispatch = useLearningStore((s) => s.dispatch);
  const [prediction, setPrediction] = useState<{ node: string; correct: boolean } | null>(null);
  const waiting = unscheduledPod(cluster);
  const mine = findPod(cluster, REQUEST_POD_UID);
  const workers = cluster.nodes.filter((n) => n.role === 'worker');

  if (!waiting) {
    return (
      <Section title="Pods waiting for a Node">
        <p className="text-[11.5px] leading-relaxed text-lavender/75">
          {mine?.nodeName ? (
            <>
              None. It chose <b className="text-white">{mine.nodeName}</b> for {mine.metadata.name} and recorded a Binding
              through the API server. From here, the kubelet on {mine.nodeName} takes over — the scheduler never starts
              containers.
            </>
          ) : (
            'None right now.'
          )}
        </p>
      </Section>
    );
  }
  const need = podRequests(waiting);
  const choice = schedulerChoice(cluster, waiting.metadata.uid);

  const predict = (node: string) => {
    const correct = node === choice;
    setPrediction({ node, correct });
    dispatch({ type: 'SCHEDULING_PREDICTED', podId: waiting.metadata.uid, nodeId: node, correct });
  };

  return (
    <Section title="Pods waiting for a Node">
      <p className="text-[11.5px] leading-relaxed text-lavender/80">
        <b className="font-mono text-white">{waiting.metadata.name}</b> has no spec.nodeName. It requests{' '}
        {need.cpuMillis / 1000} CPU and {need.memoryMiB} MiB of memory.
      </p>
      <div className="mt-2.5 text-[11px] uppercase tracking-[0.12em] text-lavender/60">Your prediction</div>
      <div className="mt-1 flex gap-1.5">
        {workers.map((n) => (
          <button
            key={n.metadata.uid}
            type="button"
            onClick={() => predict(n.metadata.name)}
            className={`hud-btn flex-1 justify-center !py-1.5 font-mono text-[11.5px] ${
              prediction?.node === n.metadata.name ? '!border-cyan/60 text-white' : ''
            }`}
          >
            {n.metadata.name}
          </button>
        ))}
      </div>
      {prediction && (
        <p
          className="mt-2 text-[11.5px] leading-relaxed"
          style={{ color: prediction.correct ? conditionColor.ok : '#ff9b9b' }}
        >
          {prediction.correct
            ? `Right: ${prediction.node} has enough free capacity left.`
            : `${prediction.node} ${fitsOnNode(cluster, waiting, prediction.node) ? 'fits, but has less room left than another Node.' : 'does not have enough free capacity left.'}`}
        </p>
      )}
      <ActionButton kind="schedule-pod" />
      <p className="mt-2 text-[11px] leading-relaxed text-lavender/60">
        Simplified: one rule — enough free capacity, then the most free CPU. Real scheduling filters Nodes, then scores
        them, with many more rules (Lesson 8).
      </p>
    </Section>
  );
}

function HowItRuns({ component }: { component: ControlPlaneComponent }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="border-t border-white/[0.06] pt-2.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1 text-[11px] uppercase tracking-[0.12em] text-lavender/65 hover:text-lavender"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        How does it run?
      </button>
      {open && (
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-lavender/75">
          On {component.nodeName}, as a <b className="text-gold">static Pod</b>: in kubeadm-style clusters, that Node’s own
          kubelet starts it from a file in /etc/kubernetes/manifests. The control plane is a set of such components —
          not one Pod.
        </p>
      )}
    </section>
  );
}
