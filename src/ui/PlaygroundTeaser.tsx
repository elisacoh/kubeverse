import { useState, type FormEvent } from 'react';
import { ArrowLeft, Check, Flame } from 'lucide-react';
import { useAppStore } from '../state/useAppStore';
import preview from '../assets/hardcore-preview.png';

/** Stored in the labelis.co admin. It only accepts requests from the deployed kubeverse.labelis.co origin. */
const WAITLIST_ENDPOINT = 'https://labelis.co/api/waitlist';

type Status = 'idle' | 'sending' | 'done' | 'error';

/** Playground is not built yet: show what the Hardcore mode will look like and collect emails for launch. */
export function PlaygroundTeaser() {
  const playground = useAppStore((s) => s.mode === 'playground');
  const setMode = useAppStore((s) => s.setMode);
  if (!playground) return null;

  return (
    <div className="fixed inset-0 z-20 overflow-y-auto bg-[#060a18]/75 backdrop-blur-md">
      <div className="flex min-h-full flex-col gap-6 px-4 pb-6 pt-20 lg:h-full lg:flex-row lg:items-center lg:gap-8 lg:px-8">
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
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#ff8a8a] to-warn">Fix it.</span>
            </h1>
            <p className="mt-3 text-[14px] leading-relaxed text-lavender/80">
              Real incidents, a kubectl terminal and a clock. Find the cause before it takes the whole cluster down.
            </p>
          </div>

          <Waitlist />

          <button type="button" className="hud-btn self-start" onClick={() => setMode('explore')}>
            <ArrowLeft className="size-3.5" /> Back to Explore
          </button>
        </div>
      </div>
    </div>
  );
}

function Waitlist() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setStatus('sending');
    try {
      const res = await fetch(WAITLIST_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ email }),
      });
      setStatus(res.ok ? 'done' : 'error');
    } catch {
      setStatus('error');
    }
  };

  if (status === 'done') {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-ok/30 bg-ok/10 p-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ok/20">
          <Check className="size-5 text-ok" />
        </span>
        <div>
          <p className="text-[14px] font-semibold text-white">You are on the list.</p>
          <p className="text-[12.5px] text-lavender/75">I will email {email} the day it opens.</p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label htmlFor="waitlist-email" className="text-[15px] font-semibold text-white">
        Want in? I will let you know when it is live.
      </label>
      <input
        id="waitlist-email"
        type="email"
        name="email"
        required
        autoComplete="email"
        placeholder="you@company.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="h-14 w-full select-text rounded-xl border border-white/15 bg-[#0b1430]/80 px-4 text-[16px] text-white outline-none placeholder:text-lavender/40 focus:border-cyan/60 focus:ring-2 focus:ring-cyan/25"
      />
      <button type="submit" disabled={status === 'sending'} className="primary-btn h-12 justify-center whitespace-nowrap !rounded-xl !px-7 !text-[15px] disabled:opacity-60">
        {status === 'sending' ? 'Sending…' : 'Notify me'}
      </button>
      {status === 'error' && <p className="text-[12px] text-bad">That did not go through. Please try again in a moment.</p>}
    </form>
  );
}
