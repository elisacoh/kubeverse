import { ArrowRight, BookOpen, Flame, Route, type LucideIcon } from 'lucide-react';
import { LESSONS } from '../../playground/curriculum';
import { lessonsDone, usePlayground, type PlaygroundView } from '../../playground/store';

interface ModeCard {
  view: PlaygroundView;
  title: string;
  tagline: string;
  body: string;
  icon: LucideIcon;
  tone: string;
  available: boolean;
}

const CARDS: ModeCard[] = [
  {
    view: 'lessons',
    title: 'Lessons',
    tagline: 'Learn by writing real YAML',
    body: 'Step-by-step lessons: understand a concept, write the manifest, deploy it with kubectl, watch it in 3D and verify.',
    icon: BookOpen,
    tone: 'from-teal/25 to-cyan/10 text-teal',
    available: true,
  },
  {
    view: 'scenarios',
    title: 'Scenarios',
    tagline: 'Troubleshoot guided incidents',
    body: 'Something is broken. Read the symptoms, investigate with kubectl and fix it, with hints when you need them.',
    icon: Route,
    tone: 'from-cyan/20 to-lavender/10 text-cyan',
    available: false,
  },
  {
    view: 'hardcore',
    title: 'Hardcore',
    tagline: 'No guidance, a clock running',
    body: 'Real incidents on a cluster under pressure. Find the cause before it takes everything down.',
    icon: Flame,
    tone: 'from-bad/25 to-warn/10 text-[#ff9a9a]',
    available: false,
  },
];

export function PlaygroundHub() {
  const setView = usePlayground((s) => s.setView);
  const done = usePlayground(lessonsDone);

  return (
    <div className="mx-auto flex min-h-full max-w-6xl flex-col justify-center gap-8 px-4 pb-10 pt-24 lg:px-8">
      <div className="kv-card-in max-w-2xl">
        <span className="chip !border-teal/40 !text-teal">PLAYGROUND</span>
        <h1 className="mt-3 font-display text-[32px] font-semibold leading-tight tracking-tight text-white sm:text-[38px]">
          Kubernetes, hands on.
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-lavender/80">
          A simulated cluster runs in your browser. Write manifests, apply them with kubectl, and watch every object come alive in the world behind this page.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {CARDS.map((c, i) => {
          const Icon = c.icon;
          return (
            <button
              key={c.view}
              type="button"
              onClick={() => setView(c.view)}
              className="kv-card-in glass group flex flex-col gap-4 rounded-3xl p-6 text-left transition-transform duration-200 hover:-translate-y-1 hover:border-white/25 focus-visible:outline-2 focus-visible:outline-cyan"
              style={{ animationDelay: `${i * 70}ms` }}
            >
              <div className="flex items-center justify-between">
                <span className={`flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br ${c.tone}`}>
                  <Icon className="size-5" />
                </span>
                {c.available ? (
                  <span className="chip !border-ok/40 !text-ok">{done ? `${done}/${LESSONS.length} done` : `${LESSONS.length} lessons`}</span>
                ) : (
                  <span className="chip !text-lavender/80">COMING SOON</span>
                )}
              </div>
              <div>
                <p className="font-display text-[22px] font-semibold text-white">{c.title}</p>
                <p className="text-[13px] font-medium text-lavender/90">{c.tagline}</p>
              </div>
              <p className="flex-1 text-[13.5px] leading-relaxed text-lavender/70">{c.body}</p>
              <span className={`inline-flex items-center gap-1.5 text-[13px] font-semibold ${c.available ? 'text-teal' : 'text-lavender/70'}`}>
                {c.available ? (done ? 'Continue learning' : 'Start learning') : 'Get notified'}
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
