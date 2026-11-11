import { WORLD_ACTIONS } from './sandbox';
import { buildAction, createSession, currentObjective, step } from './engine';
import type { BuildActionKind, LearnerAction, Lesson, LessonSession, Objective } from './types';

/** Upper bound of actions tried per objective, so a lesson that cannot be solved never loops. */
const MAX_TRIES = 200;

/** Actions shaped like the objective's condition: equal fields, one per listed value. */
const fromCondition = (o: Objective): LearnerAction[] => {
  const { action, where = {} } = o.condition;
  const keys = Object.keys(where);
  let combos: Record<string, unknown>[] = [{}];
  for (const k of keys) {
    const v = where[k]!;
    const values = Array.isArray(v) ? v : [v];
    combos = combos.flatMap((c) => values.map((x) => ({ ...c, [k]: x })));
  }
  if (o.condition.type === 'distinct') {
    const key = o.condition.key;
    const count = o.condition.count;
    if (!(key in where)) combos = combos.flatMap((c) => Array.from({ length: count }, (_, i) => ({ ...c, [key]: `${key}-${i}` })));
  }
  return combos.map((c) => ({ type: action, ...c }) as LearnerAction);
};

/**
 * Plays a lesson from the start without the learner, to rebuild the session
 * at each objective (the lesson was completed before sessions were saved).
 * Returns the session when each objective became the one to do (objectives it
 * cannot reach are left out), and the session it ended on.
 */
export function fastForward(lesson: Lesson): { checkpoints: Record<string, LessonSession>; last: LessonSession } {
  const checkpoints: Record<string, LessonSession> = {};
  let session = createSession(lesson);
  const kinds = Object.keys(WORLD_ACTIONS) as BuildActionKind[];
  for (let guard = 0; guard < lesson.objectives.length; guard++) {
    const objective = currentObjective(lesson, session.progress);
    if (!objective) break;
    checkpoints[objective.id] ??= session;
    let tries = 0;
    const done = () => session.progress.completed.includes(objective.id);
    const attempt = (a: LearnerAction) => {
      tries++;
      try {
        session = step(lesson, session, a).session;
      } catch {
        // A made-up action missing fields the lesson needs: try the next one.
      }
    };
    while (!done() && tries < MAX_TRIES) {
      const before = session;
      for (const a of fromCondition(objective)) {
        if (done()) break;
        attempt(a);
      }
      for (const k of [...(objective.actions ?? []), ...kinds]) {
        if (done()) break;
        const a = buildAction(lesson, session, k);
        if (a) attempt(a);
      }
      if (session === before) break;
    }
    if (!done()) break;
  }
  return { checkpoints, last: session };
}
