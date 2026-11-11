import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Circle, Eye, FileInput, Lightbulb, ListChecks, Sparkles, XCircle } from 'lucide-react';
import { validateExercise, type ExerciseValidation } from '../../playground/curriculum/checks';
import { modeOf } from '../../playground/curriculum/progress';
import { guidedHints, type GuidedHints } from '../../playground/curriculum/guidedHints';
import { judgeWhileTyping } from '../../playground/editor/typing';
import type { ExerciseMode, WriteStep } from '../../playground/curriculum/types';
import { usePlayground } from '../../playground/store';
import { FieldDocCard } from './FieldDocs';
import { CodeBlock, Rich } from './Rich';

const MODES: { id: ExerciseMode; label: string; hint: string }[] = [
  { id: 'guided', label: 'Guided', hint: 'Build the manifest field by field, each step checked on its own.' },
  { id: 'complete', label: 'Complete YAML', hint: 'Fill in the blanks (___) in a prepared manifest.' },
  { id: 'scratch', label: 'From scratch', hint: 'A blank file: write the whole manifest yourself.' },
];

const HINT_LABEL = ['Concept', 'Structure', 'Snippet'];

export function WriteStepView({ step, lessonId }: { step: WriteStep; lessonId: string }) {
  const ex = step.exercise;
  const progress = usePlayground((s) => s.progress[lessonId as keyof typeof s.progress]);
  const text = usePlayground((s) => s.files[ex.file] ?? '');
  const setMode = usePlayground((s) => s.setMode);
  const checkWrite = usePlayground((s) => s.checkWrite);
  const openFile = usePlayground((s) => s.openFile);
  const activeFile = usePlayground((s) => s.activeFile);
  const done = !!progress?.done.includes(step.id);
  const mode = modeOf(progress, step);
  const guided = ex.modes?.guided ?? [];
  const g = progress?.guided[step.id] ?? 0;
  const gIndex = Math.min(g, Math.max(guided.length - 1, 0));
  const [attempted, setAttempted] = useState(false);
  const deferred = useDeferredValue(text);
  const typingLine = usePlayground((s) => (s.cursor?.file === ex.file ? s.cursor.line : null));
  const result = useMemo(
    () => judgeWhileTyping(deferred, typingLine, (t) => validateExercise(ex, t, mode, gIndex), (r) => r.syntax.map((i) => i.line)),
    [ex, deferred, mode, gIndex, typingLine],
  );
  const current = mode === 'guided' && guided.length && !done ? guided[gIndex] : undefined;
  const guidedTop = useRef<HTMLDivElement>(null);
  const shownStep = useRef(gIndex);

  useEffect(() => {
    if (shownStep.current === gIndex) return;
    shownStep.current = gIndex;
    const el = guidedTop.current;
    const box = el?.closest<HTMLElement>('.overflow-y-auto');
    if (el && box) box.scrollTo({ top: box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top - 12, behavior: 'smooth' });
  }, [gIndex]);

  const onCheck = () => {
    const r = checkWrite(step.id);
    setAttempted(!!r && !r.passed);
  };

  return (
    <div className="flex flex-col gap-3">
      {step.intro?.map((p, i) => (
        <p key={i} className="text-[13px] leading-relaxed text-lavender/85">
          <Rich text={p} />
        </p>
      ))}
      <div className="rounded-xl border border-teal/25 bg-teal/[0.06] px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-teal/90">Objective</p>
        <p className="text-[13px] leading-relaxed text-white">
          <Rich text={ex.objective} />
        </p>
        <p className="mt-1 text-[11.5px] text-lavender/60">
          In <code className="font-mono text-cyan">{ex.file}</code>
          {activeFile !== ex.file && (
            <button type="button" className="ml-2 text-teal underline-offset-2 hover:underline" onClick={() => openFile(ex.file)}>
              open it
            </button>
          )}
        </p>
      </div>

      {ex.modes && (
        <div>
          <div role="tablist" aria-label="Exercise mode" className="flex rounded-xl bg-white/[0.04] p-0.5">
            {MODES.map((m) => (
              <button
                key={m.id}
                role="tab"
                type="button"
                aria-selected={mode === m.id}
                title={m.hint}
                onClick={() => {
                  setAttempted(false);
                  setMode(step.id, m.id);
                }}
                className={`flex-1 rounded-lg px-2 py-1 text-[11.5px] font-medium transition-colors ${mode === m.id ? 'bg-white/10 text-white' : 'text-lavender/60 hover:text-lavender'}`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="mt-1 px-1 text-[11px] text-lavender/50">{MODES.find((m) => m.id === mode)?.hint} Your work in each mode is kept.</p>
        </div>
      )}

      {mode === 'guided' && guided.length > 0 && (
        <div ref={guidedTop} className="flex items-center gap-1" aria-label="Guided steps">
          {guided.map((s, i) => (
            <span key={s.title} title={s.title} className={`h-1 flex-1 rounded-full ${i < g || done ? 'bg-teal' : i === gIndex ? 'bg-cyan/60' : 'bg-white/10'}`} />
          ))}
        </div>
      )}

      {current && <GuidedCard key={`${step.id}-${gIndex}`} index={gIndex} total={guided.length} step={current} kind={ex.kind} />}

      <Results result={result} attempted={attempted} />

      {done ? (
        <p className="kv-card-in flex items-center gap-2 rounded-xl border border-ok/30 bg-ok/10 px-3 py-2 text-[13px] text-white">
          <CheckCircle2 className="size-4 shrink-0 text-ok" />
          <span>
            {ex.toy ? (
              <Rich text={`Valid YAML. For fun, run \`kubectl apply -f ${ex.file}\` in the terminal and look at the world.`} />
            ) : ex.kind ? (
              'Manifest complete. Next: deploy it.'
            ) : (
              'Valid YAML, every check passes.'
            )}
          </span>
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          <button type="button" className="primary-btn justify-center !py-2 !text-[13px]" onClick={onCheck}>
            <ListChecks className="size-4" /> {current && gIndex < guided.length - 1 ? 'Check this step' : 'Check my manifest'}
          </button>
          {attempted && !result.passed && <p className="text-center text-[11.5px] text-lavender/60">Not yet: the list above shows what is missing.</p>}
        </div>
      )}

      <Assistance step={step} lessonId={lessonId} guided={current ? { key: `${step.id}#${gIndex}`, hints: guidedHints(ex, gIndex, result.objectives) } : undefined} />
    </div>
  );
}

function GuidedCard({ index, total, step, kind }: { index: number; total: number; step: NonNullable<WriteStep['exercise']['modes']>['guided'][number]; kind: WriteStep['exercise']['kind'] }) {
  const [example, setExample] = useState(false);
  return (
    <div className="kv-card-in rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-cyan/80">
        Step {index + 1} of {total}
      </p>
      <p className="font-display text-[14.5px] font-semibold text-white">{step.title}</p>
      {step.explain.map((p, i) => (
        <p key={i} className="mt-1 text-[12.5px] leading-relaxed text-lavender/80">
          <Rich text={p} />
        </p>
      ))}
      <p className="mt-2 rounded-lg bg-cyan/[0.07] px-2.5 py-1.5 text-[12.5px] leading-relaxed text-white">
        <Rich text={step.instruction} />
      </p>
      {kind && step.fields.length > 0 && (
        <div className="mt-2 flex flex-col gap-1.5">
          {step.fields.map((f) => (
            <FieldDocCard key={f} kind={kind} path={f} compact />
          ))}
        </div>
      )}
      <button type="button" className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-medium text-teal/90 hover:text-teal" onClick={() => setExample((e) => !e)} aria-expanded={example}>
        <ChevronDown className={`size-3 transition-transform ${example ? 'rotate-180' : ''}`} /> {example ? 'Hide example' : 'Show example syntax'}
      </button>
      {example && <CodeBlock code={step.snippet} className="mt-1.5" />}
    </div>
  );
}

function Results({ result, attempted }: { result: ExerciseValidation; attempted: boolean }) {
  const schema = attempted ? result.schema : result.schema.filter((i) => !i.pending);
  if (result.syntax.length) {
    const i = result.syntax[0]!;
    return (
      <div className="rounded-xl border border-bad/30 bg-bad/[0.08] px-3 py-2">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#ff9a9a]">
          <XCircle className="size-3.5" /> YAML syntax{i.line ? ` · line ${i.line}` : ''}
        </p>
        <p className="mt-0.5 text-[12.5px] text-white">{i.message}</p>
        {i.hint && <p className="mt-0.5 text-[12px] text-lavender/75">{i.hint}</p>}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {schema.length > 0 && (
        <div className="rounded-xl border border-warn/30 bg-warn/[0.07] px-3 py-2">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-warn">
            <AlertTriangle className="size-3.5" /> Kubernetes schema
          </p>
          <ul className="mt-1 flex flex-col gap-1">
            {schema.slice(0, 4).map((i, n) => (
              <li key={n} className="text-[12.5px] leading-snug text-white">
                {i.line && <span className="font-mono text-[11px] text-lavender/55">line {i.line} · </span>}
                <Rich text={i.message} />
                {i.hint && <span className="block text-[12px] text-lavender/70">{i.hint}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.objectives.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label="Objectives">
          {result.objectives.map((o) => (
            <li key={o.id} className="flex items-start gap-2 text-[12.5px] leading-snug">
              {o.ok ? <CheckCircle2 className="mt-px size-4 shrink-0 text-ok" /> : <Circle className="mt-px size-4 shrink-0 text-lavender/35" />}
              <span className={o.ok ? 'text-lavender/80' : 'text-white'}>
                <Rich text={o.label} />
                {!o.ok && o.feedback && <span className="block text-[12px] text-lavender/65"><Rich text={o.feedback} /></span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Assistance({ step, lessonId, guided }: { step: WriteStep; lessonId: string; guided?: { key: string; hints: GuidedHints | null } }) {
  const ex = step.exercise;
  const progress = usePlayground((s) => s.progress[lessonId as keyof typeof s.progress]);
  const revealHint = usePlayground((s) => s.revealHint);
  const showSolution = usePlayground((s) => s.showSolution);
  const applySolution = usePlayground((s) => s.applySolution);
  const g = guided?.hints ? guided : undefined;
  const hintKey = g?.key ?? step.id;
  const hints = progress?.hints[hintKey] ?? 0;
  const viewed = !!progress?.solutionViewed.includes(step.id);
  const cards: { label: string; paragraphs?: string[]; code?: string }[] = g
    ? [
        { label: 'Where to start', paragraphs: g.hints!.missing },
        { label: 'Where it goes', paragraphs: g.hints!.structure },
        { label: 'The file at this step', code: g.hints!.snippet },
      ]
    : ex.hints.map((h, i) => (i === 2 ? { label: HINT_LABEL[i]!, code: h } : { label: HINT_LABEL[i]!, paragraphs: [h] }));

  return (
    <div className="flex flex-col gap-2 border-t border-white/[0.06] pt-3">
      {cards.slice(0, hints).map((c, i) => (
        <div key={`${hintKey}-${i}`} className="kv-card-in rounded-xl border border-gold/20 bg-gold/[0.05] px-3 py-2">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-gold/90">
            <Lightbulb className="size-3" /> {g ? 'Step hint' : 'Hint'} {i + 1} · {c.label}
          </p>
          {c.code !== undefined ? (
            <CodeBlock code={c.code} className="mt-1" />
          ) : (
            c.paragraphs?.map((p, n) => (
              <p key={n} className="mt-0.5 text-[12.5px] leading-relaxed text-white">
                <Rich text={p} />
              </p>
            ))
          )}
        </div>
      ))}
      {viewed && (
        <div className="kv-card-in rounded-xl border border-warm/25 bg-warm/[0.05] p-3">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-warm">
            <Eye className="size-3" /> Solution
          </p>
          <CodeBlock code={ex.solution} className="mt-1.5" />
          <ul className="mt-2 flex flex-col gap-1">
            {ex.solutionNotes.map((n) => (
              <li key={n.field} className="text-[12px] leading-snug text-lavender/80">
                <code className="font-mono text-cyan">{n.field}</code>: {n.note}
              </li>
            ))}
          </ul>
          <button type="button" className="hud-btn mt-2 !px-2" onClick={() => applySolution(step.id)}>
            <FileInput className="size-3.5" /> Put it in the editor
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {hints < 3 && (
          <button type="button" className="hud-btn !border !border-gold/25 !px-2 !text-gold" onClick={() => revealHint(hintKey)}>
            <Lightbulb className="size-3.5" /> {hints === 0 ? (g ? 'Need a hint for this step?' : 'Need a hint?') : `Hint ${hints + 1}`}
          </button>
        )}
        {hints >= 3 && !viewed && (
          <button type="button" className="hud-btn !px-2 !text-warm" onClick={() => showSolution(step.id)}>
            <Sparkles className="size-3.5" /> Show solution
          </button>
        )}
        {(hints > 0 || viewed) && <span className="text-[11px] text-lavender/45">{viewed ? 'Solution viewed: noted with your progress.' : 'Hints used are noted with your progress.'}</span>}
      </div>
    </div>
  );
}
