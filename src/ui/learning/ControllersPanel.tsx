import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Layers, Minus, Pause, Play, Plus, SkipForward } from 'lucide-react';
import { canPerform } from '../../learning/engine';
import { controllerRooms } from '../../learning/sandbox';
import { useControllerLoop } from '../../learning/controllerLoop';
import { useLearningStore } from '../../learning/useLearningStore';
import type { Lesson, LessonSession } from '../../learning/types';
import {
  MAX_REPLICAS,
  WEB_IMAGES,
  currentReplicaSet,
  deploymentCounts,
  isSettled,
  replicaSetCounts,
  rollingLimits,
  rolloutInProgress,
  type ControllerEvent,
  type ControllersState,
  type EventSource,
} from '../../simulation/controllers';
import { useAppStore } from '../../state/useAppStore';
import { revisionAccent } from '../../scene/accent';
import { conditionColor } from '../../scene/palette';

const SOURCE_LABEL: Record<EventSource, string> = {
  kubectl: 'kubectl',
  'deployment-controller': 'Deployment ctrl',
  'replicaset-controller': 'ReplicaSet ctrl',
  'default-scheduler': 'scheduler',
  kubelet: 'kubelet',
};

/**
 * Lesson 4's live view of desired versus actual state, the controls that
 * change the desired state, and the events the control loops produce.
 */
export function ControllersPanel({ lesson, session }: { lesson: Lesson; session: LessonSession }) {
  const s = session.world.controllers;
  const [collapsed, setCollapsed] = useState(false);
  if (!s?.deployment) return null;
  const dep = s.deployment;
  const counts = deploymentCounts(s)!;
  const current = currentReplicaSet(s);
  const rolling = rolloutInProgress(s);
  const settled = isSettled(s, controllerRooms(session.world));

  return (
    <section
      aria-label="Controllers"
      className="scrollbar-thin pointer-events-auto glass kv-card-in max-h-[460px] min-h-0 w-[min(360px,calc(100vw-1.5rem))] overflow-y-auto overscroll-contain rounded-2xl p-3"
    >
      <header className="flex items-center gap-2">
        <Layers className="size-4 text-teal" />
        <span className="text-[12.5px] font-semibold text-white">Deployment {dep.name}</span>
        {current && (
          <span className="chip !py-0 font-mono !text-[10px]" style={{ color: revisionAccent(current.revision) }}>
            rev {current.revision} · {dep.image.split(':')[1]}
          </span>
        )}
        <button
          type="button"
          className="hud-btn ml-auto !p-1.5"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand' : 'Collapse'}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
      </header>

      <div className="mt-2 grid grid-cols-4 gap-1.5">
        <Counter label="Desired" value={counts.desired} hint="spec.replicas" />
        <Counter label="Pods" value={counts.current} hint="objects that exist" alert={counts.current !== counts.desired} />
        <Counter label="Ready" value={counts.ready} hint="container running" alert={counts.ready < counts.desired} />
        <Counter label="Available" value={counts.available} hint="ready, serving" alert={counts.available < counts.desired} />
      </div>
      <Status s={s} settled={settled} />

      {!collapsed && (
        <>
          {(rolling || s.replicaSets.length > 1) && <Rollout s={s} />}
          <Controls lesson={lesson} session={session} s={s} />
          <LoopControls lesson={lesson} session={session} settled={settled} />
          <Events events={s.events} />
        </>
      )}
    </section>
  );
}

function Counter({ label, value, hint, alert }: { label: string; value: number; hint: string; alert?: boolean }) {
  return (
    <div className="rounded-lg bg-white/[0.04] px-1.5 py-1 text-center" title={hint}>
      <div className="font-mono text-[17px] font-semibold leading-tight" style={{ color: alert ? conditionColor.warning : 'white' }}>
        {value}
      </div>
      <div className="text-[9.5px] uppercase tracking-wider text-lavender/60">{label}</div>
    </div>
  );
}

function Status({ s, settled }: { s: ControllersState; settled: boolean }) {
  const c = deploymentCounts(s)!;
  let text: string;
  let color = 'rgb(179 164 255 / 0.75)';
  if (settled && c.unschedulable > 0) {
    text = `Settled, but ${c.unschedulable} Pod${c.unschedulable > 1 ? 's' : ''} cannot be scheduled: no Node has room. Desired is not guaranteed.`;
    color = conditionColor.warning;
  } else if (settled && c.available === c.desired && c.current === c.desired) {
    text = 'In sync: actual state matches the desired state. The loops keep watching.';
    color = conditionColor.ok;
  } else if (settled) {
    text = 'The loops are waiting for something to change.';
  } else {
    text = `Reconciling: desired ${c.desired}, ${c.current} Pod${c.current === 1 ? '' : 's'} exist${c.current === 1 ? 's' : ''}, ${c.available} available${c.terminating ? `, ${c.terminating} terminating` : ''}.`;
    color = 'rgb(255 211 138 / 0.9)';
  }
  return (
    <p className="mt-1.5 text-[11px] leading-relaxed" style={{ color }}>
      {text}
    </p>
  );
}

function Rollout({ s }: { s: ControllersState }) {
  const dep = s.deployment!;
  const { maxSurge, maxUnavailable } = rollingLimits(dep.replicas);
  const current = currentReplicaSet(s);
  return (
    <div className="mt-2 rounded-xl border border-white/[0.07] bg-white/[0.03] p-2">
      <div className="text-[10.5px] text-lavender/70">
        RollingUpdate · maxSurge 25% → <b className="text-white">{maxSurge}</b> · maxUnavailable 25% →{' '}
        <b className="text-white">{maxUnavailable}</b>
      </div>
      <div className="text-[10.5px] text-lavender/55">
        at most {dep.replicas + maxSurge} Pods, at least {dep.replicas - maxUnavailable} available
      </div>
      <ul className="mt-1.5 space-y-1">
        {s.replicaSets.map((rs) => {
          const c = replicaSetCounts(s, rs);
          const isCurrent = rs === current;
          return (
            <li key={rs.name} className="flex items-center gap-2 text-[11px]">
              <span className="size-2 rounded-full" style={{ background: revisionAccent(rs.revision) }} />
              <span className="w-[58px] shrink-0 text-lavender/70">{isCurrent ? 'updated' : 'old'} · r{rs.revision}</span>
              <span className="flex flex-1 gap-0.5">
                {Array.from({ length: Math.max(c.current, rs.replicas) }, (_, i) => (
                  <span
                    key={i}
                    className="h-2.5 flex-1 rounded-sm"
                    style={{
                      background: i < c.available ? revisionAccent(rs.revision) : 'transparent',
                      border: `1px solid ${revisionAccent(rs.revision)}`,
                      opacity: i < c.current ? 1 : 0.35,
                      maxWidth: 22,
                    }}
                  />
                ))}
              </span>
              <span className="shrink-0 font-mono text-[10.5px] text-white/80">
                {c.available}/{rs.replicas}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Controls({ lesson, session, s }: { lesson: Lesson; session: LessonSession; s: ControllersState }) {
  const dispatch = useLearningStore((st) => st.dispatch);
  const dep = s.deployment!;
  const [replicas, setReplicas] = useState(dep.replicas);
  useEffect(() => setReplicas(dep.replicas), [dep.replicas]);
  const canScale = canPerform(lesson, session, 'scale-deployment');
  const canUpdate = canPerform(lesson, session, 'update-pod-template');
  if (!canScale && !canUpdate) return null;

  return (
    <div className="mt-2 space-y-1.5">
      {canScale && (
        <div className="flex items-center gap-1.5">
          <span className="w-[54px] text-[11px] text-lavender/70">Replicas</span>
          <button type="button" className="hud-btn !p-1" onClick={() => setReplicas((r) => Math.max(1, r - 1))} aria-label="Fewer replicas">
            <Minus className="size-3" />
          </button>
          <span className="w-5 text-center font-mono text-[13px] text-white">{replicas}</span>
          <button
            type="button"
            className="hud-btn !p-1"
            onClick={() => setReplicas((r) => Math.min(MAX_REPLICAS, r + 1))}
            aria-label="More replicas"
          >
            <Plus className="size-3" />
          </button>
          <button
            type="button"
            className="primary-btn ml-auto whitespace-nowrap !px-2 !py-1 font-mono !text-[10.5px]"
            disabled={replicas === dep.replicas}
            onClick={() => dispatch({ type: 'DEPLOYMENT_SCALED', name: dep.name, replicas })}
          >
            $ kubectl scale --replicas={replicas}
          </button>
        </div>
      )}
      {canUpdate && (
        <div className="flex items-center gap-1.5">
          <span className="w-[54px] text-[11px] text-lavender/70">Image</span>
          {WEB_IMAGES.map((img) => (
            <button
              key={img}
              type="button"
              disabled={img === dep.image}
              onClick={() => dispatch({ type: 'POD_TEMPLATE_UPDATED', name: dep.name, image: img })}
              className={`rounded-md border px-1.5 py-0.5 font-mono text-[10.5px] transition ${
                img === dep.image
                  ? 'border-teal/60 bg-teal/[0.14] text-white'
                  : 'border-white/15 text-lavender/75 hover:border-teal/50 hover:text-white'
              }`}
              title={img === dep.image ? 'Current template' : `kubectl set image deployment/${dep.name} web=${img}`}
            >
              {img.split('/')[1]}
            </button>
          ))}
          <span className="ml-auto text-[10px] text-lavender/50">changes the template</span>
        </div>
      )}
    </div>
  );
}

function LoopControls({ lesson, session, settled }: { lesson: Lesson; session: LessonSession; settled: boolean }) {
  const paused = useControllerLoop((st) => st.paused);
  const setPaused = useControllerLoop((st) => st.setPaused);
  const perform = useLearningStore((st) => st.perform);
  const canStep = canPerform(lesson, session, 'run-controllers');
  return (
    <div className="mt-2 flex items-center gap-1.5 border-t border-white/[0.06] pt-2">
      <button
        type="button"
        className="hud-btn !px-2 !py-1 !text-[11px]"
        onClick={() => setPaused(!paused)}
        title={paused ? 'Let the control loops run' : 'Freeze the control loops to inspect this moment'}
      >
        {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
        {paused ? 'Resume' : 'Pause'}
      </button>
      <button
        type="button"
        className="hud-btn !px-2 !py-1 !text-[11px]"
        disabled={!paused || !canStep}
        onClick={() => perform('run-controllers')}
        title="Run one pass of every control loop"
      >
        <SkipForward className="size-3.5" /> Step
      </button>
      <span className="ml-auto text-[10.5px] text-lavender/55">
        {settled ? 'loops idle' : paused ? 'paused' : 'loops running'} · pass {session.world.controllers?.pass ?? 0}
      </span>
    </div>
  );
}

function Events({ events }: { events: readonly ControllerEvent[] }) {
  const list = useRef<HTMLOListElement>(null);
  const recent = events.slice(-40);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [events.length]);

  const focus = (e: ControllerEvent) => {
    const app = useAppStore.getState();
    if (e.object.kind === 'Pod') {
      const pod = app.cluster.pods.find((p) => p.metadata.name === e.object.name);
      if (pod) app.selectPod(pod.metadata.uid);
      else if (e.node) app.focusNode(e.node);
    } else {
      const w = app.cluster.workloads.find((x) => x.metadata.name === e.object.name && x.kind === e.object.kind);
      if (w) app.selectWorkload(w.metadata.uid);
    }
  };

  return (
    <ol ref={list} className="scrollbar-thin mt-2 max-h-[170px] space-y-0.5 overflow-y-auto overscroll-contain" aria-label="Controller events">
      {recent.map((e) => (
        <li key={e.id}>
          <button
            type="button"
            onClick={() => focus(e)}
            className="flex w-full items-baseline gap-1.5 rounded-md px-1.5 py-0.5 text-left text-[10.5px] text-white/80 transition hover:bg-white/[0.06]"
          >
            <span className="w-6 shrink-0 font-mono text-[9.5px] text-lavender/45">{e.source === 'kubectl' ? 'you' : `#${e.pass}`}</span>
            <span className={`w-[86px] shrink-0 ${e.warning ? 'text-warn' : 'text-gold/80'}`}>{SOURCE_LABEL[e.source]}</span>
            <span className="flex-1 leading-snug">
              <b className={e.warning ? 'font-medium text-warn' : 'font-medium text-white/90'}>{e.reason}</b> {e.message}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
