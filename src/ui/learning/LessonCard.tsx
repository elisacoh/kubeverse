import {
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { create } from 'zustand';
import { BookOpen, ChevronDown, ChevronUp, Compass, Info, RotateCcw, Sparkles, Trophy, Unlock, X } from 'lucide-react';
import { findConcept } from '../../learning/concepts';
import { CURRICULUM } from '../../learning/curriculum';
import { useLearningStore, type LearningCard } from '../../learning/useLearningStore';
import type { Lesson, LessonProgress } from '../../learning/types';

interface Props {
  card: LearningCard;
  lesson: Lesson;
  progress: LessonProgress;
}

/** A small, non-blocking card in a corner of the screen. The world stays interactive. */
export function LessonCard({ card, lesson, progress }: Props) {
  const dismissCard = useLearningStore((s) => s.dismissCard);
  const resetLesson = useLearningStore((s) => s.resetLesson);
  const openConcept = useLearningStore((s) => s.openConcept);
  const startLesson = useLearningStore((s) => s.startLesson);

  if (card.kind === 'intro') {
    return (
      <Shell
        icon={<Sparkles className="size-4" />}
        kicker={`Lesson ${lesson.number} · ${lesson.title}`}
        title={lesson.intro.title}
        onClose={dismissCard}
        attention
      >
        <p>{lesson.intro.text}</p>
        <Actions>
          <button type="button" className="primary-btn" onClick={dismissCard}>
            <Compass className="size-4" /> Let’s begin
          </button>
        </Actions>
      </Shell>
    );
  }

  if (card.kind === 'feedback') {
    return (
      <Shell icon={<Info className="size-4" />} kicker="Not quite" title="Look again" onClose={dismissCard} tone="warm">
        <p>{card.message}</p>
      </Shell>
    );
  }

  if (card.kind === 'complete') {
    const discovered = lesson.objectives
      .filter((o) => progress.completed.includes(o.id))
      .map((o) => findConcept(o.discovers))
      .filter((c) => c !== undefined);
    const next = CURRICULUM.find((e) => e.unlockedBy === lesson.id);
    return (
      <Shell icon={<Trophy className="size-4" />} kicker="Lesson complete" title={lesson.title} onClose={dismissCard}>
        <p>{lesson.summary} You discovered:</p>
        <div className="mt-2 flex flex-wrap gap-1">
          {discovered.map((c) => (
            <button key={c.id} type="button" className="chip hover:!border-teal/50 hover:!text-white" onClick={() => openConcept(c.id)}>
              {c.title}
            </button>
          ))}
        </div>
        {next && (
          <p className="mt-2.5 flex items-center gap-1.5 text-[11.5px] text-teal">
            <Unlock className="size-3.5" /> Lesson {next.number} unlocked: {next.title}
            {!next.lesson && <span className="text-lavender/55">(coming soon)</span>}
          </p>
        )}
        <Actions>
          <button type="button" className="hud-btn" onClick={resetLesson} title="Replay lesson">
            <RotateCcw className="size-3.5" /> Replay
          </button>
          <button type="button" className={next?.lesson ? 'hud-btn' : 'primary-btn'} onClick={dismissCard}>
            Keep exploring
          </button>
          {next?.lesson && (
            <button type="button" className="primary-btn" onClick={() => startLesson(next.id)}>
              Start Lesson {next.number}
            </button>
          )}
        </Actions>
      </Shell>
    );
  }

  const concept = findConcept(card.conceptId);
  if (!concept) return null;
  const objective = card.kind === 'discovery' ? lesson.objectives.find((o) => o.id === card.objectiveId) : undefined;

  return (
    <Shell
      key={`${card.kind}:${concept.id}`}
      icon={card.kind === 'concept' ? <BookOpen className="size-4" /> : <Sparkles className="size-4" />}
      kicker={objective ? `Done · ${objective.title}` : 'Concept'}
      title={concept.title}
      onClose={dismissCard}
    >
      <p>{concept.summary}</p>
      <Details lines={concept.details} defaultOpen={card.kind === 'concept'} />
      <Actions>
        <button type="button" className="primary-btn" onClick={dismissCard}>
          {card.kind === 'discovery' ? 'Continue' : 'Got it'}
        </button>
      </Actions>
    </Shell>
  );
}

function Details({ lines, defaultOpen }: { lines: readonly string[]; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  if (lines.length === 0) return null;
  return (
    <div className="mt-2">
      <button
        type="button"
        className="flex items-center gap-1 text-[11px] text-cyan/85 hover:text-cyan"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
        {open ? 'Less detail' : 'More detail'}
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1 border-l border-lavender/20 pl-2.5">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Shell({
  icon,
  kicker,
  title,
  onClose,
  tone = 'teal',
  attention = false,
  children,
}: {
  icon: ReactNode;
  kicker: string;
  title: string;
  onClose: () => void;
  tone?: 'teal' | 'warm';
  /** Pulse a ring around the card as it appears, so the eye finds it. */
  attention?: boolean;
  children: ReactNode;
}) {
  const accent = tone === 'warm' ? 'bg-warm/15 text-warm' : 'bg-teal/15 text-teal';
  const kickerColor = tone === 'warm' ? 'text-warm/85' : 'text-teal/85';
  const { offset, dragging, handle } = useCardDrag();
  return (
    <section
      role="dialog"
      aria-label={title}
      ref={handle.ref}
      style={{ translate: `${offset.x}px ${offset.y}px` }}
      className={`kv-card-in pointer-events-auto glass w-[min(420px,calc(100vw-1.5rem))] rounded-2xl p-4 text-[13.5px] leading-relaxed text-lavender/90 ${
        attention ? 'kv-attention' : ''
      } ${dragging ? 'select-none shadow-2xl' : ''}`}
    >
      <header
        className={`mb-2 flex touch-none items-start gap-2.5 ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        title="Drag to move · double-click to put it back"
        onPointerDown={handle.onPointerDown}
        onPointerMove={handle.onPointerMove}
        onPointerUp={handle.onPointerUp}
        onPointerCancel={handle.onPointerUp}
        onDoubleClick={handle.onDoubleClick}
      >
        <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ${accent}`}>{icon}</span>
        <div className="min-w-0 flex-1">
          <div className={`truncate text-[10.5px] font-semibold uppercase tracking-[0.14em] ${kickerColor}`}>{kicker}</div>
          <h2 className="font-display text-[18px] font-semibold leading-tight text-white">{title}</h2>
        </div>
        <button type="button" className="hud-btn !p-1" onClick={onClose} aria-label="Close">
          <X className="size-3.5" />
        </button>
      </header>
      {children}
    </section>
  );
}

/** Where the learner dragged the card, kept across cards so each new one appears in the same place. */
const useCardOffset = create<{ x: number; y: number; set: (x: number, y: number) => void }>((set) => ({
  x: 0,
  y: 0,
  set: (x, y) => set({ x, y }),
}));

const EDGE = 8;

function useCardDrag() {
  const x = useCardOffset((s) => s.x);
  const y = useCardOffset((s) => s.y);
  const setOffset = useCardOffset((s) => s.set);
  const ref = useRef<HTMLElement>(null);
  const start = useRef<{ px: number; py: number; ox: number; oy: number; rect: DOMRect } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button') || !ref.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { px: e.clientX, py: e.clientY, ox: x, oy: y, rect: ref.current.getBoundingClientRect() };
    setDragging(true);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const s = start.current;
    if (!s) return;
    const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
    const dx = clamp(e.clientX - s.px, EDGE - s.rect.left, window.innerWidth - EDGE - s.rect.right);
    const dy = clamp(e.clientY - s.py, EDGE - s.rect.top, window.innerHeight - EDGE - s.rect.bottom);
    setOffset(s.ox + dx, s.oy + dy);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    if (!start.current) return;
    start.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onDoubleClick = (e: ReactMouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    setOffset(0, 0);
  };

  return { offset: { x, y }, dragging, handle: { ref, onPointerDown, onPointerMove, onPointerUp, onDoubleClick } };
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="mt-3 flex items-center justify-end gap-1.5">{children}</div>;
}
