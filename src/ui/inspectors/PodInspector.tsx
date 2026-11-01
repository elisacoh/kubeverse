import { ArrowUpLeft, Box, FlaskConical, ScanSearch, Trash2 } from 'lucide-react';
import { buildActionLabel, canPerform } from '../../learning/engine';
import { REQUEST_POD_UID, labActionFor } from '../../learning/sandbox';
import { managedPodUid } from '../../learning/controllerObjects';
import { useLearningStore } from '../../learning/useLearningStore';
import type { Container, OwnerReference, Pod } from '../../domain/types';
import {
  ORIGIN_EXPLAINER,
  ORIGIN_LABEL,
  componentForPod,
  controllerRef,
  findPod,
  ownerChain,
  podCondition,
  podStatusText,
  readyCount,
  restartTotal,
} from '../../domain/selectors';
import { useAppStore } from '../../state/useAppStore';
import { conditionColor, namespaceColorOf, palette } from '../../scene/palette';
import { Fact, Facts, Labels, LinkButton, PanelHeader, Section } from './parts';

export function PodInspector({ uid }: { uid: string }) {
  const essentials = useAppStore((s) => s.presentation.inspector === 'essentials');
  return essentials ? <PodEssentials uid={uid} /> : <FullPodInspector uid={uid} />;
}

function InsideButton({ pod }: { pod: Pod }) {
  const view = useAppStore((s) => s.view);
  const transition = useAppStore((s) => s.transition);
  const exploreInside = useAppStore((s) => s.exploreInside);
  const exitPod = useAppStore((s) => s.exitPod);
  const inside = view.kind === 'pod' && view.podUid === pod.metadata.uid;
  return inside ? (
    <button
      type="button"
      onClick={() => exitPod('node')}
      disabled={transition !== null}
      className="hud-btn justify-center !rounded-xl !bg-white/[0.06] !py-2.5"
    >
      <ArrowUpLeft className="size-4" /> Back to Node {pod.nodeName}
    </button>
  ) : (
    <button
      type="button"
      onClick={() => exploreInside(pod.metadata.uid)}
      disabled={transition !== null}
      className="group flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-teal/90 to-cyan/90 px-3 py-2.5 text-sm font-semibold text-[#06202a] shadow-[0_8px_24px_-10px_rgba(63,212,192,0.8)] transition hover:brightness-110 disabled:opacity-50"
    >
      <ScanSearch className="size-4" /> Explore inside
      <span className="text-[10px] font-medium opacity-60">Enter ↵</span>
    </button>
  );
}

const PHASE_COLOR: Record<Pod['phase'], string> = {
  Pending: conditionColor.warning,
  Running: conditionColor.ok,
  Succeeded: conditionColor.done,
  Failed: conditionColor.failed,
  Unknown: conditionColor.failed,
};

/** Identity, containers and phase only — for lessons that have not introduced QoS, owners or labels. */
function PodEssentials({ uid }: { uid: string }) {
  const cluster = useAppStore((s) => s.cluster);
  const view = useAppStore((s) => s.view);
  const focusNode = useAppStore((s) => s.focusNode);
  const selectContainer = useAppStore((s) => s.selectContainer);
  const clearSelection = useAppStore((s) => s.clearSelection);
  const lessonWithControllers = useLearningStore((s) => !!s.session?.world.controllers);
  const pod = findPod(cluster, uid);
  if (!pod) return null;
  const inside = view.kind === 'pod' && view.podUid === uid;
  const nsColor = namespaceColorOf(pod.metadata.namespace);
  const phaseColor = PHASE_COLOR[pod.phase];
  const chain = ownerChain(cluster, pod);

  return (
    <>
      <PanelHeader kind="Pod" title={pod.metadata.name} icon={<Box className="size-5" />} accent={nsColor} onClose={clearSelection}>
        <span className="chip" style={{ color: phaseColor }}>
          <span className="size-1.5 rounded-full" style={{ background: phaseColor }} />
          {pod.phase}
        </span>
        <span className="chip">
          {pod.containers.length} container{pod.containers.length > 1 ? 's' : ''}
        </span>
        {pod.terminating && <span className="chip !text-lavender/70">Terminating</span>}
      </PanelHeader>

      <p className="text-[12px] leading-relaxed text-lavender/85">
        A <b className="text-teal">Pod</b> wraps {pod.containers.length > 1 ? 'its containers' : 'its container'}: it gives{' '}
        {pod.containers.length > 1 ? 'them' : 'it'} a Node to run on, an IP address and a lifecycle Kubernetes can track.
      </p>

      {pod.terminating && (
        <p className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2 text-[11.5px] leading-relaxed text-lavender/85">
          Deletion requested: its kubelet is stopping the container, then the Pod object disappears. This is not a crash — a
          crashed container is restarted inside the same Pod.
        </p>
      )}

      {!pod.awaitingKubelet && !pod.terminating && <InsideButton pod={pod} />}

      <LabControls pod={pod} />
      <DeleteControls pod={pod} />
      {chain.length > 0 && pod.origin !== 'static' && <ManagedBy pod={pod} chain={chain} />}

      <Section title="Identity">
        <Facts>
          <Fact label="Name">{pod.metadata.name}</Fact>
          <Fact label="Namespace">{pod.metadata.namespace}</Fact>
          <Fact label="Node">
            {pod.nodeName && !inside ? (
              <LinkButton onClick={() => focusNode(pod.nodeName!)}>{pod.nodeName}</LinkButton>
            ) : (
              (pod.nodeName ?? <span className="text-warn">none yet</span>)
            )}
          </Fact>
          <Fact label="Pod IP">{pod.podIP ?? 'not assigned yet'}</Fact>
          <Fact label="Phase">{pod.phase}</Fact>
          <Fact label="Created by">{pod.origin === 'standalone' ? 'you, directly' : ORIGIN_LABEL[pod.origin]}</Fact>
        </Facts>
        <p className="mt-2 text-[11px] leading-relaxed text-lavender/60">
          {pod.origin === 'standalone' && 'No controller manages this Pod. '}
          {pod.origin === 'standalone' && lessonWithControllers && 'If it is deleted, nothing recreates it. '}
          {!pod.conditions && 'How its Node was chosen is simplified here — Lesson 3 shows the real process.'}
        </p>
      </Section>

      {pod.conditions && <StatusSection pod={pod} />}

      <Section title={`Containers (${pod.containers.length})`}>
        <ul className="space-y-1.5">
          {pod.containers.map((c) => (
            <ContainerRow
              key={c.name}
              container={c}
              unreported={pod.awaitingKubelet}
              onInspect={inside ? () => selectContainer(uid, c.name) : undefined}
            />
          ))}
        </ul>
        {pod.awaitingKubelet ? (
          <p className="mt-2 text-[11px] text-lavender/55">No kubelet has acted on this Pod yet: no container exists.</p>
        ) : (
          !inside && <p className="mt-2 text-[11px] text-lavender/55">Explore inside to see the containers within the Pod.</p>
        )}
      </Section>
    </>
  );
}

/** Phase, conditions and container state are three different things — shown side by side. */
function StatusSection({ pod }: { pod: Pod }) {
  const c = pod.containers[0];
  return (
    <Section title="Status, as reported">
      <Facts>
        <Fact label="Phase">{pod.phase}</Fact>
        {(['PodScheduled', 'Initialized', 'ContainersReady', 'Ready'] as const).map((type) => {
          const ok = pod.conditions?.find((x) => x.type === type)?.status === 'True';
          return (
            <Fact key={type} label={type}>
              <span style={{ color: ok ? conditionColor.ok : 'rgb(179 164 255 / 0.6)' }}>{ok ? 'True' : 'False'}</span>
            </Fact>
          );
        })}
        {c && (
          <Fact label={`Container ${c.name}`}>
            {pod.awaitingKubelet
              ? 'not reported'
              : c.status.state === 'waiting'
                ? `waiting (${c.status.reason})`
                : c.status.state}
          </Fact>
        )}
      </Facts>
      {pod.conditions
        ?.filter((x) => x.status === 'False' && x.reason)
        .map((x) => (
          <p key={x.type} className="mt-2 rounded-lg border border-warn/25 bg-warn/[0.06] px-2.5 py-1.5 text-[11px] leading-relaxed text-warn">
            {x.type}: {x.reason}
            {x.message && <span className="text-lavender/80"> — {x.message}</span>}
          </p>
        ))}
      <p className="mt-2 text-[11px] leading-relaxed text-lavender/60">
        The phase is a summary; conditions are individual checks; each container has its own state. Scheduled does not
        mean Running.
      </p>
    </Section>
  );
}

/** Lesson 4: `kubectl delete pod`, for the standalone Pod and for Pods a ReplicaSet owns. */
function DeleteControls({ pod }: { pod: Pod }) {
  const lesson = useLearningStore((s) => s.lesson);
  const session = useLearningStore((s) => s.session);
  const perform = useLearningStore((s) => s.perform);
  const dispatch = useLearningStore((s) => s.dispatch);
  const learning = useAppStore((s) => s.mode === 'learn');
  const controllers = session?.world.controllers;
  if (!learning || !lesson || !session || !controllers || pod.terminating) return null;
  const owner = controllerRef(pod);
  const replaces = controllers.pods.find((p) => managedPodUid(p.serial) === pod.metadata.uid)?.replaces;

  let button = null;
  if (pod.metadata.uid === REQUEST_POD_UID && canPerform(lesson, session, 'delete-standalone-pod')) {
    button = (
      <button type="button" className="hud-btn w-full justify-center font-mono !text-[11.5px]" onClick={() => perform('delete-standalone-pod')}>
        <Trash2 className="size-3.5" /> $ kubectl delete pod {pod.metadata.name}
      </button>
    );
  } else if (owner?.kind === 'ReplicaSet' && canPerform(lesson, session, 'delete-replicaset-pod')) {
    button = (
      <button
        type="button"
        className="hud-btn w-full justify-center font-mono !text-[11.5px]"
        onClick={() => dispatch({ type: 'REPLICASET_POD_DELETED', podId: pod.metadata.uid, replicaSetId: owner.uid })}
      >
        <Trash2 className="size-3.5" /> $ kubectl delete pod {pod.metadata.name}
      </button>
    );
  }
  if (!button && !replaces) return null;
  return (
    <div className="space-y-1.5">
      {replaces && (
        <p className="rounded-lg border border-teal/25 bg-teal/[0.06] px-2.5 py-2 text-[11.5px] leading-relaxed text-lavender/85">
          Created by its ReplicaSet to replace <span className="font-mono text-white/90">{replaces}</span>, which was deleted. A
          new name and a new UID: the deleted Pod was not revived.
        </p>
      )}
      {button}
    </div>
  );
}

/** The owner chain, walkable upward; following it is a lesson step in Lesson 4. */
function ManagedBy({ pod, chain }: { pod: Pod; chain: OwnerReference[] }) {
  const selectWorkload = useAppStore((s) => s.selectWorkload);
  const learning = useAppStore((s) => s.mode === 'learn');
  const dispatch = useLearningStore((s) => s.dispatch);
  const follow = (ref: OwnerReference) => {
    if (learning && ref.kind === 'ReplicaSet') {
      dispatch({ type: 'POD_OWNER_CHAIN_EXPLORED', podId: pod.metadata.uid, replicaSetId: ref.uid });
    }
    selectWorkload(ref.uid);
  };
  return (
    <Section title="Managed by">
      <div className="space-y-1 text-xs">
        <ChainItem kind="Pod" name={pod.metadata.name} />
        {chain.map((r, i) => (
          <ChainLink key={r.uid} kind={r.kind} name={r.name} indent={i + 1} onClick={() => follow(r)} />
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-lavender/60">
        metadata.ownerReferences names the ReplicaSet; the ReplicaSet’s own ownerReferences name the Deployment.
      </p>
    </Section>
  );
}

function ChainLink({ kind, name, indent, onClick }: { kind: string; name: string; indent: number; onClick: () => void }) {
  return (
    <div className="flex items-center gap-2" style={{ paddingLeft: indent * 14 }}>
      <span className="text-lavender/40">↳</span>
      <span className="w-[92px] shrink-0 text-lavender/65">{kind}</span>
      <LinkButton onClick={onClick}>{name}</LinkButton>
    </div>
  );
}

const LAB_STEPS: readonly Pod['phase'][] = ['Pending', 'Running'];

/** Step-through controls for a lifecycle-lab Pod, offered only when the lesson allows the next step. */
function LabControls({ pod }: { pod: Pod }) {
  const lesson = useLearningStore((s) => s.lesson);
  const session = useLearningStore((s) => s.session);
  const perform = useLearningStore((s) => s.perform);
  const kind = labActionFor(pod.metadata.uid);
  if (!kind || !lesson || !session) return null;
  const finished = pod.phase === 'Succeeded' || pod.phase === 'Failed';
  const steps = [...LAB_STEPS, finished ? pod.phase : pod.restartPolicy === 'Never' ? 'Succeeded / Failed' : '…'];
  const current = steps.indexOf(pod.phase);
  const c = pod.containers[0];

  return (
    <section className="rounded-xl border border-warm/25 bg-warm/[0.05] p-2.5">
      <div className="section-title !mb-1.5 flex items-center gap-1.5 !text-warm/85">
        <FlaskConical className="size-3.5" /> Lifecycle lab · step by step
      </div>
      <ol className="flex items-center gap-1 text-[10.5px]">
        {steps.map((s, i) => (
          <li key={s} className="flex items-center gap-1">
            {i > 0 && <span className="text-lavender/40">→</span>}
            <span
              className={`rounded-md px-1.5 py-0.5 font-mono ${i === current ? 'bg-white/[0.1] text-white' : 'text-lavender/55'}`}
              style={i === current ? { color: PHASE_COLOR[pod.phase] } : undefined}
            >
              {s}
            </span>
          </li>
        ))}
      </ol>
      {c && (
        <p className="mt-1.5 text-[11px] text-lavender/75">
          Container <span className="font-mono text-white/90">{c.name}</span>:{' '}
          {c.status.state === 'running'
            ? 'Running'
            : c.status.state === 'waiting'
              ? `Waiting (${c.status.reason})`
              : `Terminated (${c.status.reason}, exit code ${c.status.exitCode})`}
        </p>
      )}
      {canPerform(lesson, session, kind) && (
        <button type="button" className="primary-btn mt-2 w-full justify-center" onClick={() => perform(kind)}>
          {buildActionLabel(session, kind)}
        </button>
      )}
    </section>
  );
}

function FullPodInspector({ uid }: { uid: string }) {
  const cluster = useAppStore((s) => s.cluster);
  const view = useAppStore((s) => s.view);
  const focusNode = useAppStore((s) => s.focusNode);
  const selectComponent = useAppStore((s) => s.selectComponent);
  const selectContainer = useAppStore((s) => s.selectContainer);
  const clearSelection = useAppStore((s) => s.clearSelection);

  const pod = findPod(cluster, uid);
  if (!pod) return null;

  const inside = view.kind === 'pod' && view.podUid === uid;
  const condition = podCondition(pod);
  const nsColor = namespaceColorOf(pod.metadata.namespace);
  const chain = ownerChain(cluster, pod);
  const component = componentForPod(cluster, pod);

  return (
    <>
      <PanelHeader kind={`Pod · ${ORIGIN_LABEL[pod.origin]}`} title={pod.metadata.name} icon={<Box className="size-5" />} accent={nsColor} onClose={clearSelection}>
        <span className="chip">
          <span className="size-2 rounded-full" style={{ background: nsColor }} />
          ns/{pod.metadata.namespace}
        </span>
        <span className="chip" style={{ color: conditionColor[condition] }}>
          <span className="size-1.5 rounded-full" style={{ background: conditionColor[condition] }} />
          {podStatusText(pod)}
        </span>
        <span className="chip">ready {readyCount(pod)}</span>
        {restartTotal(pod) > 0 && <span className="chip !text-warn">{restartTotal(pod)} restarts</span>}
      </PanelHeader>

      <InsideButton pod={pod} />

      <Section title="Placement">
        <Facts>
          <Fact label="Node">
            {pod.nodeName ? (
              inside ? (
                pod.nodeName
              ) : (
                <LinkButton onClick={() => focusNode(pod.nodeName!)}>{pod.nodeName}</LinkButton>
              )
            ) : (
              <span className="text-warn">unscheduled</span>
            )}
          </Fact>
          <Fact label="Pod IP">
            {pod.podIP ?? '—'}
            {pod.hostNetwork && <span className="ml-1 text-gold">(host)</span>}
          </Fact>
          <Fact label="QoS class">{pod.qosClass}</Fact>
          <Fact label="ServiceAccount">{pod.serviceAccountName}</Fact>
          <Fact label="Created">{new Date(pod.metadata.creationTimestamp).toLocaleString()}</Fact>
        </Facts>
      </Section>

      <Section title="Managed by">
        <OwnerChain pod={pod} chain={chain} />
        <p className="mt-2 text-[11.5px] leading-relaxed text-lavender/75">{ORIGIN_EXPLAINER[pod.origin]}</p>
        {component && !inside && (
          <p className="mt-2 text-[11.5px] text-lavender/75">
            Runs the control-plane component{' '}
            <LinkButton onClick={() => selectComponent(component.uid)}>{component.type}</LinkButton>.
          </p>
        )}
      </Section>

      <Section title={`Containers (${pod.containers.length})`}>
        <ul className="space-y-1.5">
          {pod.containers.map((c) => (
            <ContainerRow
              key={c.name}
              container={c}
              onInspect={inside ? () => selectContainer(uid, c.name) : undefined}
            />
          ))}
        </ul>
        {pod.initContainers.length > 0 && (
          <>
            <div className="mb-1 mt-2.5 text-[10.5px] text-lavender/60">Init containers (ran before the others)</div>
            <ul className="space-y-1.5">
              {pod.initContainers.map((c) => (
                <ContainerRow key={c.name} container={c} />
              ))}
            </ul>
          </>
        )}
        {!inside && (
          <p className="mt-2 text-[11px] text-lavender/55">Explore inside to see how these containers share the Pod.</p>
        )}
      </Section>

      <Section title="Labels">
        <Labels labels={pod.metadata.labels} />
      </Section>
    </>
  );
}

function OwnerChain({ pod, chain }: { pod: Pod; chain: OwnerReference[] }) {
  if (pod.origin === 'static') {
    const nodeRef = chain.find((r) => r.kind === 'Node');
    return (
      <div className="space-y-1 text-xs">
        <ChainItem kind="Pod (mirror)" name={pod.metadata.name} />
        <ChainItem kind="kubelet on Node" name={nodeRef?.name ?? pod.nodeName ?? '?'} indent={1} />
        {pod.mirrorOf && <ChainItem kind="manifest" name={pod.mirrorOf.manifestPath} indent={2} />}
      </div>
    );
  }
  if (!chain.length) {
    return (
      <div className="rounded-lg border border-warn/25 bg-warn/[0.06] px-2.5 py-2 text-xs text-warn">
        No owner references — this Pod is on its own.
      </div>
    );
  }
  return <OwnerLinks pod={pod} chain={chain} />;
}

function OwnerLinks({ pod, chain }: { pod: Pod; chain: OwnerReference[] }) {
  const cluster = useAppStore((s) => s.cluster);
  const selectWorkload = useAppStore((s) => s.selectWorkload);
  return (
    <div className="space-y-1 text-xs">
      <ChainItem kind="Pod" name={pod.metadata.name} />
      {chain.map((r, i) =>
        cluster.workloads.some((w) => w.metadata.uid === r.uid) ? (
          <ChainLink key={r.uid} kind={r.kind} name={r.name} indent={i + 1} onClick={() => selectWorkload(r.uid)} />
        ) : (
          <ChainItem key={r.uid} kind={r.kind} name={r.name} indent={i + 1} />
        ),
      )}
    </div>
  );
}

function ChainItem({ kind, name, indent = 0 }: { kind: string; name: string; indent?: number }) {
  return (
    <div className="flex items-center gap-2" style={{ paddingLeft: indent * 14 }}>
      {indent > 0 && <span className="text-lavender/40">↳</span>}
      <span className="w-[92px] shrink-0 text-lavender/65">{kind}</span>
      <span className="truncate font-mono text-[11px] text-white/90">{name}</span>
    </div>
  );
}

function ContainerRow({
  container: c,
  unreported,
  onInspect,
}: {
  container: Container;
  /** No kubelet has reported this container yet. */
  unreported?: boolean;
  onInspect?: () => void;
}) {
  const color = unreported
    ? 'rgb(179 164 255 / 0.5)'
    : c.status.state === 'running'
      ? palette.teal
      : c.status.state === 'waiting'
        ? conditionColor.warning
        : conditionColor.done;
  const state = unreported
    ? 'not created yet'
    : c.status.state === 'running'
      ? 'Running'
      : c.status.state === 'waiting'
        ? c.status.reason
        : c.status.reason;
  const body = (
    <>
      <span className="mt-1 size-2 shrink-0 rounded-sm" style={{ background: color }} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate font-mono text-[12px] text-white">{c.name}</span>
          <span className="shrink-0 text-[10px] uppercase tracking-wider text-lavender/60">{c.role}</span>
        </span>
        <span className="block truncate font-mono text-[10.5px] text-lavender/60">{c.image}</span>
        <span className="block text-[10.5px]" style={{ color }}>
          {state}
          {c.restartCount > 0 && ` · ${c.restartCount} restarts`}
        </span>
      </span>
    </>
  );
  return (
    <li>
      {onInspect ? (
        <button
          type="button"
          onClick={onInspect}
          className="flex w-full gap-2 rounded-lg bg-white/[0.03] px-2.5 py-2 text-left transition hover:bg-white/[0.07]"
        >
          {body}
        </button>
      ) : (
        <div className="flex gap-2 rounded-lg bg-white/[0.03] px-2.5 py-2">{body}</div>
      )}
    </li>
  );
}
