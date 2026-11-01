/**
 * The lesson state machine. `step` is a pure reducer: the same lesson and the
 * same sequence of actions always produce the same session.
 */
import { WORLD_ACTIONS, buildKindOf, reduceWorld, type SandboxWorld } from './sandbox';
import type {
  ActionMatcher,
  BuildActionKind,
  LearnerAction,
  Lesson,
  LessonProgress,
  LessonSession,
  Objective,
  StepResult,
} from './types';

export const createSession = (lesson: Lesson): LessonSession => ({
  lessonId: lesson.id,
  world: lesson.initialWorld,
  progress: { completed: [], seen: {} },
});

export const isCompleted = (progress: LessonProgress, objectiveId: string) => progress.completed.includes(objectiveId);

const allDone = (progress: LessonProgress, ids: readonly string[] | undefined) =>
  (ids ?? []).every((id) => isCompleted(progress, id));

/** Objectives not yet done whose prerequisites are complete. */
export const availableObjectives = (lesson: Lesson, progress: LessonProgress): Objective[] =>
  lesson.objectives.filter((o) => !isCompleted(progress, o.id) && allDone(progress, o.requires));

/** The objective shown to the learner: the first available one in lesson order. */
export const currentObjective = (lesson: Lesson, progress: LessonProgress): Objective | undefined =>
  availableObjectives(lesson, progress)[0];

export const isLessonComplete = (lesson: Lesson, progress: LessonProgress) =>
  lesson.objectives.every((o) => isCompleted(progress, o.id));

export const objectiveStatus = (progress: LessonProgress, objective: Objective): 'done' | 'available' | 'locked' =>
  isCompleted(progress, objective.id) ? 'done' : allDone(progress, objective.requires) ? 'available' : 'locked';

/** Progress toward a 'distinct' objective, e.g. 1 of 2. */
export const objectiveCounter = (progress: LessonProgress, objective: Objective) =>
  objective.condition.type === 'distinct'
    ? {
        done: Math.min((progress.seen[objective.id] ?? []).length, objective.condition.count),
        total: objective.condition.count,
      }
    : undefined;

const field = (action: LearnerAction, key: string): unknown => (action as unknown as Record<string, unknown>)[key];

export const matches = (action: LearnerAction, matcher: ActionMatcher): boolean =>
  action.type === matcher.action &&
  Object.entries(matcher.where ?? {}).every(([key, expected]) => {
    const actual = field(action, key);
    return Array.isArray(expected) ? expected.includes(actual as never) : actual === expected;
  });

// ---------------------------------------------------------------------------
// World building
// ---------------------------------------------------------------------------

/** Whether the lesson currently offers this build action to the learner. */
export const canPerform = (lesson: Lesson, session: LessonSession, kind: BuildActionKind): boolean => {
  const rule = lesson.buildActions[kind];
  if (!rule || !allDone(session.progress, rule.requires)) return false;
  const spec = WORLD_ACTIONS[kind];
  if (rule.limit !== undefined && spec.performed(session.world) >= rule.limit) return false;
  return spec.available(session.world);
};

/** The action produced by performing a build intent, or null if it is not offered right now. */
export const buildAction = (lesson: Lesson, session: LessonSession, kind: BuildActionKind): LearnerAction | null =>
  canPerform(lesson, session, kind) ? WORLD_ACTIONS[kind].action(session.world) : null;

export const buildActionLabel = (session: LessonSession, kind: BuildActionKind) => WORLD_ACTIONS[kind].label(session.world);

const sameAction = (a: LearnerAction, b: LearnerAction) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => field(a, k) === field(b, k));
};

/** The world after the action, or null for a world-building action the lesson does not offer right now. */
const applyToWorld = (lesson: Lesson, session: LessonSession, action: LearnerAction): SandboxWorld | null => {
  const kind = buildKindOf(action);
  if (!kind) return session.world;
  const expected = buildAction(lesson, session, kind);
  if (!expected) return null;
  const { accepts } = WORLD_ACTIONS[kind];
  const ok = accepts ? accepts(session.world, action) : sameAction(expected, action);
  return ok ? reduceWorld(session.world, action) : null;
};

/** What the scene should reveal for this session. */
export const presentationOf = (lesson: Lesson, session: LessonSession) =>
  lesson.presentationFor?.(session) ?? lesson.presentation;

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const step = (lesson: Lesson, session: LessonSession, action: LearnerAction): StepResult => {
  if (session.lessonId !== lesson.id) throw new Error(`Session belongs to lesson ${session.lessonId}`);
  if (action.type === 'LESSON_RESET') return { session: createSession(lesson), completed: [] };

  const world = applyToWorld(lesson, session, action);
  // Build actions that are not offered right now are rejected outright.
  if (!world) return { session, completed: [] };

  const { progress } = session;
  const completedIds = [...progress.completed];
  const seen: Record<string, readonly string[]> = { ...progress.seen };
  const completed: Objective[] = [];
  let seenChanged = false;

  // Only objectives available *before* this action can progress, so an action
  // never satisfies an objective it just unlocked.
  for (const objective of availableObjectives(lesson, progress)) {
    const { condition } = objective;
    if (!matches(action, condition)) continue;
    if (condition.type === 'action') {
      completedIds.push(objective.id);
      completed.push(objective);
      continue;
    }
    const value = field(action, condition.key);
    if (value === undefined) continue;
    const prior = seen[objective.id] ?? [];
    if (prior.includes(String(value))) continue;
    const next = [...prior, String(value)];
    seen[objective.id] = next;
    seenChanged = true;
    if (next.length >= condition.count) {
      completedIds.push(objective.id);
      completed.push(objective);
    }
  }

  let feedback: string | undefined;
  if (completed.length === 0) {
    const current = currentObjective(lesson, progress);
    // Several objectives can be open at once; the current one speaks first.
    const open = lesson.objectives.filter((o) => o !== current && objectiveStatus(progress, o) === 'available');
    for (const o of current ? [current, ...open] : open) {
      feedback = o.feedback?.find((f) => matches(action, f))?.message;
      if (feedback) break;
    }
  }

  const progressChanged = completed.length > 0 || seenChanged;
  if (!progressChanged && world === session.world) return { session, completed, feedback };
  return {
    session: {
      ...session,
      world,
      progress: progressChanged ? { completed: completedIds, seen } : progress,
    },
    completed,
    feedback,
  };
};

// ---------------------------------------------------------------------------
// Authoring checks
// ---------------------------------------------------------------------------

/** Detects authoring mistakes: duplicate ids, unknown references, prerequisite cycles. */
export const validateLesson = (lesson: Lesson, conceptIds: ReadonlySet<string>): string[] => {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const o of lesson.objectives) {
    if (ids.has(o.id)) errors.push(`Duplicate objective id ${o.id}`);
    ids.add(o.id);
    if (!conceptIds.has(o.discovers)) errors.push(`${o.id}: unknown concept ${o.discovers}`);
    if (o.hints.length === 0) errors.push(`${o.id}: needs at least one hint`);
  }
  for (const o of lesson.objectives)
    for (const r of o.requires ?? []) if (!ids.has(r)) errors.push(`${o.id}: unknown prerequisite ${r}`);
  for (const [kind, rule] of Object.entries(lesson.buildActions))
    for (const r of rule?.requires ?? []) if (!ids.has(r)) errors.push(`${kind}: unknown prerequisite ${r}`);

  const done = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const o of lesson.objectives) {
      if (!done.has(o.id) && (o.requires ?? []).every((r) => done.has(r))) {
        done.add(o.id);
        changed = true;
      }
    }
  }
  if (done.size !== lesson.objectives.length) errors.push('Objectives contain a prerequisite cycle');
  return errors;
};
