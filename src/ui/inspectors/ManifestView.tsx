import { useState } from 'react';
import { Check, Copy, FileCode2 } from 'lucide-react';
import type { Manifest } from '../../domain/manifest';

const LINE = /^(\s*)(- )?(?:([^\s:"][^:]*|"[^"]*"):(?= |$))?(.*)$/;

function Value({ text }: { text: string }) {
  const v = text.trim();
  if (!v) return null;
  let color = 'text-white/90';
  if (v.startsWith('"')) color = 'text-[#f6d38a]';
  else if (/^(-?\d+(\.\d+)?|true|false|null|\[\]|\{\})$/.test(v)) color = 'text-cyan';
  return <span className={color}> {v}</span>;
}

function YamlLine({ line }: { line: string }) {
  const m = LINE.exec(line);
  if (!m) return <>{line}</>;
  const [, indent = '', dash, key, rest = ''] = m;
  return (
    <>
      {indent}
      {dash && <span className="text-lavender/50">- </span>}
      {key !== undefined ? (
        <>
          <span className="text-teal">{key}</span>
          <span className="text-lavender/50">:</span>
          <Value text={rest} />
        </>
      ) : (
        <Value text={rest} />
      )}
    </>
  );
}

export type LineMark = 'edit' | 'added' | 'status';

const MARK_CLASS: Record<LineMark, string> = {
  edit: 'bg-teal/[0.14] shadow-[inset_2px_0_0_var(--color-teal)]',
  added: 'bg-gold/[0.10] shadow-[inset_2px_0_0_var(--color-gold)]',
  status: 'bg-cyan/[0.08] shadow-[inset_2px_0_0_var(--color-cyan)]',
};

/** Syntax-highlighted YAML, with optional per-line marks. */
export function YamlBlock({ yaml, mark }: { yaml: string; mark?: (line: string, index: number) => LineMark | null }) {
  return (
    <pre className="scrollbar-thin overflow-x-auto rounded-xl bg-black/30 p-3 font-mono text-[11px] leading-[1.55] text-white/90">
      {yaml
        .trimEnd()
        .split('\n')
        .map((line, i) => {
          const m = mark?.(line, i);
          return (
            <div key={i} className={`-mx-1.5 whitespace-pre px-1.5 ${m ? MARK_CLASS[m] : ''}`}>
              <YamlLine line={line} />
            </div>
          );
        })}
    </pre>
  );
}

export function ManifestView({ manifest }: { manifest: Manifest }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(manifest.yaml).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };
  const lines = manifest.yaml.trimEnd().split('\n');

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <FileCode2 className="size-3.5 shrink-0 text-lavender/60" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-lavender/80" title={manifest.source}>
          {manifest.source}
        </span>
        <button type="button" onClick={copy} className="hud-btn !px-2 !py-1 text-[11px]" aria-label="Copy YAML">
          {copied ? <Check className="size-3.5 text-teal" /> : <Copy className="size-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {manifest.note && <p className="text-[11px] leading-relaxed text-lavender/70">{manifest.note}</p>}
      <pre className="scrollbar-thin overflow-x-auto rounded-xl bg-black/30 p-3 font-mono text-[11px] leading-[1.55] text-white/90">
        {lines.map((line, i) => (
          <div key={i} className="whitespace-pre">
            <YamlLine line={line} />
          </div>
        ))}
      </pre>
    </div>
  );
}
