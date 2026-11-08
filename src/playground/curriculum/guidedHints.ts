import { lastLine, parseYaml, type Path } from '../sim/manifest';
import { lookupField } from '../sim/schema';
import type { ObjectiveResult } from './checks';
import type { Exercise } from './types';

/** The three hints of one guided step, built from the step itself so they always match it. */
export interface GuidedHints {
  /** What this step (or an earlier one) still lacks in the current text. */
  missing: string[];
  /** Where the step's fields go in the YAML structure. */
  structure: string[];
  /** The solution's lines up to and including this step. */
  snippet: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Concrete paths for a field path such as `spec.containers.image`, fanning out over list items. */
const concrete = (value: unknown, field: string): Path[] => {
  let paths: { path: Path; v: unknown }[] = [{ path: [], v: value }];
  for (const seg of field.split('.')) {
    const next: typeof paths = [];
    for (const { path, v } of paths) {
      const items = Array.isArray(v) ? v.map((item, i) => ({ path: [...path, i], v: item })) : [{ path, v }];
      for (const it of items) if (isObject(it.v) && it.v[seg] !== undefined) next.push({ path: [...it.path, seg], v: it.v[seg] });
    }
    paths = next;
  }
  return paths.map((p) => p.path);
};

const isPrefix = (a: string, b: string) => b === a || b.startsWith(`${a}.`);

/** The solution cut down to what the guided steps up to `g` write; later steps' fields are left out. */
export const solutionUpTo = (ex: Exercise, g: number): string => {
  const steps = ex.modes?.guided ?? [];
  const doc = parseYaml(ex.solution).docs[0];
  if (!doc) return ex.solution;
  // Identity fields no step asks for come prefilled in the starter.
  const prefilled = ['apiVersion', 'kind', 'metadata.name'].filter((b) => !steps.some((s) => s.fields.some((f) => isPrefix(f, b))));
  const sofar = [...prefilled, ...steps.slice(0, g + 1).flatMap((s) => s.fields)];
  const later = steps.slice(g + 1).flatMap((s) => s.fields).filter((l) => !sofar.some((f) => isPrefix(l, f)));
  const span = (path: Path) => {
    const from = doc.lineOf(path, true) ?? doc.lineOf(path);
    if (from === undefined) return [];
    const to = lastLine(path.reduce<unknown>((v, seg) => (v as Record<string | number, unknown>)[seg], doc.value), path, doc.lineOf);
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  };

  const lines = new Set<number>();
  for (const f of sofar) for (const p of concrete(doc.value, f)) span(p).forEach((l) => lines.add(l));
  for (const f of later) for (const p of concrete(doc.value, f)) span(p).forEach((l) => lines.delete(l));
  for (const f of sofar) {
    for (const p of concrete(doc.value, f)) {
      for (let i = 1; i < p.length; i++) {
        const line = doc.lineOf(p.slice(0, i), true) ?? doc.lineOf(p.slice(0, i));
        if (line !== undefined) lines.add(line);
      }
    }
  }
  const text = ex.solution.split('\n');
  return [...lines].sort((a, b) => a - b).map((l) => text[l - 1] ?? '').join('\n');
};

/** The solution's line for a scalar field, e.g. `image: nginx:stable`. */
const solutionLine = (ex: Exercise, field: string): string | undefined => {
  const doc = parseYaml(ex.solution).docs[0];
  const path = doc && concrete(doc.value, field)[0];
  if (!doc || !path) return undefined;
  const value = path.reduce<unknown>((v, seg) => (v as Record<string | number, unknown>)[seg], doc.value);
  if (typeof value === 'object' && value !== null) return undefined;
  const line = doc.lineOf(path, true);
  return line === undefined ? undefined : ex.solution.split('\n')[line - 1]?.trim().replace(/^-\s+/, '');
};

const placement = (ex: Exercise, field: string): string | null => {
  const segs = field.split('.');
  const key = segs[segs.length - 1]!;
  const found = ex.kind ? lookupField(ex.kind, segs) : null;
  const node = found?.field.node;
  const shape =
    node?.type === 'array' ? ` It holds a list: each item starts with \`- \`.` : node?.type === 'object' || node?.type === 'map' ? ` It holds a mapping: its keys go on the lines below, indented 2 more spaces.` : '';
  const line = solutionLine(ex, field);
  const example = line ? ` Here: \`${line}\`.` : '';
  if (segs.length === 1) return `\`${key}\` is a top-level key, at the very start of the line.${shape}${example}`;
  const parent = segs[segs.length - 2]!;
  const parentNode = ex.kind ? lookupField(ex.kind, segs.slice(0, -1))?.field.node : undefined;
  const where =
    parentNode?.type === 'array'
      ? `\`${key}\` goes inside an item of \`${parent}\`: the item's first key follows the \`- \`, the next ones line up under it.`
      : `\`${key}\` goes under \`${parent}:\`, indented 2 more spaces.`;
  return `${where}${shape}${example}`;
};

export const guidedHints = (ex: Exercise, g: number, objectives: readonly ObjectiveResult[]): GuidedHints | null => {
  const step = ex.modes?.guided[g];
  if (!step) return null;
  const first = objectives.find((o) => !o.ok);
  const firstText = first ? (first.feedback ?? `Not yet: ${first.label}.`) : '';
  const about = first && ex.kind ? [...step.fields].reverse().find((f) => firstText.includes(`\`${f}\``) || firstText.includes(`\`${f.split('.').pop()}\``)) : undefined;
  const meaning = about && ex.kind ? lookupField(ex.kind, about.split('.'))?.field.doc.summary : undefined;
  return {
    missing: first
      ? [`Start here: ${firstText}`, ...(meaning ? [`\`${about!.split('.').pop()}\`: ${meaning}`] : [])]
      : [step.checks.length ? 'Everything this step asks for is there: press **Check this step**.' : 'This step is optional: add it if you like, then press **Check my manifest**.'],
    structure: [...new Set(step.fields)].map((f) => placement(ex, f)).filter((s): s is string => !!s),
    snippet: solutionUpTo(ex, g),
  };
};
