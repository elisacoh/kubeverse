import { Fragment } from 'react';

/** Text with `inline code` and **bold** spans, as lesson content is written. */
export function Rich({ text, className = '' }: { text: string; className?: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.startsWith('`') && p.endsWith('`') && p.length > 2 ? (
          <code key={i} className="rounded bg-white/[0.07] px-1 py-px font-mono text-[0.88em] text-cyan">
            {p.slice(1, -1)}
          </code>
        ) : p.startsWith('**') && p.endsWith('**') && p.length > 4 ? (
          <strong key={i} className="font-semibold text-white">
            {p.slice(2, -2)}
          </strong>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </span>
  );
}

export function CodeBlock({ code, className = '' }: { code: string; className?: string }) {
  return (
    <pre className={`scrollbar-thin overflow-x-auto rounded-xl border border-white/[0.08] bg-[#070d24]/80 p-3 font-mono text-[12px] leading-relaxed text-lilac select-text ${className}`}>
      {code}
    </pre>
  );
}
