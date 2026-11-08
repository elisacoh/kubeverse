import { describe, expect, it } from 'vitest';
import { LESSONS } from './index';
import { validateExercise } from './checks';
import { startingPoint } from './startingPoint';
import { runCommand } from '../kubectl/run';
import { SimulatedCluster } from '../sim/backend';
import { objectsOf, settle } from '../sim/cluster';
import type { CommandRecord, Exercise, Lesson } from './types';

const exercisesOf = (l: Lesson) => l.steps.flatMap((s) => (s.kind === 'write' ? [s.exercise] : []));

describe('curriculum data', () => {
  it('has the eleven lessons in order, with unique step ids', () => {
    expect(LESSONS.map((l) => l.number)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const l of LESSONS) {
      const ids = l.steps.map((s) => s.id);
      expect(new Set(ids).size, l.id).toBe(ids.length);
      for (const p of l.prerequisites) expect(LESSONS.some((x) => x.id === p)).toBe(true);
    }
  });

  it('every quiz has exactly one correct answer', () => {
    for (const l of LESSONS) for (const s of l.steps) if (s.kind === 'quiz') expect(s.options.filter((o) => o.correct), `${l.id}/${s.id}`).toHaveLength(1);
  });

  it('every write step has three progressive hints and a solution', () => {
    for (const l of LESSONS) for (const ex of exercisesOf(l)) {
      expect(ex.hints).toHaveLength(3);
      expect(ex.solution.length).toBeGreaterThan(0);
    }
  });
});

describe('exercise validation', () => {
  const all = LESSONS.flatMap((l) => exercisesOf(l).map((ex) => [`${l.id}/${ex.file}`, ex] as const));

  it.each(all)('%s: the solution passes in every mode', (_, ex) => {
    const modes = ex.modes ? (['guided', 'complete', 'scratch'] as const) : (['scratch'] as const);
    for (const mode of modes) {
      const last = (ex.modes?.guided.length ?? 1) - 1;
      const v = validateExercise(ex, ex.solution, mode, last);
      expect({ mode, syntax: v.syntax, schema: v.schema, failed: v.objectives.filter((o) => !o.ok) }).toEqual({ mode, syntax: [], schema: [], failed: [] });
    }
  });

  it.each(all.filter(([, ex]) => ex.modes))('%s: guided steps pass one at a time with the solution', (_, ex) => {
    ex.modes!.guided.forEach((_step, i) => expect(validateExercise(ex, ex.solution, 'guided', i).passed, `step ${i}`).toBe(true));
  });

  it.each(all.filter(([, ex]) => ex.modes))('%s: starters do not pass on their own', (_, ex) => {
    expect(validateExercise(ex, ex.modes!.complete, 'complete', 0).passed).toBe(false);
    expect(validateExercise(ex, ex.modes!.scratch, 'scratch', 0).passed).toBe(false);
  });

  const pod = LESSONS[1]!.steps.find((s) => s.kind === 'write')!.exercise as Exercise;

  it('accepts equivalent manifests written differently', () => {
    const flow = '{"kind": "Pod", "apiVersion": "v1", "metadata": {"name": "hello-pod"}, "spec": {"containers": [{"image": "docker.io/library/nginx:1.27", "name": "server"}]}}';
    expect(validateExercise(pod, flow, 'scratch', 0).passed).toBe(true);
    const reordered = 'kind: Pod\nspec:\n  containers:\n  - image: nginx\n    name: c\nmetadata:\n  name: "hello-pod"\napiVersion: v1\n';
    expect(validateExercise(pod, reordered, 'scratch', 0).passed).toBe(true);
  });

  it('separates syntax, schema and objective problems', () => {
    const syntax = validateExercise(pod, 'apiVersion: v1\nkind: Pod\nmetadata:\n\tname: hello-pod\n', 'scratch', 0);
    expect(syntax.syntax.length).toBeGreaterThan(0);
    expect(syntax.objectives).toHaveLength(0);

    const schema = validateExercise(pod, pod.solution.replace('containerPort', 'containerport'), 'scratch', 0);
    expect(schema.syntax).toHaveLength(0);
    expect(schema.schema[0]?.message).toMatch(/containerport/);
    expect(schema.objectives.every((o) => o.ok)).toBe(true);
    expect(schema.passed).toBe(false);

    const objective = validateExercise(pod, pod.solution.replace('hello-pod', 'my-pod'), 'scratch', 0);
    expect(objective.schema).toHaveLength(0);
    expect(objective.objectives.find((o) => !o.ok)?.feedback).toMatch(/hello-pod/);
  });

  it('checks only the steps reached so far in guided mode', () => {
    expect(validateExercise(pod, 'apiVersion: v1\nkind: Pod\n', 'guided', 0).passed).toBe(true);
    expect(validateExercise(pod, 'apiVersion: v1\nkind: Pod\n', 'guided', 1).passed).toBe(false);
  });

  it('flags unfilled blanks', () => {
    const v = validateExercise(pod, pod.modes!.complete, 'complete', 0);
    expect(v.objectives[0]).toMatchObject({ id: 'blanks', ok: false });
  });
});

/** Steps whose suggested command contains a placeholder get a concrete one here. */
const concreteCommand = (cmd: string, api: SimulatedCluster) => {
  const pods = objectsOf(api.snapshot(), 'Pod').map((p) => p.metadata.name);
  if (cmd.includes('web-rs-xxxxx')) return `kubectl delete pod ${pods.find((n) => n.startsWith('web-rs-'))}`;
  if (cmd.includes('health-…')) return `kubectl describe pod ${pods.find((n) => n.startsWith('health-'))}`;
  return cmd;
};

/** What a learner does in the editor before a cluster step that asks for an edit. */
const EDITS: Record<string, (files: Record<string, string>) => string> = {
  'deployment/rollout': (files) => {
    files['deployment.yaml'] = files['deployment.yaml']!.replace('nginx:stable', 'nginx:1.27');
    return 'kubectl apply -f deployment.yaml';
  },
};

describe('lesson walkthroughs', () => {
  const cases = LESSONS.flatMap((l) => [[l.id, 'a fresh cluster', l] as const, [l.id, 'its starting point', l] as const]);
  it.each(cases)('%s can be completed from %s', async (_, start, lesson) => {
    const api = new SimulatedCluster();
    const files: Record<string, string> = {};
    const log: CommandRecord[] = [];
    const run = async (input: string) => {
      const result = await runCommand(input, { api, files });
      log.push({ seq: log.length, input, result, time: api.snapshot().time });
      return result;
    };
    const advance = () => api.load(settle(api.snapshot()));

    if (start === 'its starting point') {
      for (const a of startingPoint(lesson, api.snapshot())) {
        const result = await runCommand(`kubectl apply -f ${a.file}`, { api, files: { [a.file]: a.text } });
        expect(result.ok, `${a.from.id}/${a.file}`).toBe(true);
      }
      advance();
    }

    if (lesson.setup?.needed(api.snapshot())) {
      Object.assign(files, lesson.setup.files);
      for (const c of lesson.setup.commands) expect((await run(c)).ok, c).toBe(true);
      advance();
      expect(lesson.setup.needed(api.snapshot())).toBe(false);
    }
    log.length = 0;

    for (const step of lesson.steps) {
      const where = `${lesson.id}/${step.id}`;
      if (step.kind === 'write') {
        files[step.exercise.file] = step.exercise.solution;
      } else if (step.kind === 'command') {
        const result = await run(concreteCommand(step.command, api));
        expect(result.ok, `${where}: ${result.lines.map((l) => l.text).join('\n')}`).toBe(true);
        advance();
        expect(step.check(log, api.snapshot()), where).toBe(true);
      } else if (step.kind === 'cluster') {
        const edit = EDITS[where];
        if (edit) expect((await run(edit(files))).ok).toBe(true);
        advance();
        expect(step.check(api.snapshot()), where).toBeNull();
      }
    }
  });
});
