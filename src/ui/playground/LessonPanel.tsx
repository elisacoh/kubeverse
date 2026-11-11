import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Circle,
  FlaskConical,
  Loader2,
  MoreHorizontal,
  Play,
  RotateCcw,
  Trophy,
  Wand2,
  XCircle,
} from 'lucide-react';
import { LESSONS, lessonCode } from '../../playground/curriculum';
import { assistance, emptyProgress, frontier } from '../../playground/curriculum/progress';
import type { ClusterStep, CommandStep, Lesson, Phase, QuizStep, ReadStep, Step } from '../../playground/curriculum/types';
import { usePlayground } from '../../playground/store';
import { CodeBlock, Rich } from './Rich';
import { WriteStepView } from './WriteStepView';

const PHASES: { id: Phase; label: string }[] = [
  { id: 'understand', label: 'Understand' },
  { id: 'write', label: 'Write' },
  { id: 'deploy', label: 'Deploy' },
  { id: 'observe', label: 'Observe' },
  { id: 'verify', label: 'Verify' },
];

export function LessonPanel({ lesson }: { lesson: Lesson }) {
  const progress = usePlayground((s) => s.progress[lesson.id]) ?? emptyProgress();
  const setView = usePlayground((s) => s.setView);
  const goToStep = usePlayground((s) => s.goToStep);
  const nextStep = usePlayground((s) => s.nextStep);
  const restartLesson = usePlayground((s) => s.restartLesson);
  const celebrate = usePlayground((s) => s.celebrate);
  const [menu, setMenu] = useState(false);
  const index = Math.min(progress.stepIndex, lesson.steps.length - 1);
  const step = lesson.steps[index]!;
  const done = progress.done.includes(step.id);
  const reach = frontier(lesson, progress);
  const doneCount = lesson.steps.filter((s) => progress.done.includes(s.id)).length;
  const complete = !!progress.completedAt;
  const last = index === lesson.steps.length - 1;
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [lesson.id, index]);

  return (
    <div className="glass flex h-full min-h-0 flex-col overflow-hidden rounded-2xl">
      <div className="shrink-0 border-b border-white/[0.06] px-3 pb-2.5 pt-2">
        <div className="flex items-center gap-1">
          <button type="button" className="hud-btn -ml-1 !px-1.5" onClick={() => setView('lessons')} title="All lessons">
            <ArrowLeft className="size-3.5" /> Lessons
          </button>
          <span className="ml-auto font-mono text-[10.5px] text-lavender/50">
            {doneCount}/{lesson.steps.length} steps
          </span>
          <div className="relative">
            <button type="button" className="hud-btn !px-1.5" onClick={() => setMenu((m) => !m)} aria-label="Lesson options" aria-expanded={menu}>
              <MoreHorizontal className="size-4" />
            </button>
            {menu && (
              <div className="glass absolute right-0 top-full z-20 mt-1 w-48 rounded-xl p-1" onMouseLeave={() => setMenu(false)}>
                <button
                  type="button"
                  className="hud-btn w-full"
                  onClick={() => {
                    setMenu(false);
                    restartLesson(lesson.id);
                  }}
                >
                  <RotateCcw className="size-3.5" /> Restart this lesson
                </button>
              </div>
            )}
          </div>
        </div>
        <p className="mt-1 font-mono text-[10.5px] text-teal/80">{lessonCode(lesson)}</p>
        <h2 className="font-display text-[18px] font-semibold leading-tight text-white">{lesson.title}</h2>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.07]">
          <div className="h-full rounded-full bg-gradient-to-r from-teal to-cyan transition-[width] duration-500" style={{ width: `${(doneCount / lesson.steps.length) * 100}%` }} />
        </div>
        <ol className="mt-2 flex items-center gap-1" aria-label="Learning loop">
          {PHASES.map((p) => {
            const active = step.phase === p.id;
            const passed = lesson.steps.filter((s) => s.phase === p.id).every((s) => progress.done.includes(s.id)) && lesson.steps.some((s) => s.phase === p.id);
            return (
              <li
                key={p.id}
                className={`flex-1 rounded-md px-1 py-0.5 text-center text-[9.5px] font-semibold uppercase tracking-wider transition-colors ${
                  active ? 'bg-cyan/15 text-cyan' : passed ? 'text-teal/70' : 'text-lavender/35'
                }`}
              >
                {p.label}
              </li>
            );
          })}
        </ol>
      </div>

      <div ref={body} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <StartingPoint lesson={lesson} />
        {lesson.simulationNotes && <SimulationNotes notes={lesson.simulationNotes} />}

        <div className="mb-3 flex flex-wrap gap-1" aria-label="Steps">
          {lesson.steps.map((s, i) => {
            const isDone = progress.done.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => goToStep(i)}
                disabled={i > reach && !isDone}
                title={s.title}
                aria-current={i === index ? 'step' : undefined}
                className={`h-1.5 min-w-4 flex-1 rounded-full transition-colors disabled:cursor-not-allowed ${
                  i === index ? 'bg-cyan' : isDone ? 'bg-teal/60 hover:bg-teal' : 'bg-white/10 hover:bg-white/20'
                }`}
              />
            );
          })}
        </div>

        <div key={`${lesson.id}/${step.id}`} className="kv-card-in">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-lavender/50">
            Step {index + 1} · {PHASES.find((p) => p.id === step.phase)?.label}
          </p>
          <h3 className="mb-2 font-display text-[16px] font-semibold text-white">{step.title}</h3>
          <StepBody step={step} lessonId={lesson.id} />
        </div>

        {complete && last && <Completion lesson={lesson} />}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-white/[0.06] px-3 py-2">
        <button type="button" className="hud-btn" onClick={() => goToStep(index - 1)} disabled={index === 0}>
          <ArrowLeft className="size-3.5" /> Back
        </button>
        <span className="flex-1" />
        {!last && (
          <button
            key={done && celebrate?.stepId === step.id ? celebrate.seq : 'next'}
            type="button"
            onClick={nextStep}
            className={done ? 'primary-btn kv-card-in' : 'hud-btn'}
            title={done ? undefined : 'Skip this step for now'}
          >
            {done ? 'Next' : 'Skip'} <ArrowRight className="size-3.5" />
          </button>
        )}
        {last && !complete && reach !== index && (
          <button type="button" className="hud-btn" onClick={nextStep}>
            Back to unfinished step <ArrowRight className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function StepBody({ step, lessonId }: { step: Step; lessonId: string }) {
  switch (step.kind) {
    case 'read':
      return <ReadView step={step} />;
    case 'quiz':
      return <QuizView step={step} lessonId={lessonId} />;
    case 'write':
      return <WriteStepView step={step} lessonId={lessonId} />;
    case 'command':
      return <CommandView step={step} lessonId={lessonId} />;
    case 'cluster':
      return <ClusterView step={step} lessonId={lessonId} />;
  }
}

function useStepDone(lessonId: string, stepId: string) {
  return usePlayground((s) => !!s.progress[lessonId as keyof typeof s.progress]?.done.includes(stepId));
}

function ReadView({ step }: { step: ReadStep }) {
  const completeRead = usePlayground((s) => s.completeRead);
  const nextStep = usePlayground((s) => s.nextStep);
  return (
    <div className="flex flex-col gap-3">
      {step.cards.map((c) => (
        <Card key={c.title} card={c} />
      ))}
      <button
        type="button"
        className="primary-btn self-start"
        onClick={() => {
          completeRead(step.id);
          nextStep();
        }}
      >
        Got it <ArrowRight className="size-3.5" />
      </button>
    </div>
  );
}

function Card({ card }: { card: ReadStep['cards'][number] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
      <p className="font-display text-[14px] font-semibold text-white">{card.title}</p>
      {card.body.map((p, i) => (
        <p key={i} className="mt-1.5 text-[13px] leading-relaxed text-lavender/85">
          <Rich text={p} />
        </p>
      ))}
      {card.code && <CodeBlock code={card.code} className="mt-2" />}
      {card.more && (
        <>
          <button type="button" className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-medium text-teal/90 hover:text-teal" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            <ChevronDown className={`size-3 transition-transform ${open ? 'rotate-180' : ''}`} /> {open ? 'Less' : 'Go deeper'}
          </button>
          {open && (
            <div className="kv-card-in">
              {(Array.isArray(card.more) ? card.more : [card.more]).map((p, i) => (
                <p key={i} className="mt-1.5 text-[12.5px] leading-relaxed text-lavender/75">
                  <Rich text={p} />
                </p>
              ))}
              {card.moreCode && <CodeBlock code={card.moreCode} className="mt-2" />}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function QuizView({ step, lessonId }: { step: QuizStep; lessonId: string }) {
  const chosen = usePlayground((s) => s.progress[lessonId as keyof typeof s.progress]?.quiz[step.id]);
  const answerQuiz = usePlayground((s) => s.answerQuiz);
  const done = useStepDone(lessonId, step.id);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13.5px] leading-relaxed text-white">
        <Rich text={step.question} />
      </p>
      {step.code && <CodeBlock code={step.code} />}
      <div className="flex flex-col gap-1.5">
        {step.options.map((o, i) => {
          const picked = chosen === i;
          const tone = picked ? (o.correct ? 'border-ok/50 bg-ok/10' : 'border-bad/40 bg-bad/[0.08]') : 'border-white/[0.08] bg-white/[0.03] hover:border-white/20';
          return (
            <button key={i} type="button" disabled={done && !picked} onClick={() => answerQuiz(step.id, i)} className={`rounded-xl border px-3 py-2 text-left transition-colors disabled:opacity-50 ${tone}`}>
              <span className="flex items-start gap-2 text-[13px] text-white">
                {picked ? o.correct ? <CheckCircle2 className="mt-px size-4 shrink-0 text-ok" /> : <XCircle className="mt-px size-4 shrink-0 text-bad" /> : <Circle className="mt-px size-4 shrink-0 text-lavender/35" />}
                <Rich text={o.text} />
              </span>
              {picked && <span className="kv-card-in mt-1 block pl-6 text-[12px] leading-relaxed text-lavender/80"><Rich text={o.why} /></span>}
            </button>
          );
        })}
      </div>
      {chosen !== undefined && !done && <p className="text-[11.5px] text-lavender/55">Not quite. Read why, then try another answer.</p>}
    </div>
  );
}

function Explain({ lines }: { lines?: string[] }) {
  if (!lines?.length) return null;
  return (
    <div className="kv-card-in flex flex-col gap-1 rounded-xl border border-ok/25 bg-ok/[0.06] px-3 py-2">
      {lines.map((l, i) => (
        <p key={i} className="text-[12.5px] leading-relaxed text-lavender/90">
          <Rich text={l} />
        </p>
      ))}
    </div>
  );
}

function CommandView({ step, lessonId }: { step: CommandStep; lessonId: string }) {
  const done = useStepDone(lessonId, step.id);
  const run = usePlayground((s) => s.run);
  const busy = usePlayground((s) => s.busy);
  const placeholder = /…|xxxxx/.test(step.command);
  return (
    <div className="flex flex-col gap-2.5">
      {step.body.map((p, i) => (
        <p key={i} className="text-[13px] leading-relaxed text-lavender/85">
          <Rich text={p} />
        </p>
      ))}
      <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-[#060b1e] px-3 py-2">
        <span className="font-mono text-[12px] text-teal">$</span>
        <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-white select-text">{step.command}</code>
        {!placeholder && (
          <button type="button" className="hud-btn !px-1.5 !py-0.5" disabled={busy} onClick={() => run(step.command)} title="Run it in the terminal">
            <Play className="size-3.5" /> Run
          </button>
        )}
      </div>
      <Status done={done} waiting={step.hint} />
      {done && <Explain lines={step.explain} />}
    </div>
  );
}

function ClusterView({ step, lessonId }: { step: ClusterStep; lessonId: string }) {
  const done = useStepDone(lessonId, step.id);
  const message = usePlayground((s) => step.check(s.sim));
  return (
    <div className="flex flex-col gap-2.5">
      {step.body.map((p, i) => (
        <p key={i} className="text-[13px] leading-relaxed text-lavender/85">
          <Rich text={p} />
        </p>
      ))}
      {done ? (
        <Status done />
      ) : (
        <div className="flex items-start gap-2 rounded-xl border border-cyan/20 bg-cyan/[0.05] px-3 py-2">
          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-cyan" />
          <div className="text-[12.5px] leading-relaxed">
            <p className="text-white">
              <Rich text={message ?? 'Checking…'} />
            </p>
            <p className="mt-0.5 text-lavender/60">
              <Rich text={step.hint} />
            </p>
          </div>
        </div>
      )}
      {done && <Explain lines={step.explain} />}
    </div>
  );
}

function Status({ done, waiting }: { done: boolean; waiting?: string }) {
  return done ? (
    <p className="kv-card-in flex items-center gap-2 text-[12.5px] font-medium text-ok">
      <CheckCircle2 className="size-4" /> Done
    </p>
  ) : (
    <p className="flex items-start gap-2 text-[12px] leading-relaxed text-lavender/60">
      <Circle className="mt-0.5 size-3.5 shrink-0" />
      <Rich text={waiting ?? ''} />
    </p>
  );
}

function StartingPoint({ lesson }: { lesson: Lesson }) {
  const items = usePlayground((s) => (s.prepared?.lessonId === lesson.id ? s.prepared.items : null));
  const [hidden, setHidden] = useState<readonly string[] | null>(null);
  if (!items?.length || hidden === items) return null;
  return (
    <div className="kv-card-in mb-3 rounded-xl border border-gold/25 bg-gold/[0.06] p-3">
      <p className="flex items-start gap-1.5 text-[12.5px] leading-relaxed text-white">
        <Wand2 className="mt-0.5 size-3.5 shrink-0 text-gold" />
        <span>Your cluster starts where the previous lessons left off. Added for you:</span>
        <button type="button" className="hud-btn -mr-1 -mt-0.5 ml-auto !px-1 !py-0" onClick={() => setHidden(items)} aria-label="Dismiss">
          <XCircle className="size-3.5" />
        </button>
      </p>
      <p className="mt-1 font-mono text-[11px] leading-relaxed text-gold/85">{items.join(' · ')}</p>
    </div>
  );
}

function SimulationNotes({ notes }: { notes: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-1.5">
      <button type="button" className="flex w-full items-center gap-1.5 text-[11.5px] font-medium text-lavender/70" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <FlaskConical className="size-3.5" /> What is simulated here
        <ChevronDown className={`ml-auto size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul className="mt-1 flex list-disc flex-col gap-1 pb-1 pl-5 text-[11.5px] leading-relaxed text-lavender/65">
          {notes.map((n) => (
            <li key={n}>
              <Rich text={n} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Completion({ lesson }: { lesson: Lesson }) {
  const progress = usePlayground((s) => s.progress[lesson.id]);
  const openLesson = usePlayground((s) => s.openLesson);
  const setView = usePlayground((s) => s.setView);
  const next = LESSONS.find((l) => l.number === lesson.number + 1);
  const help = assistance(progress);
  return (
    <div className="kv-card-in kv-attention mt-4 rounded-2xl border bg-teal/[0.07] p-4">
      <p className="flex items-center gap-2 font-display text-[16px] font-semibold text-white">
        <Trophy className="size-5 text-gold" /> Lesson complete
      </p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-lavender/80">
        {help === 'none' ? 'Completed without hints. Well done.' : help === 'hints' ? 'Completed with some hints.' : 'Completed after viewing a solution. Try it again from scratch later to make it stick.'}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {next ? (
          <button type="button" className="primary-btn" onClick={() => openLesson(next.id)}>
            Next: {next.title} <ArrowRight className="size-3.5" />
          </button>
        ) : (
          <p className="text-[12.5px] text-teal">You have finished every lesson.</p>
        )}
        <button type="button" className="hud-btn" onClick={() => setView('lessons')}>
          All lessons
        </button>
      </div>
    </div>
  );
}
