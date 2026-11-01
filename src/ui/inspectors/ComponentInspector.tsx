import { Cog } from 'lucide-react';
import { findComponent, findPod } from '../../domain/selectors';
import { useAppStore } from '../../state/useAppStore';
import { conditionColor, palette } from '../../scene/palette';
import { Fact, Facts, LinkButton, PanelHeader, Section } from './parts';
import { ComponentEssentials } from './ComponentEssentials';

const RUNS_AS_TEXT = {
  'static-pod': 'Static Pod (started by the kubelet from a manifest on disk)',
  'systemd-service': 'systemd service on the host',
  'managed-external': 'Managed by the cloud provider, outside the cluster',
} as const;

export function ComponentInspector({ uid }: { uid: string }) {
  const essentials = useAppStore((s) => s.presentation.inspector === 'essentials');
  const component = useAppStore((s) => findComponent(s.cluster, uid));
  if (essentials && component) return <ComponentEssentials component={component} />;
  return <FullComponentInspector uid={uid} />;
}

function FullComponentInspector({ uid }: { uid: string }) {
  const cluster = useAppStore((s) => s.cluster);
  const selectPod = useAppStore((s) => s.selectPod);
  const focusNode = useAppStore((s) => s.focusNode);
  const component = findComponent(cluster, uid);
  if (!component) return null;
  const pod = component.podUid ? findPod(cluster, component.podUid) : undefined;

  return (
    <>
      <PanelHeader kind="Control-plane component" title={component.type} icon={<Cog className="size-5" />} accent={palette.gold}>
        <span className="chip" style={{ color: component.healthy ? conditionColor.ok : conditionColor.failed }}>
          <span
            className="size-1.5 rounded-full"
            style={{ background: component.healthy ? conditionColor.ok : conditionColor.failed }}
          />
          {component.healthy ? 'Healthy' : 'Unhealthy'}
        </span>
        <span className="chip">not a Pod itself</span>
      </PanelHeader>

      <p className="text-[12px] leading-relaxed text-lavender/85">{component.summary}</p>

      <Section title="How it runs">
        <Facts>
          <Fact label="Node">
            <LinkButton onClick={() => focusNode(component.nodeName)}>{component.nodeName}</LinkButton>
          </Fact>
          <Fact label="Runs as">{component.runsAs}</Fact>
        </Facts>
        <p className="mt-2 text-[11.5px] leading-relaxed text-lavender/75">{RUNS_AS_TEXT[component.runsAs]}</p>
      </Section>

      {pod && (
        <Section title="Its static Pod">
          <button
            type="button"
            onClick={() => selectPod(pod.metadata.uid)}
            className="flex w-full flex-col items-start gap-0.5 rounded-lg bg-white/[0.04] px-3 py-2 text-left transition hover:bg-white/[0.08]"
          >
            <span className="font-mono text-[12px] text-white">{pod.metadata.name}</span>
            <span className="text-[10.5px] text-lavender/65">
              Inspect the mirror Pod that represents this component in the API →
            </span>
          </button>
        </Section>
      )}
    </>
  );
}
