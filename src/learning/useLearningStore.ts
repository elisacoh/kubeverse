import { create } from 'zustand';
import { useAppStore } from '../state/useAppStore';
import { buildAction, createSession, currentObjective, isLessonComplete, step } from './engine';
import { canStart, findLesson } from './curriculum';
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

interface LearningState {
  lesson: Lesson | null;
  session: LessonSession | null;
  /** Number of hints revealed, per objective id. */
  hintLevel: Readonly<Record<string, number>>;
  /** Cards to show; the first is visible. Several only when one action completes the lesson. */
  cards: readonly LearningCard[];
  completedLessons: readonly string[];

  startLesson: (lessonId: string) => void;
  resetLesson: () => void;
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

  startLesson: (lessonId) => {
    const lesson = findLesson(lessonId);
    if (!lesson || !canStart(lessonId, get().completedLessons)) return;
    useAppStore.getState().applyScenario(lesson.initialScenario);
    set({ lesson, session: createSession(lesson), hintLevel: {}, cards: [{ kind: 'intro' }] });
  },

  resetLesson: () => {
    const { lesson } = get();
    if (!lesson) return;
    useAppStore.getState().applyScenario(lesson.initialScenario);
    get().dispatch({ type: 'LESSON_RESET' });
    set({ hintLevel: {}, cards: [{ kind: 'intro' }] });
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
      set({ session: result.session, cards, completedLessons: completed });
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

/** Scene emphasis: only for the current objective, and only after the learner asked for a hint. */
export const selectActiveHighlight = (s: Pick<LearningState, 'lesson' | 'session' | 'hintLevel'>): HighlightTarget | null => {
  if (!s.lesson || !s.session) return null;
  const objective = currentObjective(s.lesson, s.session.progress);
  if (!objective?.highlight) return null;
  return (s.hintLevel[objective.id] ?? 0) > 0 ? objective.highlight : null;
};
