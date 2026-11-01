import type { ReactNode } from 'react';
import { Box, Check, Cpu, Play } from 'lucide-react';
import { findPod } from '../../domain/selectors';
import type { NodeAgent } from '../../state/presentation';
import { useAppStore } from '../../state/useAppStore';
import { buildActionLabel, canPerform } from '../../learning/engine';
import { REQUEST_POD_UID } from '../../learning/sandbox';
import { useLearningStore } from '../../learning/useLearningStore';
import type { BuildActionKind } from '../../learning/types';
import { conditionColor, palette } from '../../scene/palette';
import { PanelHeader, Section } from './parts';

/** A Node agent (kubelet or container runtime), as Lesson 3 introduces it. */
export function AgentInspector({ nodeName, agent }: { nodeName: string; agent: NodeAgent }) {
  return agent === 'kubelet' ? <KubeletInspector nodeName={nodeName} /> : <RuntimeInspector nodeName={nodeName} />;
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

function Done({ done, children }: { done: boolean; children: ReactNode }) {
  return (
    <li className={`flex items-center gap-2 font-mono text-[11px] ${done ? 'text-white/90' : 'text-lavender/50'}`}>
      <Check className="size-3 shrink-0" style={{ color: done ? conditionColor.ok : 'transparent' }} />
      {children}
    </li>
  );
}

function KubeletInspector({ nodeName }: { nodeName: string }) {
  const cluster = useAppStore((s) => s.cluster);
  const pod = findPod(cluster, REQUEST_POD_UID);
  const mine = pod?.nodeName === nodeName ? pod : undefined;
  const local = cluster.pods.filter((p) => p.nodeName === nodeName && p.metadata.uid !== REQUEST_POD_UID);
  const prepared = !!mine && !mine.awaitingKubelet;
  const running = mine?.phase === 'Running';

  return (
    <>
      <PanelHeader kind={`Node agent · ${nodeName}`} title="kubelet" icon={<Cpu className="size-5" />} accent={palette.teal}>
        <span className="chip">one per Node</span>
      </PanelHeader>
      <p className="text-[12px] leading-relaxed text-lavender/85">
        The agent on this Node. It <b className="text-teal">watches the API server</b> for Pods whose spec.nodeName is{' '}
        <span className="font-mono text-white">{nodeName}</span>, makes them real through the container runtime, and
        reports their status back. It acts only on its own Node.
      </p>
      <Section title="Pods bound to this Node">
        <ul className="space-y-1 font-mono text-[11.5px] text-white/85">
          {local.map((p) => (
            <li key={p.metadata.uid}>
              {p.metadata.name} <span className="text-lavender/55">· {p.phase}</span>
            </li>
          ))}
          {mine && (
            <li className="text-gold">
              {mine.metadata.name} <span className="text-lavender/70">· {running ? 'Running' : prepared ? 'preparing' : 'new'}</span>
            </li>
          )}
        </ul>
        {pod && !mine && (
          <p className="mt-2 text-[11.5px] leading-relaxed text-lavender/75">
            {pod.nodeName ? (
              <>
                <span className="font-mono text-white">{pod.metadata.name}</span> is bound to {pod.nodeName}, not here. This
                kubelet ignores it.
              </>
            ) : (
              <>
                <span className="font-mono text-white">{pod.metadata.name}</span> has no Node yet: no kubelet acts on it.
              </>
            )}
          </p>
        )}
      </Section>
      {mine && (
        <Section title={`Bringing ${mine.metadata.name} to life`}>
          <ol className="space-y-1">
            <Done done>watch: saw the Pod bound to {nodeName}</Done>
            <Done done={prepared}>CRI RunPodSandbox (Pod network: CNI, Lesson 6)</Done>
            <Done done={prepared}>CRI PullImage {mine.containers[0]?.image}</Done>
            <Done done={prepared}>CRI CreateContainer web</Done>
            <Done done={running}>CRI StartContainer web</Done>
            <Done done={running}>status → API server: Running, Ready</Done>
          </ol>
          <ActionButton kind="kubelet-prepare-pod" />
          {prepared && !running && (
            <p className="mt-2 text-[11.5px] leading-relaxed text-lavender/75">
              The container exists but is not started. The runtime does the actual work — open containerd beside me.
            </p>
          )}
        </Section>
      )}
    </>
  );
}

function RuntimeInspector({ nodeName }: { nodeName: string }) {
  const cluster = useAppStore((s) => s.cluster);
  const pods = cluster.pods.filter((p) => p.nodeName === nodeName && !p.awaitingKubelet && !p.hostNetwork);
  const containers = pods.flatMap((p) => p.containers.map((c) => ({ pod: p.metadata.name, c })));

  return (
    <>
      <PanelHeader
        kind={`Container runtime · ${nodeName}`}
        title="containerd"
        icon={<Box className="size-5" />}
        accent={palette.cyan}
      >
        <span className="chip">not the kubelet</span>
      </PanelHeader>
      <p className="text-[12px] leading-relaxed text-lavender/85">
        A separate program that pulls images and creates, starts and stops containers. The kubelet asks it through the{' '}
        <b className="text-cyan">CRI</b> (Container Runtime Interface); any CRI runtime would do.
      </p>
      <Section title="Containers on this Node">
        <ul className="space-y-1 font-mono text-[11.5px]">
          {containers.map(({ pod, c }) => (
            <li key={`${pod}/${c.name}`} className={pod === findPod(cluster, REQUEST_POD_UID)?.metadata.name ? 'text-gold' : 'text-white/85'}>
              {pod}/{c.name} <span className="text-lavender/55">· {c.status.state === 'waiting' ? 'created, not started' : c.status.state}</span>
            </li>
          ))}
          {containers.length === 0 && <li className="text-lavender/60">none</li>}
        </ul>
        <ActionButton kind="start-container" />
      </Section>
    </>
  );
}
