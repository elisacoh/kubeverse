import { create } from 'zustand';
import { useAppStore } from '../state/useAppStore';
import { buildAction, createSession, currentObjective, isLessonComplete, step } from './engine';
import { canStart, findLesson } from './curriculum';
import { fastForward } from './fastForward';
import type { BuildActionKind, HighlightTarget, LearnerAction, Lesson, LessonSession } from './types';

export type LearningCard =
  | { kind: 'intro' }
  /** Revealed by completing an objective. */
  | { kind: 'discovery'; objectiveId: string; conceptId: string }
  /** Correction after a plausible mistake. */
  | { kind: 'feedback'; message: string }
  /** Opened explicitly by the learner. */
  | { kind: 'concept'; conceptId: string }
  | { kind: 'complete' };

const STORAGE_KEY = 'kubeverse.completedLessons';

const loadCompleted = (): string[] => {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

const saveCompleted = (ids: readonly string[]) => {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Storage unavailable (private mode, tests): progress simply is not remembered.
  }
};

const STEPS_KEY = 'kubeverse.learnSteps.v1';

interface SavedSteps {
  checkpoints: Record<string, LessonSession>;
  everDone: string[];
  furthest: LessonSession | null;
}

const loadSteps = (lessonId: string): SavedSteps | undefined => {
  try {
    const all = JSON.parse(globalThis.localStorage?.getItem(STEPS_KEY) ?? '{}') as Record<string, SavedSteps>;
    return all[lessonId];
  } catch {
    return undefined;
  }
};

const saveSteps = (lessonId: string, steps: SavedSteps) => {
  try {
    const all = JSON.parse(globalThis.localStorage?.getItem(STEPS_KEY) ?? '{}') as Record<string, SavedSteps>;
    globalThis.localStorage?.setItem(STEPS_KEY, JSON.stringify({ ...all, [lessonId]: steps }));
  } catch {
    // Storage unavailable or full: steps stay unlocked for this visit only.
  }
};

/**
 * What the learner can navigate to when the lesson opens: what was saved, and
 * for a lesson already completed, every step (rebuilt by playing it if needed).
 */
const restoreSteps = (lesson: Lesson, completedLessons: readonly string[]): SavedSteps => {
  const saved = loadSteps(lesson.id) ?? { checkpoints: {}, everDone: [], furthest: null };
  if (!completedLessons.includes(lesson.id)) return saved;
  const missing = lesson.objectives.some((o) => !saved.checkpoints[o.id]);
  const rebuilt = missing ? fastForward(lesson) : null;
  return {
    checkpoints: { ...rebuilt?.checkpoints, ...saved.checkpoints },
    everDone: lesson.objectives.map((o) => o.id),
    furthest: saved.furthest ?? rebuilt?.last ?? null,
  };
};

/** Remembers the session at the moment an objective becomes the one to do. */
const withCurrent = (lesson: Lesson, session: LessonSession, checkpoints: Readonly<Record<string, LessonSession>>) => {
  const current = currentObjective(lesson, session.progress);
  return current && !checkpoints[current.id] ? { ...checkpoints, [current.id]: session } : checkpoints;
};

interface LearningState {
  lesson: Lesson | null;
  session: LessonSession | null;
  /** Number of hints revealed, per objective id. */
  hintLevel: Readonly<Record<string, number>>;
  /** Cards to show; the first is visible. Several only when one action completes the lesson. */
  cards: readonly LearningCard[];
  completedLessons: readonly string[];
  /** The session when each objective became the one to do, so the learner can go back to it. */
  checkpoints: Readonly<Record<string, LessonSession>>;
  /** Objectives validated at least once in this run: they stay unlocked after going back. */
  everDone: readonly string[];
  /** The latest session that holds every validated objective, to return to after going back. */
  furthest: LessonSession | null;

  startLesson: (lessonId: string) => void;
  resetLesson: () => void;
  /** Shows the lesson where the objective is the one to do, world included; later progress is kept. */
  goToObjective: (objectiveId: string) => void;
  /** A world-building intent from the scene (initialize, add a Node). Ignored unless the lesson offers it. */
  perform: (kind: BuildActionKind) => void;
  dispatch: (action: LearnerAction) => void;
  requestHint: () => void;
  openConcept: (conceptId: string) => void;
  dismissCard: () => void;
}

export const useLearningStore = create<LearningState>()((set, get) => ({
  lesson: null,
  session: null,
  hintLevel: {},
  cards: [],
  completedLessons: loadCompleted(),
  checkpoints: {},
  everDone: [],
  furthest: null,

  startLesson: (lessonId) => {
    const lesson = findLesson(lessonId);
    if (!lesson || !canStart(lessonId, get().completedLessons)) return;
    useAppStore.getState().applyScenario(lesson.initialScenario);
    const session = createSession(lesson);
    const steps = restoreSteps(lesson, get().completedLessons);
    set({
      lesson,
      session,
      hintLevel: {},
      cards: [{ kind: 'intro' }],
      checkpoints: withCurrent(lesson, session, steps.checkpoints),
      everDone: steps.everDone,
      furthest: steps.furthest ?? session,
    });
  },

  resetLesson: () => {
    const { lesson } = get();
    if (!lesson) return;
    useAppStore.getState().applyScenario(lesson.initialScenario);
    get().dispatch({ type: 'LESSON_RESET' });
    set({ hintLevel: {}, cards: [{ kind: 'intro' }] });
  },

  goToObjective: (objectiveId) => {
    const { lesson, checkpoints, everDone, furthest } = get();
    if (!lesson) return;
    const frontier = furthest ? currentObjective(lesson, furthest.progress) : undefined;
    const target = frontier?.id === objectiveId ? furthest : everDone.includes(objectiveId) ? checkpoints[objectiveId] : undefined;
    if (!target) return;
    set({ session: target, hintLevel: {}, cards: [] });
    const app = useAppStore.getState();
    const { view } = app;
    const gone =
      (view.kind === 'node' && !app.cluster.nodes.some((n) => n.metadata.name === view.nodeName)) ||
      (view.kind === 'pod' && !app.cluster.pods.some((p) => p.metadata.uid === view.podUid));
    if (gone) app.applyScenario({ view: { kind: 'cluster' }, selection: null });
  },

  perform: (kind) => {
    const { lesson, session } = get();
    if (!lesson || !session) return;
    const action = buildAction(lesson, session, kind);
    if (action) get().dispatch(action);
  },

  dispatch: (action) => {
    const { lesson, session, completedLessons } = get();
    if (!lesson || !session) return;
    const result = step(lesson, session, action);

    if (result.session !== session) {
      const everDone = [...new Set([...get().everDone, ...result.session.progress.completed])];
      const atFrontier = everDone.every((id) => result.session.progress.completed.includes(id));
      set({ everDone, ...(atFrontier ? { furthest: result.session } : {}) });
    }

    if (result.completed.length > 0) {
      const cards: LearningCard[] = result.completed.map((o) => ({
        kind: 'discovery',
        objectiveId: o.id,
        conceptId: o.discovers,
      }));
      const finished = isLessonComplete(lesson, result.session.progress);
      if (finished) cards.push({ kind: 'complete' });
      const completed =
        finished && !completedLessons.includes(lesson.id) ? [...completedLessons, lesson.id] : completedLessons;
      if (completed !== completedLessons) saveCompleted(completed);
      const checkpoints = { ...get().checkpoints };
      for (const o of result.completed) checkpoints[o.id] ??= session;
      set({ session: result.session, cards, completedLessons: completed, checkpoints: withCurrent(lesson, result.session, checkpoints) });
      return;
    }

    if (result.feedback) {
      set({ session: result.session, cards: [{ kind: 'feedback', message: result.feedback }] });
      return;
    }
    if (result.session !== session) set({ session: result.session });
  },

  requestHint: () => {
    const { lesson, session, hintLevel } = get();
    if (!lesson || !session) return;
    const objective = currentObjective(lesson, session.progress);
    if (!objective) return;
    const level = hintLevel[objective.id] ?? 0;
    if (level < objective.hints.length) set({ hintLevel: { ...hintLevel, [objective.id]: level + 1 } });
  },

  openConcept: (conceptId) => {
    const { cards } = get();
    const rest = cards[0]?.kind === 'complete' ? cards : cards.slice(1);
    set({ cards: [{ kind: 'concept', conceptId }, ...rest] });
  },

  dismissCard: () => set((s) => ({ cards: s.cards.slice(1) })),
}));

let saveTimer: ReturnType<typeof setTimeout> | null = null;
useLearningStore.subscribe((s, p) => {
  if (!s.lesson || (s.checkpoints === p.checkpoints && s.everDone === p.everDone && s.furthest === p.furthest)) return;
  if (saveTimer) clearTimeout(saveTimer);
  const { lesson, checkpoints, everDone, furthest } = s;
  saveTimer = setTimeout(() => saveSteps(lesson.id, { checkpoints, everDone: [...everDone], furthest }), 500);
});

/** Scene emphasis: only for the current objective, and only after the learner asked for a hint. */
export const selectActiveHighlight = (s: Pick<LearningState, 'lesson' | 'session' | 'hintLevel'>): HighlightTarget | null => {
  if (!s.lesson || !s.session) return null;
  const objective = currentObjective(s.lesson, s.session.progress);
  if (!objective?.highlight) return null;
  return (s.hintLevel[objective.id] ?? 0) > 0 ? objective.highlight : null;
};
