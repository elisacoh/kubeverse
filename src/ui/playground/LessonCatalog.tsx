import { ArrowLeft, CheckCircle2, CircleDashed, Clock, Lightbulb, PlayCircle, RotateCcw, Eye } from 'lucide-react';
import { LESSONS, lessonCode } from '../../playground/curriculum';
import { assistance, lessonStatus } from '../../playground/curriculum/progress';
import { usePlayground } from '../../playground/store';
import type { Lesson } from '../../playground/curriculum/types';

const GROUPS: { title: string; body: string; lessons: Lesson[] }[] = [
  { title: 'Foundations', body: 'From YAML to self-healing Pods. Fully guided.', lessons: LESSONS.filter((l) => l.number <= 3) },
  { title: 'Going further', body: 'Deployments, networking, configuration, storage and health. Lighter guidance.', lessons: LESSONS.filter((l) => l.number > 3) },
];

export function LessonCatalog() {
  const setView = usePlayground((s) => s.setView);
  const progress = usePlayground((s) => s.progress);
  const openLesson = usePlayground((s) => s.openLesson);
  const objects = usePlayground((s) => s.sim.objects.length);
  const resetCluster = usePlayground((s) => s.resetCluster);
  const next = LESSONS.find((l) => !progress[l.id]?.completedAt);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 pb-10 pt-24 lg:px-8">
      <div className="kv-card-in flex flex-wrap items-end justify-between gap-4">
        <div>
          <button type="button" className="hud-btn -ml-2 mb-2" onClick={() => setView('hub')}>
            <ArrowLeft className="size-3.5" /> Playground
          </button>
          <h1 className="font-display text-[30px] font-semibold tracking-tight text-white">Lessons</h1>
          <p className="mt-1 max-w-xl text-[14px] text-lavender/75">Each lesson builds on the previous one, but any lesson can be started on its own: it offers to set up what it needs.</p>
        </div>
        <div className="glass flex items-center gap-3 rounded-2xl px-4 py-2.5 text-[12.5px] text-lavender/80">
          <span>
            Your cluster: <b className="text-white">{objects}</b> object{objects === 1 ? '' : 's'}
          </span>
          <button type="button" className="hud-btn !py-1" onClick={resetCluster} disabled={objects === 0} title="Delete every object you created. Lesson progress is kept.">
            <RotateCcw className="size-3.5" /> Reset cluster
          </button>
        </div>
      </div>

      {GROUPS.map((g) => (
        <section key={g.title} className="kv-card-in flex flex-col gap-3">
          <div>
            <p className="section-title !mb-0.5">{g.title}</p>
            <p className="text-[12.5px] text-lavender/60">{g.body}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {g.lessons.map((l) => {
              const p = progress[l.id];
              const status = lessonStatus(p);
              const help = assistance(p);
              const isNext = next?.id === l.id;
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => openLesson(l.id)}
                  className={`glass group flex flex-col gap-2.5 rounded-2xl p-4 text-left transition-transform duration-200 hover:-translate-y-0.5 hover:border-white/25 ${isNext ? 'ring-1 ring-teal/45' : ''}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] text-lavender/60">{lessonCode(l)}</span>
                    <StatusChip status={status} />
                  </div>
                  <div>
                    <p className="font-display text-[16.5px] font-semibold leading-snug text-white">{l.title}</p>
                    <p className="mt-0.5 text-[12.5px] leading-relaxed text-lavender/70">{l.tagline}</p>
                  </div>
                  <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="chip">
                      <Clock className="size-3" /> {l.minutes} min
                    </span>
                    <span className="chip">{l.level}</span>
                    {l.depth === 'interactive' && <span className="chip !text-lavender/70">lighter guidance</span>}
                    {status === 'completed' && help === 'hints' && (
                      <span className="chip !text-gold" title="Completed with hints">
                        <Lightbulb className="size-3" /> hints
                      </span>
                    )}
                    {status === 'completed' && help === 'solution' && (
                      <span className="chip !text-warm" title="Completed after viewing a solution">
                        <Eye className="size-3" /> solution viewed
                      </span>
                    )}
                    {isNext && <span className="chip !border-teal/40 !text-teal">up next</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function StatusChip({ status }: { status: ReturnType<typeof lessonStatus> }) {
  if (status === 'completed')
    return (
      <span className="chip !border-ok/40 !text-ok">
        <CheckCircle2 className="size-3" /> Completed
      </span>
    );
  if (status === 'in-progress')
    return (
      <span className="chip !border-cyan/40 !text-cyan">
        <PlayCircle className="size-3" /> In progress
      </span>
    );
  return (
    <span className="chip !text-lavender/70">
      <CircleDashed className="size-3" /> New
    </span>
  );
}
