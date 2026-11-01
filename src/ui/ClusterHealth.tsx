import { useMemo, useState } from 'react';
import { Activity, ChevronDown } from 'lucide-react';
import { clusterHealth } from '../domain/selectors';
import { useAppStore } from '../state/useAppStore';

const HEALTH_STYLE = {
  healthy: { label: 'Healthy', dot: 'bg-ok', text: 'text-ok' },
  degraded: { label: 'Degraded', dot: 'bg-warn', text: 'text-warn' },
  critical: { label: 'Critical', dot: 'bg-bad', text: 'text-bad' },
} as const;

export function ClusterHealth() {
  const cluster = useAppStore((s) => s.cluster);
  const view = useAppStore((s) => s.view);
  const selectPod = useAppStore((s) => s.selectPod);
  const focusNode = useAppStore((s) => s.focusNode);
  const selectComponent = useAppStore((s) => s.selectComponent);
  const [open, setOpen] = useState(false);
  const summary = useMemo(() => clusterHealth(cluster), [cluster]);
  const style = HEALTH_STYLE[summary.health];
  const inside = view.kind === 'pod';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="glass hud-btn !rounded-xl !py-2"
      >
        <span className="relative flex size-2.5">
          <span className={`absolute inline-flex size-full animate-ping rounded-full opacity-50 ${style.dot}`} />
          <span className={`relative inline-flex size-2.5 rounded-full ${style.dot}`} />
        </span>
        <span className={`font-medium ${style.text}`}>{style.label}</span>
        <span className="hidden text-lavender/70 md:inline">
          {summary.nodesReady}/{summary.nodesTotal} nodes · {summary.podsHealthy}/{summary.podsTotal} pods
        </span>
        <ChevronDown className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="glass absolute right-0 top-full mt-2 w-80 rounded-xl p-3 text-xs">
          <div className="section-title flex items-center gap-1.5">
            <Activity className="size-3" /> Cluster health
          </div>
          <div className="mb-2 grid grid-cols-2 gap-2">
            <Stat label="Nodes ready" value={`${summary.nodesReady}/${summary.nodesTotal}`} />
            <Stat label="Pods healthy" value={`${summary.podsHealthy}/${summary.podsTotal}`} />
          </div>
          {summary.issues.length === 0 ? (
            <p className="text-lavender/70">No issues detected.</p>
          ) : (
            <ul className="space-y-1">
              {summary.issues.map((issue) => {
                const action = issue.podUid
                  ? () => selectPod(issue.podUid!)
                  : issue.nodeName
                    ? () => focusNode(issue.nodeName!)
                    : issue.componentUid
                      ? () => selectComponent(issue.componentUid!)
                      : undefined;
                return (
                  <li key={issue.message}>
                    <button
                      type="button"
                      disabled={!action || inside}
                      onClick={() => {
                        action?.();
                        setOpen(false);
                      }}
                      title={inside ? 'Leave the Pod anatomy view to jump to this object' : 'Show in world'}
                      className="hud-btn w-full !justify-start !rounded-lg !px-2 text-left font-mono !text-[11px] text-warn"
                    >
                      <span className="size-1.5 shrink-0 rounded-full bg-warn" />
                      <span className="truncate">{issue.message}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-2 border-t border-white/5 pt-2 text-[10.5px] text-lavender/60">
            Computed from demo data — not a live cluster.
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/[0.04] px-2.5 py-1.5">
      <div className="text-[10px] text-lavender/70">{label}</div>
      <div className="font-display text-base font-semibold text-white">{value}</div>
    </div>
  );
}
