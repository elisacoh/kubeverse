import { describe, expect, it } from 'vitest';
import {
  availableObjectives,
  buildAction,
  canPerform,
  createSession,
  currentObjective,
  isLessonComplete,
  step,
  validateLesson,
} from './engine';
import { conceptIds } from './concepts';
import { birthOfACluster as lesson } from './lessons/birthOfACluster';
import { EMPTY_WORLD } from './sandbox';
import type { LearnerAction, LessonSession } from './types';

const init: LearnerAction = { type: 'CLUSTER_INITIALIZED', controlPlaneNodeId: 'control-plane-1' };
const add = (n: number): LearnerAction => ({ type: 'NODE_ADDED', nodeId: `worker-${n}`, role: 'worker' });
const selectCP: LearnerAction = { type: 'ENTITY_SELECTED', entityId: 'control-plane-1', entityKind: 'control-plane' };
const selectWorker = (n = 1): LearnerAction => ({ type: 'ENTITY_SELECTED', entityId: `worker-${n}`, entityKind: 'worker-node' });

const run = (actions: LearnerAction[], start: LessonSession = createSession(lesson)) =>
  actions.reduce((s, a) => step(lesson, s, a).session, start);

const FULL_RUN = [init, selectCP, add(1), add(2), selectCP, selectWorker(2)];

describe('lesson state machine', () => {
  it('starts from an empty universe with only the initialization offered', () => {
    const s = createSession(lesson);
    expect(s.world).toEqual(EMPTY_WORLD);
    expect(currentObjective(lesson, s.progress)?.id).toBe('initialize-cluster');
    expect(canPerform(lesson, s, 'initialize-cluster')).toBe(true);
    expect(canPerform(lesson, s, 'add-worker-node')).toBe(false);
  });

  it('initializing the cluster updates the world and completes the first objective', () => {
    const r = step(lesson, createSession(lesson), init);
    expect(r.session.world.initialized).toBe(true);
    expect(r.completed.map((o) => o.id)).toEqual(['initialize-cluster']);
    expect(canPerform(lesson, r.session, 'initialize-cluster')).toBe(false);
  });

  it('does not offer worker Nodes before the control plane has been discovered', () => {
    const s = run([init]);
    expect(canPerform(lesson, s, 'add-worker-node')).toBe(false);
    expect(buildAction(lesson, s, 'add-worker-node')).toBeNull();
    // A forged NODE_ADDED is rejected and changes nothing.
    const r = step(lesson, s, add(1));
    expect(r.session).toBe(s);
  });

  it('rejects build actions that do not match the next expected Node', () => {
    const s = run([init, selectCP]);
    expect(step(lesson, s, add(2)).session).toBe(s);
    expect(buildAction(lesson, s, 'add-worker-node')).toEqual(add(1));
  });

  it('limits the lesson to two worker Nodes', () => {
    const s = run([init, selectCP, add(1), add(2)]);
    expect(s.world.workers).toEqual(['worker-1', 'worker-2']);
    expect(canPerform(lesson, s, 'add-worker-node')).toBe(false);
    expect(step(lesson, s, add(3)).session).toBe(s);
  });

  it('never lets one action satisfy an objective it just unlocked', () => {
    // Adding the first worker must not also count as the second one.
    const s = run([init, selectCP, add(1)]);
    expect(s.progress.completed).toContain('add-first-worker');
    expect(s.progress.completed).not.toContain('add-second-worker');
    // Selecting the control plane earlier does not pre-complete "identify coordination".
    expect(s.progress.completed).not.toContain('identify-coordination');
  });

  it('validates identification by semantic entity kind and gives feedback on mistakes', () => {
    const s = run([init, selectCP, add(1), add(2)]);
    const wrong = step(lesson, s, selectWorker(1));
    expect(wrong.completed).toEqual([]);
    expect(wrong.feedback).toMatch(/worker Node/);
    expect(wrong.session).toBe(s);

    const right = step(lesson, s, selectCP);
    expect(right.completed.map((o) => o.id)).toEqual(['identify-coordination']);

    const wrong2 = step(lesson, right.session, selectCP);
    expect(wrong2.feedback).toMatch(/control plane/);
    expect(step(lesson, right.session, selectWorker(2)).completed.map((o) => o.id)).toEqual(['identify-capacity']);
  });

  it('completes only after the full sequence, independent of timing', () => {
    expect(isLessonComplete(lesson, run(FULL_RUN.slice(0, -1)).progress)).toBe(false);
    const s = run(FULL_RUN);
    expect(isLessonComplete(lesson, s.progress)).toBe(true);
    expect(availableObjectives(lesson, s.progress)).toEqual([]);
  });

  it('ignores selections that are irrelevant to the current objective', () => {
    const s = run([init]);
    const r = step(lesson, s, { type: 'ENTITY_SELECTED', entityId: 'x', entityKind: 'pod' });
    expect(r.session).toBe(s);
    expect(r.feedback).toBeUndefined();
  });

  it('LESSON_RESET restores the initial empty state', () => {
    const s = run(FULL_RUN);
    expect(run([{ type: 'LESSON_RESET' }], s)).toEqual(createSession(lesson));
  });

  it('is deterministic and never mutates earlier sessions', () => {
    const start = createSession(lesson);
    expect(run(FULL_RUN, start)).toEqual(run(FULL_RUN, start));
    expect(start).toEqual(createSession(lesson));
  });

  it('rejects sessions from another lesson', () => {
    expect(() => step(lesson, { ...createSession(lesson), lessonId: 'other' }, init)).toThrow();
  });

  it('the lesson definition is well-formed', () => {
    expect(validateLesson(lesson, conceptIds)).toEqual([]);
  });

  it('detects authoring mistakes', () => {
    const broken = {
      ...lesson,
      objectives: [{ ...lesson.objectives[0]!, requires: ['nope'], discovers: 'missing' }],
    };
    const errors = validateLesson(broken, conceptIds);
    expect(errors.some((e) => e.includes('unknown prerequisite'))).toBe(true);
    expect(errors.some((e) => e.includes('unknown concept'))).toBe(true);
  });
});
