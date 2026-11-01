import { Package } from 'lucide-react';
import { findPod } from '../../domain/selectors';
import { useAppStore } from '../../state/useAppStore';
import { conditionColor, palette } from '../../scene/palette';
import { Fact, Facts, LinkButton, PanelHeader, Section } from './parts';

export function ContainerInspector({ podUid, name }: { podUid: string; name: string }) {
  const essentials = useAppStore((s) => s.presentation.inspector === 'essentials');
  return essentials ? <ContainerEssentials podUid={podUid} name={name} /> : <FullContainerInspector podUid={podUid} name={name} />;
}

const STATE_EXPLAINER = {
  waiting: 'Waiting: not running yet — for example while its image is pulled and it is being created.',
  running: 'Running: its process is executing.',
  terminated: 'Terminated: its process has exited, successfully or not.',
} as const;

/** Image, process, state and its relationship to the Pod — no kernel internals. */
function ContainerEssentials({ podUid, name }: { podUid: string; name: string }) {
  const cluster = useAppStore((s) => s.cluster);
  const selectPod = useAppStore((s) => s.selectPod);
  const pod = findPod(cluster, podUid);
  const container = pod?.containers.find((c) => c.name === name);
  if (!pod || !container) return null;

  const st = container.status;
  const color = st.state === 'running' ? conditionColor.ok : st.state === 'waiting' ? conditionColor.warning : conditionColor.done;
  const stateText =
    st.state === 'running' ? 'Running' : st.state === 'waiting' ? `Waiting · ${st.reason}` : `Terminated · ${st.reason}`;
  const helper = container.role === 'sidecar';
  const siblings = pod.containers.filter((c) => c.name !== name);
  const mounts = container.volumeMounts ?? [];

  return (
    <>
      <PanelHeader
        kind={`Container · ${helper ? 'helper' : 'application'}`}
        title={container.name}
        icon={<Package className="size-5" />}
        accent={helper ? palette.lavender : palette.teal}
        onClose={() => selectPod(podUid)}
      >
        <span className="chip" style={{ color }}>
          <span className="size-1.5 rounded-full" style={{ background: color }} />
          {stateText}
        </span>
      </PanelHeader>

      <p className="text-[12px] leading-relaxed text-lavender/85">
        {helper ? 'A helper container: it supports the main application' : 'This container runs the application'} as an
        isolated process. It lives inside the Pod{' '}
        <LinkButton onClick={() => selectPod(podUid)}>{pod.metadata.name}</LinkButton>, which is not a container itself.
      </p>

      <Facts>
        <Fact label="Image">{container.image}</Fact>
        <Fact label="Process">{container.command?.join(' ') ?? 'image default'}</Fact>
        <Fact label="Ports">
          {container.ports.length ? container.ports.map((p) => `${p.containerPort}/${p.protocol}`).join(', ') : 'none'}
        </Fact>
      </Facts>

      <Section title="State">
        <p className="text-[12px] text-white/90" style={{ color }}>
          {stateText}
          {st.state === 'terminated' && ` · exit code ${st.exitCode}`}
        </p>
        <p className="mt-1 text-[11.5px] leading-relaxed text-lavender/75">{STATE_EXPLAINER[st.state]}</p>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-lavender/75">
          The Pod has its own phase, separate from this state: <b className="text-white">{pod.phase}</b>.
        </p>
      </Section>

      <Section title="Shared with its Pod">
        <p className="text-[11.5px] leading-relaxed text-lavender/80">
          <b className="text-teal">Network</b> — the Pod’s IP {pod.podIP ?? '(not assigned yet)'} and port space.
          {siblings.length > 0 && (
            <>
              {' '}
              It reaches{' '}
              {siblings.map((s, i) => (
                <span key={s.name}>
                  {i > 0 && ', '}
                  <span className="font-mono text-white/90">{s.name}</span>
                  {s.ports[0] && <span className="font-mono text-lavender/70"> on localhost:{s.ports[0].containerPort}</span>}
                </span>
              ))}{' '}
              over localhost.
            </>
          )}
        </p>
        {mounts.length > 0 ? (
          <ul className="mt-1.5 space-y-1 text-[11.5px] text-lavender/80">
            {mounts.map((m) => {
              const sharers = siblings.filter((s) => s.volumeMounts?.some((x) => x.name === m.name)).map((s) => s.name);
              return (
                <li key={m.name}>
                  <b className="text-gold">Volume {m.name}</b> mounted at <span className="font-mono text-white/90">{m.mountPath}</span>
                  {sharers.length > 0 && <> — also mounted by {sharers.join(', ')}, so they share these files</>}.
                </li>
              );
            })}
          </ul>
        ) : (
          siblings.length > 0 && (
            <p className="mt-1.5 text-[11.5px] text-lavender/70">No shared volume: its files stay its own.</p>
          )
        )}
      </Section>

      <Section title="Its own">
        <p className="text-[11.5px] leading-relaxed text-lavender/80">
          <b className="text-lilac">Filesystem</b> built from its image. Containers in a Pod share files only through volumes
          the Pod declares and each container mounts.
        </p>
      </Section>
    </>
  );
}

function FullContainerInspector({ podUid, name }: { podUid: string; name: string }) {
  const cluster = useAppStore((s) => s.cluster);
  const selectPod = useAppStore((s) => s.selectPod);
  const pod = findPod(cluster, podUid);
  const container = pod && [...pod.containers, ...pod.initContainers].find((c) => c.name === name);
  if (!pod || !container) return null;

  const st = container.status;
  const color = st.state === 'running' ? conditionColor.ok : st.state === 'waiting' ? conditionColor.warning : conditionColor.done;
  const stateText = st.state === 'running' ? 'Running' : st.reason;
  const siblings = pod.containers.filter((c) => c.name !== name).map((c) => c.name);
  const qosPath = pod.qosClass === 'Guaranteed' ? 'kubepods' : `kubepods/${pod.qosClass.toLowerCase()}`;
  const { requests, limits } = container.resources;

  return (
    <>
      <PanelHeader
        kind={`Container · ${container.role}`}
        title={container.name}
        icon={<Package className="size-5" />}
        accent={container.role === 'sidecar' ? palette.lavender : palette.teal}
        onClose={() => selectPod(podUid)}
      >
        <span className="chip" style={{ color }}>
          <span className="size-1.5 rounded-full" style={{ background: color }} />
          {stateText}
        </span>
        {container.restartCount > 0 && <span className="chip !text-warn">{container.restartCount} restarts</span>}
      </PanelHeader>

      <Facts>
        <Fact label="Image">{container.image}</Fact>
        <Fact label="Pod">
          <LinkButton onClick={() => selectPod(podUid)}>{pod.metadata.name}</LinkButton>
        </Fact>
        <Fact label="Ports">
          {container.ports.length
            ? container.ports.map((p) => `${p.containerPort}/${p.protocol}`).join(', ')
            : 'none'}
        </Fact>
        <Fact label="CPU req / limit">
          {requests?.cpuMillis ?? '—'}m / {limits?.cpuMillis ? `${limits.cpuMillis}m` : '—'}
        </Fact>
        <Fact label="Mem req / limit">
          {requests?.memoryMiB ?? '—'}Mi / {limits?.memoryMiB ? `${limits.memoryMiB}Mi` : '—'}
        </Fact>
      </Facts>

      {st.state === 'waiting' && st.reason === 'CrashLoopBackOff' && (
        <p className="rounded-lg border border-warn/25 bg-warn/[0.06] px-2.5 py-2 text-[11.5px] leading-relaxed text-warn">
          The process keeps exiting. The kubelet restarts it with an increasing back-off delay — the Pod object itself
          stays on the same Node.
        </p>
      )}

      <Section title="Shared with the Pod">
        <ul className="space-y-1 text-[11.5px] text-lavender/80">
          <li>
            <b className="text-teal">Network namespace</b> — IP {pod.podIP ?? '—'}
            {siblings.length > 0 && (
              <>
                ; reaches <span className="font-mono text-white/90">{siblings.join(', ')}</span> via localhost
              </>
            )}
          </li>
          <li>
            <b className="text-teal">IPC &amp; UTS namespaces</b> — same hostname and shared-memory space
          </li>
        </ul>
      </Section>

      <Section title="Its own">
        <ul className="space-y-1 text-[11.5px] text-lavender/80">
          <li>
            <b className="text-lilac">Filesystem</b> (mount namespace) from image layers
          </li>
          <li>
            <b className="text-lilac">Process tree</b> (PID namespace, unless shareProcessNamespace is set)
          </li>
        </ul>
      </Section>

      <Section title="cgroup on the Node kernel">
        <p className="break-all rounded-lg bg-black/25 px-2.5 py-2 font-mono text-[10.5px] text-warm/90">
          /sys/fs/cgroup/{qosPath}/pod{pod.metadata.uid}/{container.name}
        </p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-lavender/65">
          Illustrative path. The kernel on {pod.nodeName} enforces this container's limits — the cgroup is a kernel
          object, not something stored inside the Pod.
        </p>
      </Section>
    </>
  );
}
