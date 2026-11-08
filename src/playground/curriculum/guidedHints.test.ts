import { describe, expect, it } from 'vitest';
import { LESSONS, lessonById } from './index';
import { guidedHints, solutionUpTo } from './guidedHints';
import { validateExercise } from './checks';
import type { Exercise } from './types';

const exerciseOf = (lessonId: string): Exercise => {
  const step = lessonById(lessonId)!.steps.find((s) => s.kind === 'write' && s.exercise.modes);
  if (step?.kind !== 'write') throw new Error(`no guided exercise in ${lessonId}`);
  return step.exercise;
};

describe('solutionUpTo', () => {
  const pod = exerciseOf('first-pod');

  it('shows only what the steps so far write', () => {
    expect(solutionUpTo(pod, 0)).toBe('apiVersion: v1\nkind: Pod');
    expect(solutionUpTo(pod, 1)).toBe('apiVersion: v1\nkind: Pod\nmetadata:\n  name: hello-pod');
    const s2 = solutionUpTo(pod, 2);
    expect(s2).toMatch(/spec:\n {2}containers:\n {4}- name: \w+/);
    expect(s2).not.toMatch(/image|ports/);
    expect(solutionUpTo(pod, 3)).toMatch(/image: nginx/);
    expect(solutionUpTo(pod, 3)).not.toMatch(/ports/);
  });

  it('ends with the whole solution at the last step', () => {
    const last = (pod.modes?.guided.length ?? 1) - 1;
    expect(solutionUpTo(pod, last).trim()).toBe(pod.solution.trim());
  });

  it('keeps a parent field without the children later steps add', () => {
    const rs = exerciseOf('replicaset');
    const template = rs.modes!.guided.findIndex((s) => s.fields.includes('spec.template'));
    const text = solutionUpTo(rs, template);
    expect(text).toMatch(/template:\n {4}metadata:\n {6}labels:/);
    expect(text).not.toMatch(/containers/);
  });

  it('every guided step of every lesson gets a non-empty snippet that grows step by step', () => {
    for (const l of LESSONS) {
      for (const s of l.steps) {
        if (s.kind !== 'write' || !s.exercise.modes) continue;
        let prev = 0;
        s.exercise.modes.guided.forEach((_, g) => {
          const lines = solutionUpTo(s.exercise, g).split('\n').length;
          expect(lines, `${l.id}/${s.id}#${g}`).toBeGreaterThanOrEqual(prev);
          prev = lines;
        });
      }
    }
  });
});

describe('guidedHints', () => {
  const pod = exerciseOf('first-pod');

  it("says what the current step still lacks, from the learner's text", () => {
    const text = 'apiVersion: v1\nkind: Pod\n';
    const hints = guidedHints(pod, 1, validateExercise(pod, text, 'guided', 1).objectives)!;
    expect(hints.missing.join(' ')).toMatch(/metadata/);
    expect(hints.structure.join(' ')).toMatch(/`name` goes under `metadata:`/);
  });

  it('describes list items for fields inside a list', () => {
    const hints = guidedHints(pod, 3, [])!;
    expect(hints.structure.join(' ')).toMatch(/inside an item of `containers`/);
  });
});
