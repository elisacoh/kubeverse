import { ChevronRight } from 'lucide-react';
import { findPod } from '../domain/selectors';
import { useAppStore } from '../state/useAppStore';

interface Crumb {
  key: string;
  kind: string;
  label: string;
  onClick?: () => void;
}

/** `compact` drops the kind labels (still in the tooltips) to fit a one-row title card. */
export function Breadcrumbs({ compact = false }: { compact?: boolean }) {
  const cluster = useAppStore((s) => s.cluster);
  const view = useAppStore((s) => s.view);
  const selection = useAppStore((s) => s.selection);
  const goToCluster = useAppStore((s) => s.goToCluster);
  const focusNode = useAppStore((s) => s.focusNode);
  const exitPod = useAppStore((s) => s.exitPod);
  const selectPod = useAppStore((s) => s.selectPod);

  const crumbs: Crumb[] = [
    cluster.nodes.length > 0
      ? { key: 'cluster', kind: 'Cluster', label: cluster.name, onClick: goToCluster }
      : { key: 'cluster', kind: 'Universe', label: 'empty' },
  ];

  const podUid = view.kind === 'pod' ? view.podUid : selection?.kind === 'pod' ? selection.uid : undefined;
  const pod = podUid ? findPod(cluster, podUid) : undefined;
  const nodeName = view.kind === 'node' ? view.nodeName : pod?.nodeName;

  if (nodeName) {
    crumbs.push({
      key: 'node',
      kind: 'Node',
      label: nodeName,
      onClick: () => (view.kind === 'pod' ? exitPod('node') : focusNode(nodeName)),
    });
  }
  if (pod) {
    crumbs.push({
      key: 'pod',
      kind: 'Pod',
      label: pod.metadata.name,
      onClick: () => selectPod(pod.metadata.uid),
    });
  }
  if (view.kind === 'pod') {
    crumbs.push({ key: 'inside', kind: 'View', label: 'Anatomy' });
    if (selection?.kind === 'container') {
      crumbs.push({ key: 'container', kind: 'Container', label: selection.name });
    }
  }

  return (
    <nav aria-label="Location" className="flex min-w-0 items-center gap-0.5 overflow-hidden">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={c.key} className="flex min-w-0 items-center gap-0.5">
            {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-lavender/50" />}
            {c.onClick && !last ? (
              <button
                type="button"
                onClick={c.onClick}
                className="hud-btn min-w-14 max-w-[140px] !px-2 !py-1 2xl:max-w-[220px]"
                title={`${c.kind}: ${c.label}`}
              >
                {!compact && <span className="hidden text-[9px] uppercase tracking-widest text-lavender/70 2xl:inline">{c.kind}</span>}
                <span className="truncate font-mono text-[11.5px]">{c.label}</span>
              </button>
            ) : (
              <span
                className="flex min-w-0 max-w-[260px] items-center gap-1.5 px-2 py-1 text-white"
                aria-current={last ? 'page' : undefined}
                title={`${c.kind}: ${c.label}`}
              >
                {!compact && <span className="text-[9px] uppercase tracking-widest text-cyan/80">{c.kind}</span>}
                <span className="truncate font-mono text-[11.5px]">{c.label}</span>
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
