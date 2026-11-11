import { describe, expect, it } from 'vitest';
import { CURRICULUM } from './curriculum';
import { fastForward } from './fastForward';

describe('fastForward', () => {
  for (const entry of CURRICULUM) {
    const lesson = entry.lesson;
    if (!lesson) continue;
    it(`rebuilds a checkpoint for every objective of ${lesson.id}`, () => {
      const { checkpoints, last } = fastForward(lesson);
      const reached = Object.keys(checkpoints);
      expect(lesson.objectives.map((o) => o.id).filter((id) => !reached.includes(id))).toEqual([]);
      expect(last.progress.completed).toHaveLength(lesson.objectives.length);
    });
  }
});
