/**
 * Toys: practice files that are not Kubernetes objects (L00's pet.yaml).
 * Once their exercise is done, `kubectl apply -f` brings them to life in the
 * world instead of failing, and `kubectl delete -f` sends them away. Pure, so
 * the terminal behaviour is testable without the UI.
 */
import { LESSONS } from './curriculum';
import { validateExercise } from './curriculum/checks';
import { modeOf, type ProgressMap } from './curriculum/progress';
import type { Exercise, WriteStep } from './curriculum/types';
import type { CommandResult, OutputLine } from './kubectl/run';

export interface Toy {
  kind: NonNullable<Exercise['toy']>;
  file: string;
  name: string;
  /** The parsed file, shown on the toy's card. */
  fields: Record<string, unknown>;
  /** Bumped on every apply, to replay the entrance. */
  seq: number;
}

export type ToyOutcome =
  /** The command is about the toy: show this instead of running kubectl. */
  | { result: CommandResult; toy: Toy | null }
  /** Run kubectl as usual, then add this line. */
  | { hint: OutputLine };

const COMMAND = /^(?:kubectl|k)\s+(apply|delete)\s+(?:-f\s+|--filename[=\s]+)(\S+)\s*$/;

const toyStep = (file: string): { lessonId: (typeof LESSONS)[number]['id']; step: WriteStep } | null => {
  for (const l of LESSONS) {
    for (const s of l.steps) if (s.kind === 'write' && s.exercise.toy && s.exercise.file === file) return { lessonId: l.id, step: s };
  }
  return null;
};

const nameOf = (fields: Record<string, unknown>) =>
  String(typeof fields.name === 'string' || typeof fields.name === 'number' ? fields.name : 'cat')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'cat';

const ok = (lines: OutputLine[]): CommandResult => ({ ok: true, lines, effects: [] });

export const toyCommand = (
  line: string,
  ctx: { files: Readonly<Record<string, string>>; progress: ProgressMap; toy: Toy | null },
): ToyOutcome | null => {
  const m = COMMAND.exec(line.trim());
  if (!m) return null;
  const verb = m[1];
  const file = m[2]!;
  const found = toyStep(file);
  if (!found) return null;
  const { step, lessonId } = found;

  if (verb === 'delete') {
    if (ctx.toy?.file !== file) return null;
    return { result: ok([{ text: `${ctx.toy.kind}/${ctx.toy.name} deleted`, tone: 'success' }, { text: 'It jumped back into the YAML.', tone: 'muted' }]), toy: null };
  }

  const progress = ctx.progress[lessonId];
  const text = ctx.files[file];
  const done = !!progress?.done.includes(step.id);
  const valid = text !== undefined && validateExercise(step.exercise, text, modeOf(progress, step), Number.MAX_SAFE_INTEGER);
  if (!done || !valid || !valid.passed || typeof valid.doc !== 'object' || valid.doc === null || Array.isArray(valid.doc)) {
    return { hint: { text: `hint: ${file} is plain YAML, not a Kubernetes manifest. Finish "${step.title}" and apply it again: something fun will happen.`, tone: 'hint' } };
  }

  const fields = valid.doc as Record<string, unknown>;
  const name = nameOf(fields);
  const kind = step.exercise.toy!;
  const same = ctx.toy?.file === file && JSON.stringify(ctx.toy.fields) === JSON.stringify(fields);
  const verbText = same ? 'unchanged' : ctx.toy?.file === file ? 'configured' : 'created';
  return {
    result: ok([
      { text: `${kind}/${name} ${verbText}`, tone: 'success' },
      { text: `Just for fun: ${file} is not a Kubernetes object, so a real API server would reject it. Here it becomes a little ${kind}: look at the world.`, tone: 'muted' },
      ...(fields.color === undefined ? [{ text: 'Try adding `color: grey` (any CSS color) and applying again.', tone: 'hint' as const }] : []),
    ]),
    toy: { kind, file, name, fields, seq: (ctx.toy?.seq ?? 0) + 1 },
  };
};
