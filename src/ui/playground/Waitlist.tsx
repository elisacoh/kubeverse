import { useState, type FormEvent } from 'react';
import { Check } from 'lucide-react';

/** Stored in the labelis.co admin. It only accepts requests from the deployed kubeverse.labelis.co origin. */
const WAITLIST_ENDPOINT = 'https://labelis.co/api/waitlist';

type Status = 'idle' | 'sending' | 'done' | 'error';

/** Collects an email to announce modes that are not open yet. */
export function Waitlist({ label = 'Want in? I will let you know when it is live.' }: { label?: string }) {
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
        {label}
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
