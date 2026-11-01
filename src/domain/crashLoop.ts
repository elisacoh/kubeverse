/**
 * CrashLoopBackOff, as the scene shows it. A container in a restarting Pod
 * keeps failing; the kubelet restarts it in place after an exponentially
 * growing back-off. The Pod — and its creature — stays the same throughout.
 *
 * Two drivers, both allocation-free per frame:
 *  - simulated (demo data): a deterministic loop with doubling retry delays;
 *  - live (real data): follows observed container states and restart counts,
 *    and never invents a crash.
 */
import type { Container, Pod } from './types';

export type CrashLoopPhase = 'running' | 'crashing' | 'backoff' | 'restarting';

export interface CrashLoopFrame {
  phase: CrashLoopPhase;
  /** 0..1 through the current phase; for an unknown back-off, a slow repeating sweep. */
  progress: number;
  /** Seconds left in the current phase, or null when not known (live back-off). */
  remaining: number | null;
  /** Restart count to display. */
  restarts: number;
}

export const createFrame = (): CrashLoopFrame => ({ phase: 'running', progress: 0, remaining: null, restarts: 0 });

/** The kubelet's real policy: 10 s, doubling, capped at 5 min (reset after 10 min of running). */
export const KUBELET_BACKOFF = { initialS: 10, maxS: 300 } as const;

/** The demo compresses time so a loop is watchable: same doubling, smaller numbers. */
export const DEMO_LOOP = { runS: 2.4, crashS: 1, restartS: 0.9, initialS: 1.5, maxS: 12 } as const;
export type LoopTiming = { runS: number; crashS: number; restartS: number; initialS: number; maxS: number };

export const backoffDelay = (retry: number, initialS: number, maxS: number) => Math.min(maxS, initialS * 2 ** retry);

/** Transitions shown when following live data: brief, then the observed state is held. */
export const TRANSITION_S = { crashing: DEMO_LOOP.crashS, restarting: DEMO_LOOP.restartS } as const;
const SWEEP_S = 2.4;

const restartPolicyOf = (pod: Pod) => pod.restartPolicy ?? (pod.origin === 'job' ? 'OnFailure' : 'Always');

/** The container that is crash-looping, if any: waiting in CrashLoopBackOff now. */
export const crashLoopingContainer = (pod: Pod): Container | undefined =>
  pod.containers.find((c) => c.status.state === 'waiting' && c.status.reason === 'CrashLoopBackOff');

export interface Observation {
  /** null: nothing this animation describes (e.g. still being created, or finished for good). */
  phase: 'running' | 'backoff' | null;
  restarts: number;
}

/** Reads what the data says right now. A terminated container that will be restarted counts as backing off. */
export const observeCrashLoop = (pod: Pod): Observation => {
  const restarts = pod.containers.reduce((n, c) => n + c.restartCount, 0);
  if (crashLoopingContainer(pod)) return { phase: 'backoff', restarts };
  const policy = restartPolicyOf(pod);
  const failedAndRetrying = pod.containers.some(
    (c) => c.status.state === 'terminated' && (policy === 'Always' || (policy === 'OnFailure' && c.status.exitCode !== 0)),
  );
  if (failedAndRetrying && pod.phase === 'Running') return { phase: 'backoff', restarts };
  if (pod.phase === 'Running' && pod.containers.every((c) => c.status.state === 'running')) return { phase: 'running', restarts };
  return { phase: null, restarts };
};

/**
 * Simulated loop at `t` seconds since the creature started showing it. The Pod
 * is already in CrashLoopBackOff, so the loop opens in back-off:
 * back-off(n) → restarting → running → crashing → back-off(n+1) …
 */
export function simulateCrashLoop(t: number, baseRestarts: number, timing: LoopTiming, out: CrashLoopFrame): CrashLoopFrame {
  const { runS, crashS, restartS, initialS, maxS } = timing;
  let rem = Math.max(0, t);
  let n = 0;
  for (;;) {
    const delay = backoffDelay(n, initialS, maxS);
    const cycle = delay + restartS + runS + crashS;
    if (delay >= maxS && rem >= cycle) {
      const k = Math.floor(rem / cycle);
      n += k;
      rem -= k * cycle;
    }
    if (rem < cycle) break;
    rem -= cycle;
    n++;
  }
  const delay = backoffDelay(n, initialS, maxS);
  const set = (phase: CrashLoopPhase, elapsed: number, duration: number, restarts: number) => {
    out.phase = phase;
    out.progress = duration > 0 ? elapsed / duration : 1;
    out.remaining = duration - elapsed;
    out.restarts = restarts;
    return out;
  };
  if (rem < delay) return set('backoff', rem, delay, baseRestarts + n);
  rem -= delay;
  // The restart itself is what bumps the counter.
  if (rem < restartS) return set('restarting', rem, restartS, baseRestarts + n + 1);
  rem -= restartS;
  if (rem < runS) return set('running', rem, runS, baseRestarts + n + 1);
  rem -= runS;
  return set('crashing', rem, crashS, baseRestarts + n + 1);
}

/** Mutable per-creature memory for the live driver. */
export interface LiveCrashLoop {
  held: Observation['phase'] | undefined;
  restarts: number;
  transition: 'crashing' | 'restarting' | null;
  since: number;
}

export const createLiveCrashLoop = (): LiveCrashLoop => ({ held: undefined, restarts: 0, transition: null, since: 0 });

/**
 * Live driver: plays a short transition only when the data changes — a running
 * container that starts backing off crashes; a restart (count went up, or back
 * to running) wakes up. Otherwise it holds exactly what was observed.
 * Returns null when there is nothing to show.
 */
export function followCrashLoop(
  state: LiveCrashLoop,
  obs: Observation,
  t: number,
  out: CrashLoopFrame,
): CrashLoopFrame | null {
  if (state.held === undefined) {
    state.held = obs.phase;
    state.restarts = obs.restarts;
  } else if (obs.phase !== state.held || obs.restarts !== state.restarts) {
    const restarted = obs.restarts > state.restarts;
    if (obs.phase === 'backoff' && (state.held === 'running' || restarted)) state.transition = 'crashing';
    else if (obs.phase === 'running' && (state.held === 'backoff' || restarted)) state.transition = 'restarting';
    else state.transition = null;
    state.since = t;
    state.held = obs.phase;
    state.restarts = obs.restarts;
  }

  out.restarts = state.restarts;
  if (state.transition) {
    const duration = TRANSITION_S[state.transition];
    const elapsed = t - state.since;
    if (elapsed < duration) {
      out.phase = state.transition;
      out.progress = elapsed / duration;
      out.remaining = duration - elapsed;
      return out;
    }
    state.transition = null;
  }
  if (state.held === 'backoff') {
    // The real remaining delay is not in the data: show an honest, indeterminate wait.
    out.phase = 'backoff';
    out.progress = ((t - state.since) % SWEEP_S) / SWEEP_S;
    out.remaining = null;
    return out;
  }
  return null;
}
