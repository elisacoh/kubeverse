import { describe, expect, it } from 'vitest';
import { lessonById } from '../curriculum';
import { validateExercise } from '../curriculum/checks';
import type { WriteStep } from '../curriculum/types';
import { blankLine, judgeWhileTyping } from './typing';

const pet = lessonById('yaml-basics')!.steps.find((s): s is WriteStep => s.id === 'pet')!.exercise;
const judge = (text: string, line: number | null) =>
  judgeWhileTyping(text, line, (t) => validateExercise(pet, t, 'scratch', 0), (r) => r.syntax.map((i) => i.line));

describe('judgeWhileTyping', () => {
  it('blanks one line and keeps the others in place', () => {
    expect(blankLine('a: 1\nb\nc: 3', 2)).toBe('a: 1\n\nc: 3');
  });

  it('does not report a key typed halfway on the cursor line', () => {
    const text = 'name: Mochi\nage';
    expect(judge(text, null).syntax.length).toBeGreaterThan(0);
    const typing = judge(text, 2);
    expect(typing.syntax).toEqual([]);
    expect(typing.objectives.find((o) => o.id === 'age-number')?.ok).toBe(false);
  });

  it('still reports errors on other lines', () => {
    expect(judge('name: Mochi\nage\nowner:\n  city: Lisbon', 4).syntax.length).toBeGreaterThan(0);
  });
});
