import { useMemo, type ReactNode } from 'react';
import { Layers, Repeat } from 'lucide-react';
import type { Cluster, Deployment, Pod, ReplicaSet } from '../../domain/types';
import { controllerRef, findWorkload, podsControlledBy, workloadsControlledBy } from '../../domain/selectors';
import { cpuQuantity, memoryQuantity } from '../../domain/manifest';
import { replacementPodUids } from '../../learning/controllerObjects';
import { useLearningStore } from '../../learning/useLearningStore';
import { useAppStore } from '../../state/useAppStore';
import { workloadAccent } from '../../scene/accent';
import { conditionColor } from '../../scene/palette';
import { rollingLimits } from '../../simulation/controllers';
import { Fact, Facts, Labels, LinkButton, PanelHeader, Section } from './parts';

/** A Deployment or ReplicaSet: what it wants, what exists, and the objects above and below it. */
export function WorkloadInspector({ uid }: { uid: string }) {
  const cluster = useAppStore((s) => s.cluster);
  const w = findWorkload(cluster, uid);
  if (!w) return null;
  if (w.kind === 'Deployment') return <DeploymentView cluster={cluster} deployment={w} />;
  if (w.kind === 'ReplicaSet') return <ReplicaSetView cluster={cluster} replicaSet={w} />;
  return null;
}

const percent = (value: string, replicas: number, round: 'up' | 'down') => {
  const p = Number(value.replace('%', '')) / 100;
  return round === 'up' ? Math.ceil(replicas * p) : Math.floor(replicas * p);
};

function DeploymentView({ cluster, deployment: d }: { cluster: Cluster; deployment: Deployment }) {
  const clearSelection = useAppStore((s) => s.clearSelection);
  const selectWorkload = useAppStore((s) => s.selectWorkload);
  const accent = workloadAccent(cluster, d);
  const replicaSets = workloadsControlledBy(cluster, d.metadata.uid).filter((w): w is ReplicaSet => w.kind === 'ReplicaSet');
  const status = d.status;
  const limits = d.rollingUpdate
    ? {
        maxSurge: percent(d.rollingUpdate.maxSurge, d.replicas, 'up'),
        maxUnavailable: percent(d.rollingUpdate.maxUnavailable, d.replicas, 'down'),
      }
    : rollingLimits(d.replicas);

  return (
    <>
      <PanelHeader kind="Deployment · apps/v1" title={d.metadata.name} icon={<Layers className="size-5" />} accent={accent} onClose={clearSelection}>
        {d.revision !== undefined && <span className="chip">revision {d.revision}</span>}
        <span className="chip">{d.strategy}</span>
      </PanelHeader>
      <p className="text-[12px] leading-relaxed text-lavender/85">
        A <b className="text-teal">desired state</b> stored in the API: a Pod template and a replica count. The Deployment
        controller — a loop inside kube-controller-manager, not a Pod — manages ReplicaSets to match it. It never creates
        Pods itself.
      </p>

      <Section title="Desired vs actual">
        <Facts>
          <Fact label="Desired (spec.replicas)">{d.replicas}</Fact>
          {status && (
            <>
              <Fact label="Pods that exist">{status.replicas}</Fact>
              <Fact label="Updated (current template)">{status.updatedReplicas}</Fact>
              <Fact label="Ready">{status.readyReplicas}</Fact>
              <Fact label="Available">
                <span style={{ color: status.availableReplicas < d.replicas ? conditionColor.warning : conditionColor.ok }}>
                  {status.availableReplicas}
                </span>
              </Fact>
            </>
          )}
        </Facts>
      </Section>

      {d.template && (
        <Section title="Pod template">
          <Facts>
            <Fact label="Container">{d.template.containerName}</Fact>
            <Fact label="Image">{d.template.image}</Fact>
            {d.template.requests?.cpuMillis !== undefined && (
              <Fact label="Requests">
                {cpuQuantity(d.template.requests.cpuMillis)} CPU
                {d.template.requests.memoryMiB !== undefined && ` · ${memoryQuantity(d.template.requests.memoryMiB)}`}
              </Fact>
            )}
          </Facts>
          <p className="mt-2 text-[11px] leading-relaxed text-lavender/60">
            Changing the template creates a new ReplicaSet. Changing only the replica count does not.
          </p>
        </Section>
      )}

      {d.strategy === 'RollingUpdate' && (
        <Section title="Update strategy">
          <Facts>
            <Fact label="maxSurge">
              {d.rollingUpdate?.maxSurge ?? '25%'} → {limits.maxSurge} extra Pod{limits.maxSurge === 1 ? '' : 's'}
            </Fact>
            <Fact label="maxUnavailable">
              {d.rollingUpdate?.maxUnavailable ?? '25%'} → {limits.maxUnavailable}
            </Fact>
          </Facts>
          <p className="mt-2 text-[11px] leading-relaxed text-lavender/60">
            Surge rounds up, unavailability rounds down. A rollout also needs new Pods to become Ready, and room on a Node.
          </p>
        </Section>
      )}

      <Section title={`Manages ReplicaSets (${replicaSets.length})`}>
        <ul className="space-y-1">
          {replicaSets.map((rs) => (
            <li key={rs.metadata.uid} className="flex items-center gap-2 text-[11.5px]">
              <span className="size-2 rounded-full" style={{ background: workloadAccent(cluster, rs) }} />
              <LinkButton onClick={() => selectWorkload(rs.metadata.uid)}>{rs.metadata.name}</LinkButton>
              <span className="ml-auto text-[10.5px] text-lavender/60">
                {rs.revision !== undefined && `rev ${rs.revision} · `}
                {rs.readyReplicas}/{rs.replicas} ready
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Labels">
        <Labels labels={d.metadata.labels} />
      </Section>
    </>
  );
}

function ReplicaSetView({ cluster, replicaSet: rs }: { cluster: Cluster; replicaSet: ReplicaSet }) {
  const clearSelection = useAppStore((s) => s.clearSelection);
  const selectWorkload = useAppStore((s) => s.selectWorkload);
  const selectPod = useAppStore((s) => s.selectPod);
  const controllers = useLearningStore((s) => s.session?.world.controllers ?? null);
  const replacements = useMemo(() => replacementPodUids(controllers), [controllers]);
  const learning = useAppStore((s) => s.mode === 'learn');
  const accent = workloadAccent(cluster, rs);
  const ownerRef = controllerRef(rs);
  const owner = ownerRef && findWorkload(cluster, ownerRef.uid);
  const pods = podsControlledBy(cluster, rs.metadata.uid);
  const superseded = owner?.kind === 'Deployment' && owner.revision !== undefined && rs.revision !== undefined && rs.revision < owner.revision;

  return (
    <>
      <PanelHeader
        kind={`ReplicaSet${rs.revision !== undefined ? ` · revision ${rs.revision}` : ''}`}
        title={rs.metadata.name}
        icon={<Repeat className="size-5" />}
        accent={accent}
        onClose={clearSelection}
      >
        <span className="chip">
          {rs.readyReplicas}/{rs.replicas} ready
        </span>
        {superseded && <span className="chip !text-lavender/70">old revision</span>}
      </PanelHeader>
      <p className="text-[12px] leading-relaxed text-lavender/85">
        Keeps <b className="text-teal">exactly {rs.replicas} Pod{rs.replicas === 1 ? '' : 's'}</b> matching its selector. The
        ReplicaSet controller creates or deletes Pod objects through the API server — it starts no container: the scheduler
        and the kubelet do the rest.
      </p>
      {superseded && (
        <div className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2 text-[11.5px] leading-relaxed text-lavender/85">
          {rs.replicas === 0 && pods.length === 0
            ? 'Scaled to 0, but kept: it records an earlier revision of the template. kubectl rollout undo would make it current again.'
            : 'An older template: the Deployment controller is scaling it down as the new ReplicaSet scales up.'}
        </div>
      )}

      <Section title="Managed by">
        {owner ? (
          <div className="space-y-1 text-xs">
            <ChainRow kind="ReplicaSet" name={rs.metadata.name} />
            <ChainRow kind={owner.kind} indent={1}>
              <LinkButton onClick={() => selectWorkload(owner.metadata.uid)}>{owner.metadata.name}</LinkButton>
            </ChainRow>
          </div>
        ) : (
          <p className="text-xs text-lavender/70">No owner: created directly.</p>
        )}
      </Section>

      <Section title="Desired vs actual">
        <Facts>
          <Fact label="Desired (spec.replicas)">{rs.replicas}</Fact>
          {rs.currentReplicas !== undefined && <Fact label="Pods that exist">{rs.currentReplicas}</Fact>}
          <Fact label="Ready">{rs.readyReplicas}</Fact>
          {rs.podTemplateHash && <Fact label="pod-template-hash">{rs.podTemplateHash}</Fact>}
          {rs.template && <Fact label="Image">{rs.template.image}</Fact>}
        </Facts>
      </Section>

      <Section title={`Pods (${pods.length})`}>
        {pods.length === 0 ? (
          <p className="text-[11.5px] text-lavender/60">No Pods.</p>
        ) : (
          <ul className="space-y-1">
            {pods.map((p) => (
              <li key={p.metadata.uid} className="flex items-center gap-2 text-[11.5px]">
                <span className="size-2 rounded-full" style={{ background: podStateColor(p) }} />
                <LinkButton onClick={() => selectPod(p.metadata.uid)}>{p.metadata.name}</LinkButton>
                {learning && replacements.has(p.metadata.uid) && <span className="chip !py-0 !text-[9.5px] !text-teal">new</span>}
                <span className="ml-auto text-[10.5px] text-lavender/60">{podStateText(p)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Selector">
        <Labels labels={rs.selector.matchLabels} />
      </Section>
    </>
  );
}

export const podStateText = (p: Pod) => {
  if (p.terminating) return 'Terminating';
  if (!p.nodeName) return p.conditions?.some((c) => c.reason === 'Unschedulable') ? 'Pending · no room' : 'Pending · no Node';
  if (p.phase === 'Running') return `Running · ${p.nodeName}`;
  return `Pending · ${p.nodeName}`;
};

const podStateColor = (p: Pod) =>
  p.terminating ? conditionColor.done : p.phase === 'Running' ? conditionColor.ok : conditionColor.warning;

function ChainRow({ kind, name, indent = 0, children }: { kind: string; name?: string; indent?: number; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-2" style={{ paddingLeft: indent * 14 }}>
      {indent > 0 && <span className="text-lavender/40">↳</span>}
      <span className="w-[86px] shrink-0 text-lavender/65">{kind}</span>
      {children ?? <span className="truncate font-mono text-[11px] text-white/90">{name}</span>}
    </div>
  );
}
