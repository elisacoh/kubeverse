import { useState } from 'react';
import { ChevronDown, Info } from 'lucide-react';
import { describeType, lookupField } from '../../playground/sim/schema';
import type { Kind } from '../../playground/sim/types';
import { CodeBlock, Rich } from './Rich';

/** One field's documentation, in the context of a kind. Deeper details stay behind an expander. */
export function FieldDocCard({ kind, path, compact = false }: { kind: Kind; path: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const found = lookupField(kind, path.split('.'));
  if (!found) return null;
  const d = found.field.doc;
  const extra = !!(d.how || d.values || d.details || d.example);
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <code className="font-mono text-[12.5px] font-semibold text-cyan">{found.key}</code>
        <span className="font-mono text-[10.5px] text-lavender/55">{describeType(found.field.node)}</span>
        {found.field.required && <span className="text-[10px] uppercase tracking-wider text-warm/80">required</span>}
        <span className="ml-auto font-mono text-[10px] text-lavender/40">{found.path}</span>
      </div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-lavender/85">
        <Rich text={d.summary} />
      </p>
      {d.why && !compact && (
        <p className="mt-1 text-[12px] leading-relaxed text-lavender/70">
          <span className="font-semibold text-lavender/90">Why: </span>
          <Rich text={d.why} />
        </p>
      )}
      {extra && (
        <>
          <button type="button" className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-teal/90 hover:text-teal" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            <ChevronDown className={`size-3 transition-transform ${open ? 'rotate-180' : ''}`} /> {open ? 'Less' : 'More detail'}
          </button>
          {open && (
            <div className="mt-1.5 flex flex-col gap-1.5 text-[12px] leading-relaxed text-lavender/75">
              {compact && d.why && (
                <p>
                  <span className="font-semibold text-lavender/90">Why: </span>
                  <Rich text={d.why} />
                </p>
              )}
              {d.values && (
                <p>
                  <span className="font-semibold text-lavender/90">Accepted values: </span>
                  <Rich text={d.values} />
                </p>
              )}
              {d.how && (
                <p>
                  <span className="font-semibold text-lavender/90">How Kubernetes uses it: </span>
                  <Rich text={d.how} />
                </p>
              )}
              {d.example && <CodeBlock code={d.example} className="!text-[11.5px]" />}
              {d.details && (
                <p>
                  <Rich text={d.details} />
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** The field under the editor cursor. */
export function CursorField({ kind, path }: { kind: Kind | null; path: string | null }) {
  if (!kind || !path) {
    return (
      <p className="flex items-center gap-1.5 px-1 text-[11.5px] text-lavender/50">
        <Info className="size-3.5" /> Place the cursor on a field (or hover it) to see what it means.
      </p>
    );
  }
  return <FieldDocCard key={`${kind}:${path}`} kind={kind} path={path} compact />;
}
