import { describe, expect, it } from 'vitest';
import {
  DEMO_LOOP,
  KUBELET_BACKOFF,
  TRANSITION_S,
  backoffDelay,
  createFrame,
  createLiveCrashLoop,
  followCrashLoop,
  observeCrashLoop,
  simulateCrashLoop,
  type Observation,
} from './crashLoop';
import { demoCluster } from './demoCluster';
import type { Pod } from './types';

const { runS, crashS, restartS, initialS } = DEMO_LOOP;

describe('back-off delays', () => {
  it('double from the initial delay up to the cap, like the kubelet', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((n) => backoffDelay(n, KUBELET_BACKOFF.initialS, KUBELET_BACKOFF.maxS))).toEqual([
      10, 20, 40, 80, 160, 300, 300,
    ]);
  });
});

describe('simulated CrashLoopBackOff', () => {
  const at = (t: number) => ({ ...simulateCrashLoop(t, 7, DEMO_LOOP, createFrame()) });

  it('opens in back-off, then restarts, runs, crashes and backs off again', () => {
    expect(at(0)).toMatchObject({ phase: 'backoff', restarts: 7, progress: 0 });
    expect(at(initialS + 0.1)).toMatchObject({ phase: 'restarting', restarts: 8 });
    expect(at(initialS + restartS + 0.1)).toMatchObject({ phase: 'running', restarts: 8 });
    expect(at(initialS + restartS + runS + 0.1)).toMatchObject({ phase: 'crashing', restarts: 8 });
    expect(at(initialS + restartS + runS + crashS + 0.1)).toMatchObject({ phase: 'backoff', restarts: 8 });
  });

  it('waits longer after each crash, up to the cap', () => {
    const delays: number[] = [];
    let t = 0;
    for (let i = 0; i < 7; i++) {
      const f = at(t);
      expect(f.phase).toBe('backoff');
      delays.push(Math.round(f.remaining! * 10) / 10);
      t += f.remaining! + restartS + runS + crashS + 1e-6;
    }
    expect(delays).toEqual([1.5, 3, 6, 12, 12, 12, 12]);
  });

  it('is a pure function of time: deterministic, and fine after a long time offscreen', () => {
    expect(at(1234.5)).toEqual(at(1234.5));
    const f = at(100_000);
    expect(f.progress).toBeGreaterThanOrEqual(0);
    expect(f.progress).toBeLessThanOrEqual(1);
    expect(f.restarts).toBeGreaterThan(7);
  });
});

describe('live CrashLoopBackOff', () => {
  const follow = (steps: [Observation, number][]) => {
    const state = createLiveCrashLoop();
    return steps.map(([obs, t]) => {
      const f = followCrashLoop(state, obs, t, createFrame());
      return f ? { ...f } : null;
    });
  };
  const running = (restarts: number): Observation => ({ phase: 'running', restarts });
  const backoff = (restarts: number): Observation => ({ phase: 'backoff', restarts });

  it('never invents a crash: steady data stays steady', () => {
    const frames = follow([
      [running(3), 0],
      [running(3), 10],
      [running(3), 100],
    ]);
    expect(frames).toEqual([null, null, null]);
    const waiting = follow([
      [backoff(3), 0],
      [backoff(3), 50],
    ]);
    expect(waiting.map((f) => f?.phase)).toEqual(['backoff', 'backoff']);
    // The real remaining delay is unknown: no made-up countdown.
    expect(waiting[1]?.remaining).toBeNull();
  });

  it('plays a crash when a running container starts backing off, then holds the back-off', () => {
    const frames = follow([
      [running(3), 0],
      [backoff(4), 5],
      [backoff(4), 5 + TRANSITION_S.crashing / 2],
      [backoff(4), 5 + TRANSITION_S.crashing + 0.1],
    ]);
    expect(frames.map((f) => f?.phase ?? null)).toEqual([null, 'crashing', 'crashing', 'backoff']);
  });

  it('wakes up when the container is restarted, then shows nothing special', () => {
    const frames = follow([
      [backoff(4), 0],
      [running(5), 20],
      [running(5), 20 + TRANSITION_S.restarting + 0.1],
    ]);
    expect(frames.map((f) => f?.phase ?? null)).toEqual(['backoff', 'restarting', null]);
    expect(frames[1]?.restarts).toBe(5);
  });
});

describe('observing Pods', () => {
  const pod = (name: string) => demoCluster.pods.find((p) => p.metadata.name.startsWith(name))!;

  it('reads CrashLoopBackOff and running containers from the data', () => {
    expect(observeCrashLoop(pod('recommender'))).toEqual({ phase: 'backoff', restarts: 7 });
    expect(observeCrashLoop(pod('storefront')).phase).toBe('running');
  });

  it('does not treat a finished Job as crash-looping', () => {
    const done: Pod = {
      ...pod('nightly-report'),
      phase: 'Succeeded',
      containers: pod('nightly-report').containers.map((c) => ({
        ...c,
        status: { state: 'terminated', reason: 'Completed', exitCode: 0 },
      })),
    };
    expect(observeCrashLoop(done).phase).toBeNull();
  });
});
