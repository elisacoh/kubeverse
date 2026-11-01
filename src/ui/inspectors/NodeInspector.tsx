import { Server } from 'lucide-react';
import {
  ORIGIN_LABEL,
  findNode,
  fitsOnNode,
  freeCapacity,
  isNodeReady,
  podCondition,
  podRequests,
  podsOnNode,
  unscheduledPod,
} from '../../domain/selectors';
import { useAppStore } from '../../state/useAppStore';
import { conditionColor, namespaceColorOf, nodeAccentOf } from '../../scene/palette';
import { Bar, Fact, Facts, Labels, PanelHeader, Section } from './parts';

export function NodeInspector({ nodeName }: { nodeName: string }) {
  const essentials = useAppStore((s) => s.presentation.inspector === 'essentials');
  return essentials ? <NodeEssentials nodeName={nodeName} /> : <FullNodeInspector nodeName={nodeName} />;
}

/** Role and capacity only — for lessons that have not introduced Pods or scheduling yet. */
function NodeEssentials({ nodeName }: { nodeName: string }) {
  const cluster = useAppStore((s) => s.cluster);
  const goToCluster = useAppStore((s) => s.goToCluster);
  const revealedAny = useAppStore((s) => s.presentation.revealed.length > 0);
  const node = findNode(cluster, nodeName);
  if (!node) return null;
  const ready = isNodeReady(node);
  const accent = nodeAccentOf(nodeName);
  const cp = node.role === 'control-plane';
  const cores = node.capacity.cpuMillis / 1000;
  const gib = node.capacity.memoryMiB / 1024;

  return (
    <>
      <PanelHeader
        kind={cp ? 'Node · control-plane role' : 'Node · worker role'}
        title={nodeName}
        icon={<Server className="size-5" />}
        accent={accent}
        onClose={goToCluster}
      >
        <span className="chip" style={{ color: ready ? conditionColor.ok : conditionColor.failed }}>
          <span className="size-1.5 rounded-full" style={{ background: ready ? conditionColor.ok : conditionColor.failed }} />
          {ready ? 'Ready' : 'NotReady'}
        </span>
      </PanelHeader>

      <p className="text-[12px] leading-relaxed text-lavender/85">
        {cp ? (
          <>
            This machine hosts the <b className="text-gold">control plane</b>: a team of components that coordinates the
            whole cluster.{' '}
            {revealedAny ? 'Click a named component to inspect it.' : 'You will meet them one by one in Lesson 3.'}
          </>
        ) : (
          <>
            A machine that provides <b className="text-teal">capacity</b> for running applications. It also runs system
            software of its own, like the <b className="text-white">kubelet</b> agent that keeps it in touch with the
            control plane.
          </>
        )}
      </p>

      <Section title="Capacity">
        <div className="space-y-3">
          <CapacityBlocks label="CPU" count={cores} unit={cores === 1 ? 'core' : 'cores'} color={accent} />
          <CapacityBlocks label="Memory" count={gib} unit="GiB" color={accent} />
        </div>
        <p className="mt-2.5 text-[11px] leading-relaxed text-lavender/60">
          A fixed amount per machine. How applications use it comes in a later lesson.
        </p>
      </Section>

      {!cp && <SchedulingRoom nodeName={nodeName} />}

      <Section title="System">
        <Facts>
          <Fact label="kubelet">{node.nodeInfo.kubeletVersion}</Fact>
          <Fact label="Runtime">{node.nodeInfo.containerRuntime}</Fact>
          <Fact label="OS">{node.nodeInfo.osImage}</Fact>
        </Facts>
      </Section>
    </>
  );
}

const cpuText = (m: number) => `${+(m / 1000).toFixed(2)} CPU`;
const memText = (mi: number) => (mi >= 1024 ? `${+(mi / 1024).toFixed(1)} GiB` : `${mi} MiB`);

/**
 * What is left on this Node for new Pods, and whether a Pod waiting for a Node
 * would fit. Shown only once Pods request resources (Lesson 3).
 */
function SchedulingRoom({ nodeName }: { nodeName: string }) {
  const cluster = useAppStore((s) => s.cluster);
  const node = findNode(cluster, nodeName);
  const pods = podsOnNode(cluster, nodeName).filter((p) => p.phase !== 'Succeeded' && p.phase !== 'Failed');
  const waiting = unscheduledPod(cluster);
  const requesting = pods.filter((p) => podRequests(p).cpuMillis > 0 || podRequests(p).memoryMiB > 0);
  if (!node || (!waiting && requesting.length === 0)) return null;
  const free = freeCapacity(cluster, nodeName);
  const need = waiting ? podRequests(waiting) : null;
  const fits = waiting ? fitsOnNode(cluster, waiting, nodeName) : false;

  return (
    <Section title="Room for new Pods">
      <div className="space-y-1.5 text-[11.5px]">
        <div className="flex justify-between text-lavender/70">
          <span>Allocatable</span>
          <span className="font-mono text-white/85">
            {cpuText(node.allocatable.cpuMillis)} · {memText(node.allocatable.memoryMiB)}
          </span>
        </div>
        {requesting.map((p) => (
          <div key={p.metadata.uid} className="flex justify-between text-lavender/70">
            <span className="truncate">
              − requested by <span className="font-mono text-white/80">{p.metadata.name}</span>
            </span>
            <span className="font-mono text-white/85">
              {cpuText(podRequests(p).cpuMillis)} · {memText(podRequests(p).memoryMiB)}
            </span>
          </div>
        ))}
        <div className="flex justify-between border-t border-white/[0.06] pt-1.5 text-white">
          <span>Free</span>
          <span className="font-mono">
            {cpuText(free.cpuMillis)} · {memText(free.memoryMiB)}
          </span>
        </div>
      </div>
      {waiting && need && (
        <div
          className="mt-2.5 rounded-lg px-2.5 py-2 text-[11.5px] leading-relaxed"
          style={{
            background: `color-mix(in srgb, ${fits ? conditionColor.ok : conditionColor.failed} 12%, transparent)`,
          }}
        >
          <b className="font-mono text-white">{waiting.metadata.name}</b> requests {cpuText(need.cpuMillis)} ·{' '}
          {memText(need.memoryMiB)}.{' '}
          <b style={{ color: fits ? conditionColor.ok : conditionColor.failed }}>
            {fits ? 'It fits on this Node.' : 'It does not fit here.'}
          </b>
        </div>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-lavender/60">
        Free means allocatable minus what Pods here request — not what they actually use. Requests and limits are
        Lesson 8.
      </p>
    </Section>
  );
}

function CapacityBlocks({ label, count, unit, color }: { label: string; count: number; unit: string; color: string }) {
  return (
    <div className="text-xs">
      <div className="mb-1.5 flex justify-between text-lavender/70">
        <span>{label}</span>
        <span className="font-mono text-[11px] text-white/85">
          {count} {unit}
        </span>
      </div>
      <div className="flex flex-wrap gap-1" aria-hidden>
        {Array.from({ length: count }, (_, i) => (
          <span
            key={i}
            className="h-3 w-3 rounded-[3px]"
            style={{ background: `color-mix(in srgb, ${color} 70%, transparent)`, boxShadow: `0 0 6px -1px ${color}` }}
          />
        ))}
      </div>
    </div>
  );
}

function FullNodeInspector({ nodeName }: { nodeName: string }) {
  const cluster = useAppStore((s) => s.cluster);
  const selectPod = useAppStore((s) => s.selectPod);
  const selectComponent = useAppStore((s) => s.selectComponent);
  const goToCluster = useAppStore((s) => s.goToCluster);
  const node = findNode(cluster, nodeName);
  if (!node) return null;

  const pods = podsOnNode(cluster, nodeName);
  const components = cluster.controlPlane.filter((c) => c.nodeName === nodeName);
  const ready = isNodeReady(node);
  const accent = nodeAccentOf(nodeName);

  const requests = pods.reduce(
    (acc, p) => {
      for (const c of p.containers) {
        acc.cpu += c.resources.requests?.cpuMillis ?? 0;
        acc.mem += c.resources.requests?.memoryMiB ?? 0;
      }
      return acc;
    },
    { cpu: 0, mem: 0 },
  );

  return (
    <>
      <PanelHeader
        kind={node.role === 'control-plane' ? 'Node · control plane' : 'Node · worker'}
        title={nodeName}
        icon={<Server className="size-5" />}
        accent={accent}
        onClose={goToCluster}
      >
        <span className="chip" style={{ color: ready ? conditionColor.ok : conditionColor.failed }}>
          <span className="size-1.5 rounded-full" style={{ background: ready ? conditionColor.ok : conditionColor.failed }} />
          {ready ? 'Ready' : 'NotReady'}
        </span>
        <span className="chip">{pods.length} pods</span>
        {node.taints.map((t) => (
          <span key={t.key} className="chip !text-warm" title={`${t.key}:${t.effect}`}>
            taint: {t.effect}
          </span>
        ))}
      </PanelHeader>

      {node.role === 'control-plane' && (
        <p className="text-[11.5px] leading-relaxed text-lavender/75">
          The control plane is not one thing — it is a set of components. On this kubeadm-style Node each one runs as
          a <b className="text-gold">static Pod</b> started by the kubelet. The taint keeps ordinary workloads away.
        </p>
      )}

      {components.length > 0 && (
        <Section title="Control-plane components">
          <ul className="space-y-1">
            {components.map((c) => (
              <li key={c.uid}>
                <button
                  type="button"
                  onClick={() => selectComponent(c.uid)}
                  className="flex w-full items-center justify-between rounded-lg bg-white/[0.03] px-2.5 py-1.5 text-left font-mono text-[11.5px] text-white transition hover:bg-white/[0.07]"
                >
                  {c.type}
                  <span className="font-sans text-[10px] text-gold/80">{c.runsAs}</span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Requested resources">
        <div className="space-y-2.5">
          <Bar label="CPU" used={requests.cpu} total={node.allocatable.cpuMillis} unit="m" />
          <Bar label="Memory" used={requests.mem} total={node.allocatable.memoryMiB} unit="Mi" />
        </div>
      </Section>

      <Section title={`Pods on this Node (${pods.length})`}>
        <ul className="space-y-1">
          {pods.map((p) => (
            <li key={p.metadata.uid}>
              <button
                type="button"
                onClick={() => selectPod(p.metadata.uid)}
                className="flex w-full items-center gap-2 rounded-lg bg-white/[0.03] px-2.5 py-1.5 text-left transition hover:bg-white/[0.07]"
              >
                <span className="size-2 shrink-0 rounded-full" style={{ background: namespaceColorOf(p.metadata.namespace) }} />
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-white">{p.metadata.name}</span>
                <span className="shrink-0 text-[10px] text-lavender/60">{ORIGIN_LABEL[p.origin]}</span>
                <span className="size-1.5 shrink-0 rounded-full" style={{ background: conditionColor[podCondition(p)] }} />
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="System">
        <Facts>
          <Fact label="Internal IP">{node.internalIP}</Fact>
          <Fact label="Pod CIDR">{node.podCIDR}</Fact>
          <Fact label="kubelet">{node.nodeInfo.kubeletVersion}</Fact>
          <Fact label="Runtime">{node.nodeInfo.containerRuntime}</Fact>
          <Fact label="OS">{node.nodeInfo.osImage}</Fact>
          <Fact label="Kernel">{node.nodeInfo.kernelVersion}</Fact>
        </Facts>
      </Section>

      <Section title="Labels">
        <Labels labels={node.metadata.labels} />
      </Section>
    </>
  );
}
