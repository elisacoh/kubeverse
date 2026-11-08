/**
 * Lesson progress, tracked separately from the cluster: completing a lesson
 * does not depend on what is still running, and resetting the cluster keeps
 * progress.
 */
import type { Exercise, ExerciseMode, Lesson, LessonId, Step } from './types';

export interface LessonProgress {
  stepIndex: number;
  done: string[];
  modes: Record<string, ExerciseMode>;
  /** Current guided step per write step. */
  guided: Record<string, number>;
  /** Hints revealed (0–3) per write step. */
  hints: Record<string, number>;
  solutionViewed: string[];
  /** Chosen option per quiz step. */
  quiz: Record<string, number>;
  completedAt?: number;
}

export type ProgressMap = Partial<Record<LessonId, LessonProgress>>;

export const emptyProgress = (): LessonProgress => ({ stepIndex: 0, done: [], modes: {}, guided: {}, hints: {}, solutionViewed: [], quiz: {} });

export type LessonStatus = 'new' | 'in-progress' | 'completed';

export const lessonStatus = (p: LessonProgress | undefined): LessonStatus => (!p ? 'new' : p.completedAt ? 'completed' : p.done.length || p.stepIndex ? 'in-progress' : 'new');

/** How much help the learner used: shown with the completion. */
export const assistance = (p: LessonProgress | undefined): 'none' | 'hints' | 'solution' =>
  !p ? 'none' : p.solutionViewed.length ? 'solution' : Object.values(p.hints).some((n) => n > 0) ? 'hints' : 'none';

export const defaultMode = (ex: Exercise): ExerciseMode => (ex.modes ? 'guided' : 'scratch');

export const modeOf = (p: LessonProgress | undefined, step: Step): ExerciseMode =>
  step.kind === 'write' ? (p?.modes[step.id] ?? defaultMode(step.exercise)) : 'scratch';

export const starterFor = (ex: Exercise, mode: ExerciseMode): string => {
  if (!ex.modes) return ex.starter ?? '';
  if (mode === 'guided') return ex.modes.guidedStarter ?? `# ${ex.file}: follow the guided steps on the left.\n`;
  if (mode === 'complete') return ex.modes.complete;
  return ex.modes.scratch || `# ${ex.file}: write the whole manifest yourself.\n`;
};

export const draftKey = (lesson: LessonId, stepId: string, mode: ExerciseMode) => `${lesson}/${stepId}/${mode}`;

/** Progress after marking a step done; completes the lesson when every step is. */
export const markDone = (lesson: Lesson, p: LessonProgress, stepId: string, now: number): LessonProgress => {
  if (p.done.includes(stepId)) return p;
  const done = [...p.done, stepId];
  const complete = lesson.steps.every((s) => done.includes(s.id));
  return { ...p, done, ...(complete && !p.completedAt ? { completedAt: now } : {}) };
};

/** The first step not done yet (the lesson's frontier), or the last step. */
export const frontier = (lesson: Lesson, p: LessonProgress) => {
  const i = lesson.steps.findIndex((s) => !p.done.includes(s.id));
  return i === -1 ? lesson.steps.length - 1 : i;
};
