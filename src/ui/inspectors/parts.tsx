import { createContext, useContext, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useAppStore } from '../../state/useAppStore';

export type InspectorTab = 'details' | 'manifest';

/** Provided by the inspector panel when the inspected object has a manifest. */
export const InspectorTabsContext = createContext<{ tab: InspectorTab; setTab: (tab: InspectorTab) => void } | null>(
  null,
);

function InspectorTabs() {
  const tabs = useContext(InspectorTabsContext);
  if (!tabs) return null;
  return (
    <div role="tablist" aria-label="Inspector view" className="mt-3 flex gap-1 rounded-lg bg-white/[0.04] p-0.5">
      {(['details', 'manifest'] as const).map((t) => (
        <button
          key={t}
          type="button"
          role="tab"
          aria-selected={tabs.tab === t}
          onClick={() => tabs.setTab(t)}
          className={`flex-1 rounded-md px-2 py-1 text-[11px] font-medium capitalize transition ${
            tabs.tab === t ? 'bg-white/[0.1] text-white' : 'text-lavender/65 hover:text-white'
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

export function PanelHeader({
  kind,
  title,
  icon,
  accent,
  children,
  onClose,
}: {
  kind: string;
  title: string;
  icon: ReactNode;
  accent: string;
  children?: ReactNode;
  onClose?: () => void;
}) {
  const back = useAppStore((s) => s.back);
  return (
    <div>
      <div className="flex items-start gap-3">
        <div
          className="grid size-10 shrink-0 place-items-center rounded-xl"
          style={{ background: `color-mix(in srgb, ${accent} 18%, transparent)`, color: accent }}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: accent }}>
            {kind}
          </div>
          <h2 className="break-all font-mono text-[13.5px] font-medium leading-snug text-white">{title}</h2>
          {children && <div className="mt-1.5 flex flex-wrap gap-1">{children}</div>}
        </div>
        <button type="button" onClick={onClose ?? back} className="hud-btn -mr-1 -mt-1 !p-1.5" aria-label="Close panel">
          <X className="size-4" />
        </button>
      </div>
      <InspectorTabs />
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-white/[0.06] pt-3">
      <div className="section-title">{title}</div>
      {children}
    </section>
  );
}

export function Facts({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">{children}</dl>;
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-lavender/65">{label}</dt>
      <dd className="min-w-0 truncate text-right font-mono text-[11.5px] text-white/90">{children}</dd>
    </>
  );
}

export function LinkButton({ onClick, children, title }: { onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="max-w-full truncate rounded px-1 text-cyan underline decoration-cyan/30 underline-offset-2 hover:decoration-cyan"
    >
      {children}
    </button>
  );
}

export function Bar({ label, used, total, unit }: { label: string; used: number; total: number; unit: string }) {
  const pct = Math.min(100, (used / total) * 100);
  return (
    <div className="text-xs">
      <div className="mb-1 flex justify-between text-lavender/70">
        <span>{label}</span>
        <span className="font-mono text-[11px] text-white/85">
          {used}
          {unit} / {total}
          {unit}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full bg-gradient-to-r from-teal to-cyan" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Labels({ labels }: { labels: Readonly<Record<string, string>> }) {
  const entries = Object.entries(labels);
  if (!entries.length) return <p className="text-xs text-lavender/60">No labels</p>;
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([k, v]) => (
        <span key={k} className="chip max-w-full !rounded-md font-mono !text-[10px]">
          <span className="truncate">
            {k}
            {v ? <span className="text-lavender/70">={v}</span> : null}
          </span>
        </span>
      ))}
    </div>
  );
}
