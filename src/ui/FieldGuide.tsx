import { useState } from 'react';
import { BookOpen, X } from 'lucide-react';
import type { PodOrigin } from '../domain/types';
import { ORIGIN_LABEL } from '../domain/selectors';
import { namespaceColor } from '../scene/palette';

const TRAITS: { origin: PodOrigin; trait: string }[] = [
  { origin: 'replicaset', trait: 'Antenna — replicas share its tip colour' },
  { origin: 'daemonset', trait: 'Mini horns — one guardian per Node' },
  { origin: 'statefulset', trait: 'Numbered badge, tail + backpack — a unique, stable identity' },
  { origin: 'job', trait: 'Hourglass + star — temporary, runs to completion' },
  { origin: 'static', trait: 'Gold halo, crown + base plate — a system Pod owned by the kubelet' },
  { origin: 'standalone', trait: 'No trait — nothing manages it' },
];

/** Compact, collapsible key for reading the creatures. */
export function FieldGuide() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="pointer-events-auto glass hud-btn !rounded-xl">
        <BookOpen className="size-3.5" /> Field guide
      </button>
    );
  }

  return (
    <div className="pointer-events-auto glass w-[300px] rounded-2xl p-3.5 text-xs">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-display text-sm font-semibold text-white">Reading the world</span>
        <button type="button" onClick={() => setOpen(false)} className="hud-btn !p-1" aria-label="Close field guide">
          <X className="size-3.5" />
        </button>
      </div>

      <div className="section-title">Every creature is a Pod</div>
      <ul className="mb-3 space-y-1">
        {TRAITS.map((t) => (
          <li key={t.origin} className="flex gap-2">
            <span className="w-[78px] shrink-0 font-medium text-lilac">{ORIGIN_LABEL[t.origin].replace(' Pod', '')}</span>
            <span className="text-lavender/75">{t.trait}</span>
          </li>
        ))}
      </ul>

      <div className="section-title">Body colour = namespace</div>
      <div className="mb-3 flex flex-wrap gap-1">
        {Object.entries(namespaceColor).map(([ns, color]) => (
          <span key={ns} className="chip">
            <span className="size-2 rounded-full" style={{ background: color }} />
            {ns}
          </span>
        ))}
      </div>

      <div className="section-title">Also</div>
      <p className="leading-relaxed text-lavender/75">
        Belly lights are containers. Islands are Nodes; the hexagonal one is the control-plane Node. Light
        arcs are kubelets watching the API server.
      </p>
    </div>
  );
}
