import { useState } from 'react';
import { BookOpen, Check, ChevronDown, ChevronUp, Circle, Lightbulb, ListTree, Lock, Play, RotateCcw } from 'lucide-react';
import { buildActionLabel, canPerform, currentObjective, objectiveCounter } from '../../learning/engine';
import { findConcept } from '../../learning/concepts';
import { useLearningStore } from '../../learning/useLearningStore';
import type { Lesson, LessonSession } from '../../learning/types';
import { LessonMenu } from './LessonMenu';

export function ObjectivePanel({ lesson, session }: { lesson: Lesson; session: LessonSession }) {
  const { progress } = session;
  const perform = useLearningStore((s) => s.perform);
  const hintLevel = useLearningStore((s) => s.hintLevel);
  const requestHint = useLearningStore((s) => s.requestHint);
  const openConcept = useLearningStore((s) => s.openConcept);
  const resetLesson = useLearningStore((s) => s.resetLesson);
  const goToObjective = useLearningStore((s) => s.goToObjective);
  const everDone = useLearningStore((s) => s.everDone);
  const furthest = useLearningStore((s) => s.furthest);
  const [collapsed, setCollapsed] = useState(false);
  const [showList, setShowList] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  const objective = currentObjective(lesson, progress);
  const frontier = furthest ? currentObjective(lesson, furthest.progress) : undefined;
  const done = everDone.length;
  const total = lesson.objectives.length;
  const level = objective ? (hintLevel[objective.id] ?? 0) : 0;
  const counter = objective ? objectiveCounter(progress, objective) : undefined;
  const actions = (objective?.actions ?? []).filter((k) => canPerform(lesson, session, k));

  return (
    <section
      aria-label="Lesson objectives"
      className="pointer-events-auto glass flex max-h-[calc(100vh-15rem)] w-[min(320px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl"
    >
      <header className="flex items-center gap-1.5 px-3 pb-2 pt-2.5">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            className="section-title !mb-0.5 flex max-w-full items-center gap-1 hover:text-lavender"
            onClick={() => setShowMenu((v) => !v)}
            aria-expanded={showMenu}
            title="All lessons"
          >
            <ListTree className="size-3 shrink-0" />
            <span className="truncate">
              Lesson {lesson.number} · {lesson.title}
            </span>
          </button>
          <div className="flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-teal transition-[width] duration-500" style={{ width: `${(done / total) * 100}%` }} />
            </div>
            <span className="font-mono text-[10.5px] text-lavender/75">
              {done}/{total}
            </span>
          </div>
        </div>
        <button type="button" className="hud-btn !p-1.5" onClick={resetLesson} title="Replay the lesson from the start">
          <RotateCcw className="size-3.5" />
        </button>
        <button
          type="button"
          className="hud-btn !p-1.5"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand objectives' : 'Collapse objectives'}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
        </button>
      </header>

      {showMenu && <LessonMenu onClose={() => setShowMenu(false)} />}

      {!collapsed && (
        <div className="scrollbar-thin overflow-y-auto px-3 pb-3">
          {objective ? (
            <div className="rounded-xl border border-teal/25 bg-teal/[0.06] p-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-display text-[14px] font-semibold text-white">{objective.title}</h3>
                {counter && (
                  <span className="shrink-0 font-mono text-[10.5px] text-teal">
                    {counter.done}/{counter.total}
                  </span>
                )}
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-lavender/85">{objective.instruction}</p>

              {actions.map((k) => (
                <button key={k} type="button" className="primary-btn mt-2 w-full justify-center" onClick={() => perform(k)}>
                  <Play className="size-3.5" />
                  {buildActionLabel(session, k)}
                </button>
              ))}

              {level > 0 && (
                <ul className="mt-2 space-y-1">
                  {objective.hints.slice(0, level).map((h) => (
                    <li key={h} className="flex gap-1.5 text-[11.5px] leading-snug text-gold/90">
                      <Lightbulb className="mt-0.5 size-3 shrink-0" />
                      {h}
                    </li>
                  ))}
                </ul>
              )}

              {level < objective.hints.length && (
                <button
                  type="button"
                  className="hud-btn mt-1.5 !px-2 !py-1 !text-[11.5px]"
                  onClick={requestHint}
                  title={level === 0 ? 'Show a hint and highlight where to look' : 'Show another hint'}
                >
                  <Lightbulb className="size-3.5" />
                  {level === 0 ? 'Hint' : 'Another hint'}
                </button>
              )}
            </div>
          ) : (
            <p className="rounded-xl border border-teal/25 bg-teal/[0.06] p-2.5 text-[12px] text-lavender/85">
              Lesson complete. Everything you built stays here — keep exploring it, or replay the lesson.
            </p>
          )}

          <button
            type="button"
            className="mt-2 flex w-full items-center justify-between text-[10.5px] uppercase tracking-[0.14em] text-lavender/65 hover:text-lavender"
            onClick={() => setShowList((v) => !v)}
            aria-expanded={showList}
          >
            All objectives
            {showList ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          </button>
          {showList && (
            <ol className="mt-1.5 space-y-0.5">
              {lesson.objectives.map((o) => {
                const validated = everDone.includes(o.id);
                const unlocked = validated || o.id === frontier?.id;
                const here = o.id === objective?.id;
                const concept = findConcept(o.discovers);
                const icon = validated ? (
                  <Check className="size-3.5 shrink-0 text-ok" />
                ) : unlocked ? (
                  <Circle className="size-3 shrink-0 text-teal" />
                ) : (
                  <Lock className="size-3 shrink-0 text-lavender/40" />
                );
                return (
                  <li key={o.id} className="flex items-center gap-0.5">
                    {unlocked && !here ? (
                      <button
                        type="button"
                        onClick={() => goToObjective(o.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left text-[11.5px] text-white/85 hover:bg-white/[0.06]"
                        title="Go to this step"
                      >
                        {icon}
                        <span className="truncate">{o.title}</span>
                      </button>
                    ) : (
                      <div
                        aria-current={here ? 'step' : undefined}
                        className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-[11.5px] ${
                          here ? 'bg-cyan/10 text-cyan' : 'text-lavender/40'
                        }`}
                      >
                        {icon}
                        <span className="truncate">{o.title}</span>
                      </div>
                    )}
                    {validated && concept && (
                      <button type="button" onClick={() => openConcept(concept.id)} className="hud-btn !p-1" title={`Review: ${concept.title}`}>
                        <BookOpen className="size-3" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
