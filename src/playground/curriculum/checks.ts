/**
 * Reusable building blocks for exercise objectives and step checks. Manifests
 * are checked as parsed structures, never as text: any formatting or field
 * order that means the same thing passes.
 */
import { parseYaml, validateObject, type Issue } from '../sim/manifest';
import { findObject, isDeleting, isPodReady, objectsOf, serviceEndpoints } from '../sim/cluster';
import type { CommandRecord, Exercise, ExerciseMode, ManifestCheck } from './types';
import type { Kind, SimState } from '../sim/types';
import type { Effect } from '../kubectl/run';

// ---------------------------------------------------------------------------
// Reading paths like `spec.containers[0].image` or `spec.containers[*].name`
// ---------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Every value at a path; `[*]` fans out over list items. */
export const valuesAt = (doc: unknown, path: string): unknown[] => {
  const segs = path.match(/[^.[\]]+|\[\*\]|\[\d+\]/g) ?? [];
  let current: unknown[] = [doc];
  for (const seg of segs) {
    const next: unknown[] = [];
    for (const v of current) {
      if (seg === '[*]') {
        if (Array.isArray(v)) next.push(...v);
      } else if (/^\[\d+\]$/.test(seg)) {
        if (Array.isArray(v)) next.push(v[Number(seg.slice(1, -1))]);
      } else if (isObject(v)) {
        next.push(v[seg]);
      }
    }
    current = next.filter((x) => x !== undefined);
  }
  return current;
};

export const valueAt = (doc: unknown, path: string): unknown => valuesAt(doc, path)[0];

const show = (v: unknown) => (typeof v === 'string' ? `"${v}"` : JSON.stringify(v));

// ---------------------------------------------------------------------------
// Manifest checks
// ---------------------------------------------------------------------------

export const check = (id: string, label: string, test: (doc: unknown) => string | null): ManifestCheck => ({ id, label, test });

export const equals = (path: string, expected: unknown, label?: string, missing?: string): ManifestCheck =>
  check(`${path}=${String(expected)}`, label ?? `\`${path}\` is ${show(expected)}`, (doc) => {
    const v = valueAt(doc, path);
    if (v === undefined) return missing ?? `\`${path}\` is missing.`;
    return v === expected ? null : `\`${path}\` is ${show(v)}; expected ${show(expected)}.`;
  });

export const present = (path: string, label?: string, missing?: string): ManifestCheck =>
  check(`${path}?`, label ?? `\`${path}\` is set`, (doc) => (valueAt(doc, path) === undefined || valueAt(doc, path) === null ? (missing ?? `\`${path}\` is missing.`) : null));

export const matches = (path: string, re: RegExp, label: string, wrong: string): ManifestCheck =>
  check(`${path}~${re.source}`, label, (doc) => {
    const v = valueAt(doc, path);
    if (v === undefined) return `\`${path}\` is missing.`;
    return typeof v === 'string' && re.test(v) ? null : `${wrong} (found ${show(v)})`;
  });

export const isList = (path: string, min: number, label: string, missing: string): ManifestCheck =>
  check(`${path}[]>=${min}`, label, (doc) => {
    const v = valueAt(doc, path);
    if (v === undefined) return missing;
    if (!Array.isArray(v)) return `\`${path}\` must be a list: each item starts with "- " on its own line.`;
    return v.length >= min ? null : missing;
  });

export const isMapping = (path: string, label: string, missing: string): ManifestCheck =>
  check(`${path}{}`, label, (doc) => {
    const v = valueAt(doc, path);
    if (v === undefined || v === null) return missing;
    return isObject(v) ? null : `\`${path}\` must be a mapping: indent its \`key: value\` lines under it.`;
  });

/** Some item of a list carries an image of this repository (any tag). */
export const anyImage = (path: string, repo: string): ManifestCheck =>
  check(`${path}~${repo}`, `a container runs the \`${repo}\` image`, (doc) => {
    const images = valuesAt(doc, path).filter((v): v is string => typeof v === 'string');
    if (images.length === 0) return `No container image yet: give a container \`image: ${repo}:stable\` (or another ${repo} tag).`;
    return images.some((i) => i.split('@')[0]!.split(':')[0]!.split('/').pop() === repo) ? null : `The image should be ${repo} (e.g. \`${repo}:stable\`), found ${images.map((i) => `"${i}"`).join(', ')}.`;
  });

export const labelsInclude = (path: string, minCount: number, required: string[], label: string): ManifestCheck =>
  check(`${path}:labels`, label, (doc) => {
    const v = valueAt(doc, path);
    if (!isObject(v)) return `No labels yet: add a \`labels:\` mapping under \`${path.replace(/\.labels$/, '')}\`.`;
    const missing = required.filter((k) => !(k in v));
    if (missing.length) return `Add a \`${missing[0]}\` label.`;
    return Object.keys(v).length >= minCount ? null : `Add at least ${minCount} labels (you have ${Object.keys(v).length}).`;
  });

/** Every selector label appears, with the same value, in the template's labels. */
export const selectorMatchesTemplate = (selectorPath: string, labelsPath: string): ManifestCheck =>
  check('selector-matches-template', 'the selector matches the Pod template labels', (doc) => {
    const sel = valueAt(doc, selectorPath);
    const labels = valueAt(doc, labelsPath);
    if (!isObject(sel) || Object.keys(sel).length === 0) return `\`${selectorPath}\` needs at least one label.`;
    if (!isObject(labels)) return `\`${labelsPath}\` is missing: the Pods need labels the selector can find.`;
    const bad = Object.entries(sel).find(([k, v]) => labels[k] !== v);
    return bad ? `The selector asks for \`${bad[0]}: ${String(bad[1])}\` but the template labels don't have it. They must match.` : null;
  });

// ---------------------------------------------------------------------------
// Exercise validation
// ---------------------------------------------------------------------------

/** Placeholder used in "Complete YAML" starters. */
export const BLANK = '___';

export interface ObjectiveResult {
  id: string;
  label: string;
  ok: boolean;
  feedback?: string;
}

export interface ExerciseValidation {
  syntax: Issue[];
  schema: Issue[];
  objectives: ObjectiveResult[];
  passed: boolean;
  /** The first parsed document, for field docs and previews. */
  doc: unknown;
}

const runChecks = (checks: readonly ManifestCheck[], doc: unknown): ObjectiveResult[] =>
  checks.map((c) => {
    const feedback = c.test(doc);
    return { id: c.id, label: c.label, ok: feedback === null, ...(feedback ? { feedback } : {}) };
  });

/** The document an exercise is about: the one of its kind, else the first. */
const pickDoc = (docs: unknown[], kind?: Kind) => (kind ? (docs.find((d) => isObject(d) && d.kind === kind) ?? docs[0]) : docs[0]);

/**
 * Validates the learner's text for an exercise, in the given mode. In guided
 * mode before the last step, intermediate YAML is checked only against the
 * steps so far: it does not have to be a complete object yet.
 */
export const validateExercise = (exercise: Exercise, text: string, mode: ExerciseMode, guidedStep: number): ExerciseValidation => {
  const { docs, issues } = parseYaml(text);
  const doc = pickDoc(docs.map((d) => d.value), exercise.kind);
  const parsed = docs.find((d) => d.value === doc);
  if (issues.length) return { syntax: issues, schema: [], objectives: [], passed: false, doc };

  const steps = exercise.modes?.guided ?? [];
  const partial = mode === 'guided' && steps.length > 0 && guidedStep < steps.length - 1;
  if (partial) {
    const checks = steps.slice(0, guidedStep + 1).flatMap((s) => s.checks);
    const objectives = runChecks(checks, doc);
    return { syntax: [], schema: [], objectives, passed: doc !== undefined && objectives.every((o) => o.ok), doc };
  }

  const checks = mode === 'guided' && steps.length ? [...steps.flatMap((s) => s.checks), ...exercise.checks] : exercise.checks;
  const unique = checks.filter((c, i) => checks.findIndex((x) => x.id === c.id) === i);
  const schema = exercise.kind && doc !== undefined ? validateObject(doc, parsed?.lineOf).issues : [];
  const objectives = runChecks(unique, doc);
  if (text.includes(BLANK)) objectives.unshift({ id: 'blanks', label: 'every blank is filled in', ok: false, feedback: `Replace each \`${BLANK}\` with a value.` });
  if (doc === undefined) {
    return { syntax: [], schema: [], objectives, passed: false, doc };
  }
  return { syntax: [], schema, objectives, passed: schema.length === 0 && objectives.every((o) => o.ok), doc };
};

// ---------------------------------------------------------------------------
// Command and cluster checks
// ---------------------------------------------------------------------------

const effects = (log: readonly CommandRecord[]) => log.flatMap((r) => (r.result.ok ? r.result.effects : []));

/** A successful `kubectl apply` (or create) of this object, optionally from a given file. */
export const applied = (kind: Kind, name: string | ((n: string) => boolean), file?: string) => (log: readonly CommandRecord[]) =>
  effects(log).some(
    (e) => (e.verb === 'apply' || e.verb === 'create') && e.kind === kind && (typeof name === 'string' ? e.name === name : !!e.name && name(e.name)) && !!e.action && (!file || e.file === file),
  );

/** Applied with a real change (created or configured), not "unchanged". */
export const changedBy = (kind: Kind, name: string) => (log: readonly CommandRecord[]) =>
  effects(log).some((e) => (e.verb === 'apply' || e.verb === 'create') && e.kind === kind && e.name === name && (e.action === 'created' || e.action === 'configured'));

/** A successful `kubectl get` listing this kind (directly or through `get all`). */
export const listed = (kind: Kind, extra?: (e: Effect) => boolean) => (log: readonly CommandRecord[]) =>
  effects(log).some((e) => e.verb === 'get' && (e.resources?.includes(kind) ?? false) && (!extra || extra(e)));

export const described = (kind: Kind, name?: string | ((n: string) => boolean)) => (log: readonly CommandRecord[]) =>
  effects(log).some((e) => e.verb === 'describe' && e.kind === kind && (name === undefined || (typeof name === 'string' ? e.name === name : !!e.name && name(e.name))));

export const deletedOwnedPod = (owner: (s: SimState) => string | undefined) => (log: readonly CommandRecord[], s: SimState) => {
  const prefix = owner(s);
  return !!prefix && effects(log).some((e) => e.verb === 'delete' && e.kind === 'Pod' && !!e.name?.startsWith(`${prefix}-`));
};

export const podRunning = (name: string) => (s: SimState): string | null => {
  const pod = findObject(s, 'Pod', name);
  if (!pod || isDeleting(pod)) return `There is no Pod named ${name} yet. Apply your manifest first.`;
  if (!isPodReady(pod)) return `${name} exists but is not Running and Ready yet (status: ${pod.status.containerStatuses.find((c) => c.reason)?.reason ?? pod.status.stage}).`;
  return null;
};

export const readyPodsMatching = (selector: Record<string, string>, count: number) => (s: SimState): string | null => {
  const pods = objectsOf(s, 'Pod').filter((p) => !isDeleting(p) && Object.entries(selector).every(([k, v]) => p.metadata.labels[k] === v));
  const ready = pods.filter(isPodReady).length;
  return ready >= count ? null : `${ready}/${count} Pods with ${Object.entries(selector).map(([k, v]) => `${k}=${v}`).join(',')} are Ready.`;
};

export const workloadReady = (kind: 'ReplicaSet' | 'Deployment', name: string | ((s: SimState) => string | undefined), replicas: number) => (s: SimState): string | null => {
  const n = typeof name === 'string' ? name : name(s);
  const w = n ? findObject(s, kind, n) : undefined;
  if (!w) return `No ${kind} ${typeof name === 'string' ? name : ''} exists yet.`;
  if (w.spec.replicas !== replicas) return `${kind} ${w.metadata.name} wants ${w.spec.replicas} replicas; the objective is ${replicas}.`;
  return w.status.readyReplicas >= replicas ? null : `${w.status.readyReplicas}/${replicas} of its Pods are Ready…`;
};

export const serviceHasEndpoints = (name: string, min: number) => (s: SimState): string | null => {
  const svc = findObject(s, 'Service', name);
  if (!svc) return `No Service named ${name} yet.`;
  const ready = serviceEndpoints(s, svc).filter((e) => e.ready).length;
  return ready >= min ? null : `Service ${name} has ${ready} ready endpoints. Does its selector match the Pods' labels?`;
};

/** The ReplicaSet or Deployment in the cluster whose name satisfies `pick`, for steps that refer to "your" object. */
export const firstOf = (kind: Kind, pick: (name: string) => boolean = () => true) => (s: SimState) =>
  objectsOf(s, kind).find((o) => pick(o.metadata.name))?.metadata.name;
