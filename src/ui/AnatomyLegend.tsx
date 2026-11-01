import { useState } from 'react';
import { ChevronDown, Layers } from 'lucide-react';

const ITEMS = [
  {
    swatch: 'bg-lilac/60',
    title: 'Pod sandbox',
    text: 'Not a box of hardware — a set of Linux namespaces the containers share (network, IPC, UTS), held open by the tiny pause container.',
  },
  {
    swatch: 'bg-teal',
    title: 'Shared network namespace',
    text: 'All containers see one IP, one eth0 and one localhost. They can reach each other on localhost, and their ports must not collide.',
  },
  {
    swatch: 'bg-lavender',
    title: 'Containers',
    text: 'Each has its own filesystem and, by default, its own process tree. Click one to inspect it.',
  },
  {
    swatch: 'bg-warm',
    title: 'cgroups (on the Node)',
    text: 'Resource limits are enforced by the Node’s kernel. The kubelet and runtime create a Pod cgroup with one child per container — they live in the kernel, not inside the Pod.',
  },
];

export function AnatomyLegend() {
  const [open, setOpen] = useState(() => window.innerWidth >= 1600);
  return (
    <div className="pointer-events-auto glass w-[320px] max-w-[calc(100vw-1.5rem)] rounded-2xl p-3 text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2 font-display text-sm font-semibold text-white">
          <Layers className="size-4 text-teal" /> Pod anatomy
        </span>
        <ChevronDown className={`size-4 text-lavender/70 transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && (
        <ul className="mt-2.5 space-y-2.5">
          {ITEMS.map((i) => (
            <li key={i.title} className="flex gap-2.5">
              <span className={`mt-1 size-2 shrink-0 rounded-full ${i.swatch}`} />
              <div>
                <div className="font-medium text-white">{i.title}</div>
                <p className="leading-relaxed text-lavender/75">{i.text}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
