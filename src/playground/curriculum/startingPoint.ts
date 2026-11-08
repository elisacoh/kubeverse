import { readManifests } from '../sim/manifest';
import { findObject } from '../sim/cluster';
import type { Kind, SimState } from '../sim/types';
import { LESSONS } from './index';
import type { Lesson } from './types';

/** One manifest an earlier lesson leaves in the cluster, applied to bring a lesson to its starting point. */
export interface StartingAction {
  from: Lesson;
  file: string;
  text: string;
  /** `kind/name` of the objects it creates. */
  objects: string[];
}

interface Source {
  from: Lesson;
  file: string;
  text: string;
  objects: { kind: Kind; name: string; namespace: string }[];
}

const objectsIn = (text: string) =>
  readManifests(text).objects.map(({ desired }) => ({ kind: desired.kind, name: desired.metadata.name, namespace: desired.metadata.namespace }));

const keyOf = (o: { kind: Kind; name: string; namespace: string }) => `${o.kind}/${o.namespace}/${o.name}`;

/**
 * What the cluster lacks of the state the earlier lessons leave behind (their solutions), in lesson order.
 * Objects the lesson's own `setup` provides are left to it, so a lesson can start from a different version.
 */
export const startingPoint = (lesson: Lesson, state: SimState): StartingAction[] => {
  const sources: Source[] = [];
  for (const l of LESSONS) {
    if (l.number >= lesson.number) break;
    for (const step of l.steps) {
      if (step.kind !== 'write' || !step.exercise.kind) continue;
      sources.push({ from: l, file: step.exercise.file, text: step.exercise.solution, objects: objectsIn(step.exercise.solution) });
    }
  }
  const owner = new Map<string, Source | null>();
  for (const s of sources) for (const o of s.objects) owner.set(keyOf(o), s);
  for (const text of Object.values(lesson.setup?.files ?? {})) for (const o of objectsIn(text)) owner.set(keyOf(o), null);

  return sources
    .filter((s) => s.objects.some((o) => owner.get(keyOf(o)) === s && !findObject(state, o.kind, o.name, o.namespace)))
    .map((s) => ({ from: s.from, file: s.file, text: s.text, objects: s.objects.map((o) => `${o.kind.toLowerCase()}/${o.name}`) }));
};
