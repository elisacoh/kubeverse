import { ArrowLeft, Flame, Route, Lock } from 'lucide-react';
import { usePlayground } from '../../playground/store';
import preview from '../../assets/hardcore-preview.png';
import { Waitlist } from './Waitlist';

const SCENARIOS = [
  { title: 'The rollout that never finishes', body: 'A new version is stuck at 1 of 3. Find out why before the old Pods are gone.' },
  { title: 'Nobody answers on port 80', body: 'The Service exists, the Pods run, yet traffic goes nowhere.' },
  { title: 'Pending forever', body: 'Three replicas asked for, two scheduled. Where did the third one go?' },
];

/** Modes that are designed but not open yet: a preview and the launch waitlist. */
export function ComingSoon({ mode }: { mode: 'scenarios' | 'hardcore' }) {
  const setView = usePlayground((s) => s.setView);
  const back = (
    <button type="button" className="hud-btn self-start" onClick={() => setView('hub')}>
      <ArrowLeft className="size-3.5" /> Back to Playground
    </button>
  );

  if (mode === 'hardcore') {
    return (
      <div className="flex min-h-full flex-col gap-6 px-4 pb-6 pt-24 lg:h-full lg:flex-row lg:items-center lg:gap-8 lg:px-8 lg:pt-20">
        <figure className="kv-card-in relative flex min-w-0 flex-1 items-center justify-center lg:h-full">
          <div className="absolute inset-6 rounded-[32px] bg-gradient-to-br from-bad/25 via-lavender/10 to-cyan/15 blur-3xl" aria-hidden />
          <img
            src={preview}
            alt="Preview of the Hardcore mode: a cluster under incident, with an incident feed, objectives and a kubectl terminal"
            className="relative max-h-full w-full rounded-2xl border border-white/10 object-contain shadow-2xl"
          />
        </figure>
        <div className="kv-card-in glass flex shrink-0 flex-col gap-5 rounded-3xl p-6 lg:w-[360px]">
          <span className="chip self-start !border-bad/50 !bg-bad/15 !text-[#ffb3b8]">
            <Flame className="size-3" /> HARDCORE MODE · SOON
          </span>
          <div>
            <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight text-white">
              Your cluster is on fire.
              <br />
              <span className="bg-gradient-to-r from-[#ff8a8a] to-warn bg-clip-text text-transparent">Fix it.</span>
            </h1>
            <p className="mt-3 text-[14px] leading-relaxed text-lavender/80">Real incidents, a kubectl terminal and a clock. Find the cause before it takes the whole cluster down.</p>
          </div>
          <Waitlist />
          {back}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-full max-w-5xl flex-col gap-6 px-4 pb-8 pt-24 lg:flex-row lg:items-center lg:gap-10 lg:px-8">
      <div className="kv-card-in flex min-w-0 flex-1 flex-col gap-3">
        {SCENARIOS.map((s, i) => (
          <div key={s.title} className="glass flex items-start gap-4 rounded-2xl p-4 opacity-90" style={{ animationDelay: `${i * 80}ms` }}>
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-cyan/10 text-cyan">
              <Lock className="size-4" />
            </span>
            <div>
              <p className="font-display text-[15px] font-semibold text-white">{s.title}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-lavender/75">{s.body}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="kv-card-in glass flex shrink-0 flex-col gap-5 rounded-3xl p-6 lg:w-[360px]">
        <span className="chip self-start !border-cyan/40 !bg-cyan/10 !text-cyan">
          <Route className="size-3" /> SCENARIOS · SOON
        </span>
        <div>
          <h1 className="font-display text-[26px] font-semibold leading-tight tracking-tight text-white">Something is broken. Investigate.</h1>
          <p className="mt-3 text-[14px] leading-relaxed text-lavender/80">
            Short troubleshooting stories built on what the lessons teach: read the symptoms, inspect with kubectl, fix the manifest, verify.
          </p>
        </div>
        <Waitlist label="Want to know when Scenarios open?" />
        {back}
      </div>
    </div>
  );
}
