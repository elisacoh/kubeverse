import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, History, Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import { timelineEvents, type TimelineEvent } from '../../learning/creationFlow';
import { useLearningStore } from '../../learning/useLearningStore';
import type { LessonSession } from '../../learning/types';
import { useAppStore } from '../../state/useAppStore';
import { useFlowStore } from '../../state/useFlowStore';

const HOP_MS = 1100;
const PAUSE_MS = 700;

/** Lesson 3's event timeline: each event replays its messages in the world and focuses the actor. */
export function CreationTimeline({ session }: { session: LessonSession }) {
  const cluster = useAppStore((s) => s.cluster);
  const events = useMemo(() => timelineEvents(session.world, cluster), [session.world, cluster]);
  if (events.length === 0) return null;
  // A new request is a new timeline.
  return <Timeline key={`${session.world.request?.name}:${events[0]?.id}`} events={events} />;
}

function Timeline({ events }: { events: TimelineEvent[] }) {
  const dispatch = useLearningStore((s) => s.dispatch);
  const play = useFlowStore((s) => s.play);
  const [current, setCurrent] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const focus = (e: TimelineEvent) => {
    const app = useAppStore.getState();
    const f = e.focus;
    if (f.kind === 'component') {
      const comp = app.cluster.controlPlane.find((c) => c.type === f.component);
      if (comp) app.selectComponent(comp.uid);
    } else if (f.kind === 'agent') app.selectAgent(f.node, f.agent);
    else if (f.kind === 'pod') app.selectPod(f.podId);
    else app.focusNode(f.node);
  };

  const show = (index: number, explored: boolean) => {
    const e = events[index];
    if (!e) return;
    setCurrent(index);
    play(e.hops);
    if (explored) {
      focus(e);
      dispatch({ type: 'EVENT_TIMELINE_EXPLORED', eventId: e.id });
    }
  };

  // Autoplay walks the events at the pace of their animations; it never counts as exploring.
  useEffect(() => {
    if (!playing || current === null) return;
    const e = events[current];
    const next = current + 1;
    const t = setTimeout(
      () => {
        if (next >= events.length) setPlaying(false);
        else show(next, false);
      },
      (e?.hops.length ?? 1) * HOP_MS + PAUSE_MS,
    );
    return () => clearTimeout(t);
  }, [playing, current, events]);

  const replay = () => {
    setPlaying(true);
    show(0, false);
  };
  const togglePlay = () => {
    if (playing) setPlaying(false);
    else if (current === null || current >= events.length - 1) replay();
    else {
      setPlaying(true);
      show(current + 1, false);
    }
  };
  const stepBy = (d: number) => {
    setPlaying(false);
    const base = current ?? (d > 0 ? -1 : events.length);
    show(Math.min(events.length - 1, Math.max(0, base + d)), true);
  };

  const shown = current !== null ? events[current] : undefined;

  return (
    <section
      aria-label="Pod creation timeline"
      className="pointer-events-auto glass kv-card-in flex max-h-[min(420px,calc(100vh-22rem))] w-[min(340px,calc(100vw-1.5rem))] flex-col rounded-2xl p-3"
    >
      <header className="flex items-center gap-1.5">
        <History className="size-4 text-gold" />
        <span className="flex-1 text-[12.5px] font-semibold text-white">What happened</span>
        <button type="button" className="hud-btn !p-1.5" onClick={() => stepBy(-1)} title="Previous event">
          <SkipBack className="size-3.5" />
        </button>
        <button type="button" className="hud-btn !p-1.5" onClick={togglePlay} title={playing ? 'Pause' : 'Play the events'}>
          {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </button>
        <button type="button" className="hud-btn !p-1.5" onClick={() => stepBy(1)} title="Next event">
          <SkipForward className="size-3.5" />
        </button>
        <button type="button" className="hud-btn !p-1.5" onClick={replay} title="Replay from the start">
          <RotateCcw className="size-3.5" />
        </button>
        <button
          type="button"
          className="hud-btn !p-1.5"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand' : 'Collapse'}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
      </header>

      {!collapsed && (
        <>
          <ol className="scrollbar-thin mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto">
            {events.map((e, i) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => {
                    setPlaying(false);
                    show(i, true);
                  }}
                  className={`flex w-full items-baseline gap-2 rounded-md px-1.5 py-1 text-left text-[11.5px] transition ${
                    i === current ? 'bg-white/[0.09] text-white' : 'text-white/80 hover:bg-white/[0.05]'
                  }`}
                >
                  <span className={`w-4 shrink-0 font-mono text-[10px] ${e.id === 'rejected' ? 'text-[#ff9b9b]' : 'text-gold/80'}`}>
                    {i + 1}
                  </span>
                  <span className="flex-1">{e.title}</span>
                  <span className="truncate text-[10px] text-lavender/50">{e.actor}</span>
                </button>
              </li>
            ))}
          </ol>
          <p className="mt-2 border-t border-white/[0.06] pt-2 text-[11.5px] leading-relaxed text-lavender/80">
            {shown
              ? shown.detail
              : 'Each component watches the API server and acts on its own — click an event to replay it in the world.'}
          </p>
        </>
      )}
    </section>
  );
}
