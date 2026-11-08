import { useMemo, useState } from 'react';
import { ArrowLeft, Boxes, ChevronDown, Crosshair, RotateCcw, ScrollText, TerminalSquare } from 'lucide-react';
import { locate } from '../../playground/connector';
import { usePlayground, type ResourceRef } from '../../playground/store';
import { ageOf, endpointsText, ownerText, podReady, podRestarts, podStatus, servicePorts, toApiObject, toYaml } from '../../playground/kubectl/format';
import { isDeleting, isPodReady } from '../../playground/sim/cluster';
import type { Kind, KObject, SimState } from '../../playground/sim/types';
import { CodeBlock } from './Rich';

const ORDER: Kind[] = ['Deployment', 'ReplicaSet', 'Pod', 'Service', 'ConfigMap', 'PersistentVolumeClaim'];
const PLURAL: Record<Kind, string> = {
  Deployment: 'Deployments',
  ReplicaSet: 'ReplicaSets',
  Pod: 'Pods',
  Service: 'Services',
  ConfigMap: 'ConfigMaps',
  PersistentVolumeClaim: 'PersistentVolumeClaims',
};

type Health = 'ok' | 'progress' | 'warn' | 'gone';
const DOT: Record<Health, string> = { ok: 'bg-ok', progress: 'bg-cyan animate-pulse', warn: 'bg-warn', gone: 'bg-lavender/40' };

const summary = (o: KObject): { text: string; health: Health } => {
  if (isDeleting(o)) return { text: 'Terminating', health: 'gone' };
  switch (o.kind) {
    case 'Pod': {
      const status = podStatus(o);
      const warn = /Err|BackOff|Invalid|Failed/.test(status) || o.status.message?.includes('Insufficient');
      return { text: `${podReady(o)} · ${status}`, health: isPodReady(o) ? 'ok' : warn ? 'warn' : 'progress' };
    }
    case 'ReplicaSet':
    case 'Deployment':
      return { text: `${o.status.readyReplicas}/${o.spec.replicas} ready`, health: o.status.readyReplicas >= o.spec.replicas ? 'ok' : 'progress' };
    case 'Service':
      return { text: `${o.spec.type} ${o.spec.clusterIP}`, health: 'ok' };
    case 'ConfigMap':
      return { text: `${Object.keys(o.data).length} keys`, health: 'ok' };
    case 'PersistentVolumeClaim':
      return { text: o.status.phase, health: o.status.phase === 'Bound' ? 'ok' : 'progress' };
  }
};

const facts = (s: SimState, o: KObject): [string, string][] => {
  const base: [string, string][] = [
    ['Namespace', o.metadata.namespace],
    ['Age', ageOf(s, o)],
  ];
  const owner = ownerText(o);
  if (owner && owner !== '<none>') base.push(['Controlled by', owner]);
  switch (o.kind) {
    case 'Pod':
      return [
        ...base,
        ['Status', podStatus(o)],
        ['Ready', podReady(o)],
        ['Restarts', String(podRestarts(o))],
        ['Node', o.status.nodeName ?? '<none>'],
        ['Pod IP', o.status.podIP ?? '<none>'],
        ['QoS class', o.status.qosClass],
        ['Images', o.spec.containers.map((c) => c.image).join(', ')],
        ...(o.status.message ? ([['Message', o.status.message]] as [string, string][]) : []),
      ];
    case 'ReplicaSet':
    case 'Deployment':
      return [
        ...base,
        ['Desired replicas', String(o.spec.replicas)],
        ['Current', String(o.status.replicas)],
        ['Ready', String(o.status.readyReplicas)],
        ['Selector', Object.entries(o.spec.selector.matchLabels).map(([k, v]) => `${k}=${v}`).join(',')],
        ['Image', o.spec.template.spec.containers.map((c) => c.image).join(', ')],
      ];
    case 'Service':
      return [...base, ['Type', o.spec.type], ['Cluster IP', o.spec.clusterIP], ['Ports', servicePorts(o)], ['Endpoints', endpointsText(s, o)]];
    case 'ConfigMap':
      return [...base, ['Keys', Object.keys(o.data).join(', ') || '<none>']];
    case 'PersistentVolumeClaim':
      return [...base, ['Status', o.status.phase], ['Volume', o.spec.volumeName ?? '<none>'], ['Capacity', o.status.capacity ?? '<pending>'], ['Access modes', o.spec.accessModes.join(', ')]];
  }
};

/** Everything the learner has created, grouped by namespace and kind, with details, YAML and "locate in 3D". */
export function MyCluster({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const sim = usePlayground((s) => s.sim);
  const selected = usePlayground((s) => s.selected);
  const select = usePlayground((s) => s.select);
  const resetCluster = usePlayground((s) => s.resetCluster);
  const [confirmReset, setConfirmReset] = useState(false);

  const groups = useMemo(() => {
    const byNs = new Map<string, KObject[]>();
    for (const o of sim.objects) byNs.set(o.metadata.namespace, [...(byNs.get(o.metadata.namespace) ?? []), o]);
    return [...byNs.entries()].map(([ns, objs]) => ({ ns, kinds: ORDER.map((k) => ({ kind: k, objs: objs.filter((o) => o.kind === k) })).filter((g) => g.objs.length) }));
  }, [sim.objects]);

  const current = selected ? sim.objects.find((o) => o.kind === selected.kind && o.metadata.name === selected.name && o.metadata.namespace === selected.namespace) : undefined;
  const count = sim.objects.length;

  return (
    <div className="glass flex h-full min-h-0 flex-col overflow-hidden rounded-2xl">
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <button type="button" className="flex min-w-0 items-center gap-2 text-left" onClick={onToggle} aria-expanded={!collapsed}>
          <Boxes className="size-4 text-teal" />
          <span className="font-display text-[13.5px] font-semibold text-white">My Cluster</span>
          <span className="chip !py-0">{count}</span>
          <ChevronDown className={`size-3.5 text-lavender/60 transition-transform ${collapsed ? '' : 'rotate-180'}`} />
        </button>
        {!collapsed &&
          (confirmReset ? (
            <span className="ml-auto flex items-center gap-1 text-[11.5px] text-lavender/80">
              Delete everything?
              <button
                type="button"
                className="hud-btn !py-0.5 !text-bad"
                onClick={() => {
                  resetCluster();
                  setConfirmReset(false);
                }}
              >
                Reset
              </button>
              <button type="button" className="hud-btn !py-0.5" onClick={() => setConfirmReset(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" className="hud-btn ml-auto !py-0.5" onClick={() => setConfirmReset(true)} disabled={count === 0} title="Delete every object you created. Files and lesson progress are kept.">
              <RotateCcw className="size-3.5" /> Reset cluster
            </button>
          ))}
      </div>
      {!collapsed && (
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {current ? (
            <Details sim={sim} object={current} onBack={() => select(null)} />
          ) : count === 0 ? (
            <p className="px-2 py-3 text-[12.5px] leading-relaxed text-lavender/60">
              Nothing here yet. Objects you create with <code className="font-mono text-cyan">kubectl apply</code> appear in this list and in the world.
            </p>
          ) : (
            groups.map((g) => (
              <div key={g.ns} className="mb-2">
                <p className="px-2 pb-1 pt-1 font-mono text-[10px] uppercase tracking-wider text-lavender/45">namespace · {g.ns}</p>
                {g.kinds.map(({ kind, objs }) => (
                  <div key={kind} className="mb-1.5">
                    <p className="section-title !mb-0.5 px-2">{PLURAL[kind]}</p>
                    {objs.map((o) => {
                      const { text, health } = summary(o);
                      const ref: ResourceRef = { kind: o.kind, name: o.metadata.name, namespace: o.metadata.namespace };
                      return (
                        <button
                          key={o.metadata.uid}
                          type="button"
                          onClick={() => {
                            select(ref);
                            locate(ref);
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-white/[0.05]"
                        >
                          <span className={`size-2 shrink-0 rounded-full ${DOT[health]}`} />
                          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-white">{o.metadata.name}</span>
                          <span className="shrink-0 font-mono text-[10.5px] text-lavender/60">{text}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function Details({ sim, object: o, onBack }: { sim: SimState; object: KObject; onBack: () => void }) {
  const [tab, setTab] = useState<'status' | 'yaml'>('status');
  const run = usePlayground((s) => s.run);
  const ref: ResourceRef = { kind: o.kind, name: o.metadata.name, namespace: o.metadata.namespace };
  const events = sim.events.filter((e) => e.object.kind === o.kind && e.object.name === o.metadata.name).slice(-6);
  const { text, health } = summary(o);
  const resource = o.kind === 'PersistentVolumeClaim' ? 'pvc' : o.kind.toLowerCase();

  return (
    <div className="kv-card-in flex flex-col gap-2 px-1">
      <div className="flex items-center gap-1">
        <button type="button" className="hud-btn !px-1.5 !py-0.5" onClick={onBack} aria-label="Back to the list">
          <ArrowLeft className="size-3.5" />
        </button>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-lavender/55">{o.kind}</p>
          <p className="truncate font-mono text-[13px] font-semibold text-white">{o.metadata.name}</p>
        </div>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[10.5px] text-lavender/70">
          <span className={`size-2 rounded-full ${DOT[health]}`} /> {text}
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        <button type="button" className="hud-btn !py-0.5" onClick={() => locate(ref)}>
          <Crosshair className="size-3.5" /> Locate in 3D
        </button>
        <button type="button" className="hud-btn !py-0.5" onClick={() => run(`kubectl describe ${resource} ${o.metadata.name}`)}>
          <TerminalSquare className="size-3.5" /> Describe
        </button>
        <div className="ml-auto flex rounded-lg bg-white/[0.04] p-0.5">
          {(['status', 'yaml'] as const).map((t) => (
            <button key={t} type="button" className={`rounded-md px-2 py-0.5 text-[11px] ${tab === t ? 'bg-white/10 text-white' : 'text-lavender/60'}`} onClick={() => setTab(t)}>
              {t === 'status' ? 'Status' : 'YAML'}
            </button>
          ))}
        </div>
      </div>
      {tab === 'status' ? (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11.5px]">
            {facts(sim, o).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-lavender/55">{k}</dt>
                <dd className="min-w-0 break-words font-mono text-lilac select-text">{v}</dd>
              </div>
            ))}
          </dl>
          {events.length > 0 && (
            <div>
              <p className="section-title !mb-1 flex items-center gap-1">
                <ScrollText className="size-3" /> Recent events
              </p>
              <ul className="flex flex-col gap-0.5">
                {events.map((e) => (
                  <li key={e.seq} className="text-[11px] leading-snug">
                    <span className={e.type === 'Warning' ? 'text-warn' : 'text-teal/90'}>{e.reason}</span> <span className="text-lavender/70">{e.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <CodeBlock code={toYaml(toApiObject(o))} className="!text-[11px]" />
      )}
    </div>
  );
}
