import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Eraser, TerminalSquare } from 'lucide-react';
import { completions, type Tone } from '../../playground/kubectl/run';
import { cluster, usePlayground } from '../../playground/store';

const TONE: Record<Tone, string> = {
  error: 'text-[#ff9a9a]',
  success: 'text-ok',
  muted: 'text-lavender/55',
  hint: 'text-gold/90',
  warn: 'text-warn',
};

const commonPrefix = (words: string[]) => words.reduce((p, w) => (w.startsWith(p) ? p : p.slice(0, [...p].findIndex((c, i) => w[i] !== c))), words[0] ?? '');

/** A kubectl shell over the simulated cluster: history, Tab completion, real output from cluster state. */
export function Terminal({ onFocusRequest }: { onFocusRequest?: (focus: () => void) => void }) {
  const entries = usePlayground((s) => s.entries);
  const history = usePlayground((s) => s.history);
  const busy = usePlayground((s) => s.busy);
  const run = usePlayground((s) => s.run);
  const clearTerminal = usePlayground((s) => s.clearTerminal);
  const [input, setInput] = useState('');
  const [cursor, setCursor] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onFocusRequest?.(() => field.current?.focus());
  }, [onFocusRequest]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, suggestions]);

  // The DOM value, not `input`: autofill and some input methods change the field without an onChange.
  const submit = async (line: string) => {
    if (busy) return;
    setInput('');
    setCursor(null);
    setSuggestions([]);
    await run(line);
  };

  const complete = () => {
    const options = completions(input, { api: cluster, files: usePlayground.getState().files });
    if (options.length === 0) return;
    const current = /\s$/.test(input) ? '' : (input.split(/\s+/).pop() ?? '');
    const base = input.slice(0, input.length - current.length);
    if (options.length === 1) {
      setInput(`${base}${options[0]} `);
      setSuggestions([]);
      return;
    }
    const prefix = commonPrefix(options);
    if (prefix.length > current.length) setInput(base + prefix);
    setSuggestions(options);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit(e.currentTarget.value);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      complete();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!history.length) return;
      const next = cursor === null ? history.length - 1 : Math.max(cursor - 1, 0);
      setCursor(next);
      setInput(history[next] ?? '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (cursor === null) return;
      const next = cursor + 1;
      if (next >= history.length) {
        setCursor(null);
        setInput('');
      } else {
        setCursor(next);
        setInput(history[next] ?? '');
      }
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      clearTerminal();
    } else if (e.key === 'c' && e.ctrlKey && !window.getSelection()?.toString()) {
      e.preventDefault();
      setInput('');
      setSuggestions([]);
    } else if (e.key === 'Escape') {
      setSuggestions([]);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#060b1e]" onClick={() => !window.getSelection()?.toString() && field.current?.focus()}>
      <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] bg-[#0a1029] px-3 py-1.5">
        <TerminalSquare className="size-3.5 text-teal" />
        <span className="font-mono text-[11.5px] text-lavender/75">terminal</span>
        <span className="chip !px-1.5 !py-0 !text-[9.5px] !text-lavender/60" title="Commands run against the Playground's simulated cluster, in your browser.">
          simulated cluster
        </span>
        <button type="button" className="hud-btn ml-auto !px-1.5 !py-0.5" onClick={clearTerminal} title="Clear (Ctrl+L)">
          <Eraser className="size-3.5" />
        </button>
      </div>
      <div ref={scroller} className="scrollbar-thin min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[12px] leading-[1.55] select-text" role="log" aria-live="polite">
        {entries.map((e) => (
          <div key={e.id} className="mb-1.5">
            {e.input && (
              <div className="flex gap-2 whitespace-pre-wrap break-all">
                <span className={e.source === 'setup' ? 'text-gold/80' : 'text-teal'}>{e.source === 'setup' ? 'setup $' : '$'}</span>
                <span className="text-white">{e.input}</span>
              </div>
            )}
            {e.lines.map((l, i) => (
              <div key={i} className={`whitespace-pre ${l.tone ? TONE[l.tone] : 'text-lilac/90'}`}>
                {l.text || ' '}
              </div>
            ))}
          </div>
        ))}
        {suggestions.length > 1 && <div className="mb-1 whitespace-pre-wrap text-lavender/60">{suggestions.join('   ')}</div>}
        <div className="flex items-center gap-2">
          <span className="text-teal">$</span>
          <input
            ref={field}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setSuggestions([]);
            }}
            onKeyDown={onKeyDown}
            disabled={busy}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            aria-label="Terminal command"
            placeholder={entries.length <= 1 ? 'kubectl get pods' : ''}
            className="min-w-0 flex-1 bg-transparent text-white caret-teal outline-none placeholder:text-lavender/25"
          />
        </div>
      </div>
    </div>
  );
}
