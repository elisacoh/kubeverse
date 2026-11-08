/**
 * From YAML text to validated Kubernetes objects, in three distinct layers so
 * the learner always knows what kind of mistake they made:
 * - syntax: the text is not valid YAML;
 * - schema: valid YAML, but not a valid object of that kind (unknown or
 *   missing field, wrong type, rejected value) — what the API server refuses;
 * - objective (in `curriculum/checks.ts`): a valid object, but not the one the
 *   exercise asks for.
 */
import { LineCounter, isMap, isScalar, isSeq, parseAllDocuments, type Document, type Node as YamlNode } from 'yaml';
import { KIND_API_VERSION, KINDS, SCHEMAS, asKind, type SchemaNode, type StringFormat } from './schema';
import { parseCpu, parseMemory } from './quantity';
import type { ContainerSpec, DesiredObject, Kind, Labels, PodSpec, PodTemplate, Probe, ServicePort, VolumeSpec } from './types';

export type IssueLevel = 'syntax' | 'schema' | 'objective';

export interface Issue {
  level: IssueLevel;
  message: string;
  /** 1-based line in the file, when known. */
  line?: number;
  /** Field path, e.g. `spec.containers[0].image`. */
  path?: string;
  /** A friendlier explanation or a way out. */
  hint?: string;
  /**
   * Set when the issue is only something not written yet (a required field or a value
   * the learner has not reached), rather than skipped or wrong: the field it is about.
   */
  pending?: string;
}

export type Path = readonly (string | number)[];

export const formatPath = (path: Path) =>
  path.reduce<string>((s, seg) => (typeof seg === 'number' ? `${s}[${seg}]` : s ? `${s}.${seg}` : seg), '');

// ---------------------------------------------------------------------------
// Syntax
// ---------------------------------------------------------------------------

export interface ParsedDocument {
  /** Plain JS value of the document (null for an empty document). */
  value: unknown;
  /** 1-based line of a path inside this document, if it exists. */
  lineOf: (path: Path, key?: boolean) => number | undefined;
  /** 1-based line where the document starts. */
  startLine: number;
}

export interface ParseResult {
  docs: ParsedDocument[];
  issues: Issue[];
}

const SYNTAX_HINTS: Record<string, string> = {
  TAB_AS_INDENT: 'YAML does not allow tabs for indentation. Use spaces (two per level is the convention).',
  BAD_INDENT: 'Check the indentation: items at the same level must start in the same column, and children are indented more than their parent.',
  MISSING_CHAR: 'A character is missing, often the ":" after a key, or a closing quote or bracket.',
  BLOCK_AS_IMPLICIT_KEY: 'A key seems to be followed by more content on the next lines at the wrong level. Check the ":" and the indentation around this line.',
  DUPLICATE_KEY: 'The same key appears twice in one mapping. Each key may appear only once at a given level.',
  MULTILINE_IMPLICIT_KEY: 'A key cannot span several lines. Did you forget a ":" or indent a line too much?',
  UNEXPECTED_TOKEN: 'Something here does not fit YAML structure. Check for a stray character, a missing ":" or a "-" at the wrong indentation.',
  BAD_SCALAR_START: 'A value cannot start with this character unless it is quoted. Wrap the value in quotes.',
};

const findPairKey = (node: unknown, key: string) => (isMap(node) ? node.items.find((p) => isScalar(p.key) && p.key.value === key) : undefined);

const nodeAt = (doc: Document, path: Path): { node?: YamlNode; keyNode?: YamlNode } => {
  let node: unknown = doc.contents;
  let keyNode: YamlNode | undefined;
  for (const seg of path) {
    if (typeof seg === 'number') {
      if (!isSeq(node)) return {};
      node = node.items[seg];
      keyNode = undefined;
    } else {
      const pair = findPairKey(node, seg);
      if (!pair) return {};
      keyNode = pair.key as YamlNode;
      node = pair.value;
    }
  }
  return { node: (node as YamlNode | undefined) ?? undefined, keyNode };
};

/** Parses one file, possibly holding several `---`-separated documents. */
export const parseYaml = (text: string): ParseResult => {
  const lineCounter = new LineCounter();
  const parsed = parseAllDocuments(text, { lineCounter, prettyErrors: false, uniqueKeys: true });
  const documents = Array.isArray(parsed) ? parsed : [];
  const issues: Issue[] = [];
  const docs: ParsedDocument[] = [];
  const lineAt = (offset: number) => lineCounter.linePos(offset).line;

  for (const doc of documents) {
    for (const err of doc.errors) {
      const line = err.pos ? lineAt(err.pos[0]) : undefined;
      const first = err.message.split('\n')[0] ?? err.message;
      issues.push({
        level: 'syntax',
        message: first.replace(/ at line \d+, column \d+:?$/, ''),
        line,
        hint: SYNTAX_HINTS[err.code],
      });
    }
    if (doc.errors.length) continue;
    const value = doc.toJS({ maxAliasCount: 50 }) as unknown;
    if (value === null || value === undefined) continue;
    docs.push({
      value,
      startLine: doc.range ? lineAt(doc.range[0]) : 1,
      lineOf: (path, key = false) => {
        const { node, keyNode } = nodeAt(doc, path);
        const target = key && keyNode ? keyNode : (node ?? keyNode);
        const range = target?.range;
        return range ? lineAt(range[0]) : undefined;
      },
    });
  }
  return { docs, issues };
};

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const describeValue = (v: unknown) => {
  if (v === null || v === undefined) return 'nothing (null)';
  if (Array.isArray(v)) return 'a list';
  if (isObject(v)) return 'a mapping';
  if (typeof v === 'string') return `the text "${v}"`;
  return `the ${typeof v} ${JSON.stringify(v)}`;
};

const levenshtein = (a: string, b: string) => {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1]!.toLowerCase() === b[j - 1]!.toLowerCase() ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
};

const closest = (key: string, options: string[]) => {
  const scored = options.map((o) => ({ o, d: levenshtein(key, o) })).sort((x, y) => x.d - y.d)[0];
  return scored && scored.d <= Math.max(2, Math.floor(key.length / 3)) ? scored.o : undefined;
};

/** A required field absent from the mapping at the issue's path, with the order fields are usually written in. */
interface Missing {
  field: string;
  order: readonly string[];
}

type Push = (path: Path, message: string, hint?: string, key?: boolean, missing?: Missing) => void;

const FORMAT_CHECKS: Partial<Record<StringFormat, (v: string) => string | null>> = {
  cpu: (v) => (parseCpu(v) === null ? `quantities must match the regular expression for CPU, e.g. "500m" or "1"` : null),
  memory: (v) => (parseMemory(v) === null ? 'quantities must be a number with an optional suffix such as Mi or Gi, e.g. "128Mi"' : null),
  storage: (v) => (parseMemory(v) === null ? 'quantities must be a number with a suffix such as Mi or Gi, e.g. "1Gi"' : null),
};

const walk = (node: SchemaNode, value: unknown, path: Path, push: Push) => {
  switch (node.type) {
    case 'object': {
      if (!isObject(value)) {
        push(path, `expected a mapping (${node.name}), got ${describeValue(value)}`, 'A mapping is a set of `key: value` lines indented under this key.');
        return;
      }
      for (const [k, v] of Object.entries(value)) {
        const field = node.fields[k];
        if (!field) {
          const suggestion = closest(k, Object.keys(node.fields));
          push(
            [...path, k],
            `unknown field "${k}" in ${node.name}`,
            suggestion ? `Did you mean "${suggestion}"?` : `Fields allowed here: ${Object.keys(node.fields).join(', ')}.`,
            true,
          );
          continue;
        }
        walk(field.node, v, [...path, k], push);
      }
      for (const [k, field] of Object.entries(node.fields)) {
        if (field.required && (value[k] === undefined || value[k] === null)) {
          push(path, `missing required field "${k}" in ${node.name}`, field.doc.summary, true, { field: k, order: Object.keys(node.fields) });
        }
      }
      return;
    }
    case 'array':
      if (!Array.isArray(value)) {
        push(path, `expected a list, got ${describeValue(value)}`, 'List items start with "- " on their own lines, indented under the key.');
        return;
      }
      value.forEach((item, i) => walk(node.items, item, [...path, i], push));
      return;
    case 'map':
      if (!isObject(value)) {
        push(path, `expected a mapping of strings, got ${describeValue(value)}`);
        return;
      }
      for (const [k, v] of Object.entries(value)) {
        if (typeof v !== 'string') {
          push([...path, k], `value must be a string, got ${describeValue(v)}`, `Quote it: ${k}: "${String(v)}"`);
        }
      }
      return;
    case 'string':
      if (typeof value !== 'string') {
        push(path, `expected a string, got ${describeValue(value)}`, typeof value === 'number' || typeof value === 'boolean' ? 'Wrap the value in quotes.' : undefined);
        return;
      }
      if (node.enum && !node.enum.includes(value)) {
        push(path, `Unsupported value: "${value}": supported values: ${node.enum.map((e) => `"${e}"`).join(', ')}`);
        return;
      }
      if (node.format) {
        const err = FORMAT_CHECKS[node.format]?.(value);
        if (err) push(path, `Invalid value: "${value}": ${err}`);
      }
      return;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        push(path, `expected an integer, got ${describeValue(value)}`, typeof value === 'string' && /^\d+$/.test(value) ? 'Remove the quotes: numbers are written without them.' : undefined);
        return;
      }
      if (node.min !== undefined && value < node.min) push(path, `Invalid value: ${value}: must be greater than or equal to ${node.min}`);
      if (node.max !== undefined && value > node.max) push(path, `Invalid value: ${value}: must be less than or equal to ${node.max}`);
      return;
    case 'int-or-string':
      if (typeof value !== 'string' && !(typeof value === 'number' && Number.isInteger(value))) {
        push(path, `expected a port number or name, got ${describeValue(value)}`);
      }
      return;
    case 'boolean':
      if (typeof value !== 'boolean') push(path, `expected true or false, got ${describeValue(value)}`);
      return;
    case 'free':
      if (value !== null && !isObject(value)) push(path, `expected a mapping, got ${describeValue(value)}`, 'For an empty mapping, write `{}`.');
  }
};

// ---------------------------------------------------------------------------
// Semantics: what the API server checks beyond the shape
// ---------------------------------------------------------------------------

const DNS_SUBDOMAIN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;
const DNS_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const DNS_1035 = /^[a-z]([-a-z0-9]*[a-z0-9])?$/;
const LABEL_VALUE = /^(([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9])?$/;
const LABEL_NAME = /^([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9]$/;
const ENV_NAME = /^[-._a-zA-Z][-._a-zA-Z0-9]*$/;

const labelKeyError = (key: string): string | null => {
  const parts = key.split('/');
  if (parts.length > 2) return 'a label key may contain at most one "/"';
  const name = parts[parts.length - 1]!;
  if (parts.length === 2 && (!DNS_SUBDOMAIN.test(parts[0]!) || parts[0]!.length > 253)) return 'the prefix before "/" must be a DNS subdomain, e.g. "app.kubernetes.io"';
  if (name.length === 0 || name.length > 63 || !LABEL_NAME.test(name)) {
    return 'name part must consist of alphanumeric characters, "-", "_" or ".", start and end with an alphanumeric character, and be at most 63 characters';
  }
  return null;
};

const checkLabels = (labels: unknown, path: Path, push: Push) => {
  if (!isObject(labels)) return;
  for (const [k, v] of Object.entries(labels)) {
    const keyErr = labelKeyError(k);
    if (keyErr) push([...path, k], `Invalid value: "${k}": ${keyErr}`, undefined, true);
    if (typeof v === 'string' && (v.length > 63 || !LABEL_VALUE.test(v))) {
      push([...path, k], `Invalid value: "${v}": a valid label value must be 63 characters or less, empty or consist of alphanumeric characters, "-", "_" or ".", and start and end with an alphanumeric character`);
    }
  }
};

const portNames = (c: Record<string, unknown>) =>
  Array.isArray(c.ports) ? (c.ports as Record<string, unknown>[]).map((p) => p.name).filter((n): n is string => typeof n === 'string') : [];

const checkProbe = (probe: unknown, c: Record<string, unknown>, path: Path, push: Push) => {
  if (!isObject(probe)) return;
  const handlers = ['httpGet', 'tcpSocket', 'exec'].filter((h) => probe[h] !== undefined);
  if (handlers.length === 0) push(path, 'must specify a handler type', 'Add one of `httpGet`, `tcpSocket` or `exec`.');
  if (handlers.length > 1) push(path, 'may not specify more than 1 handler type');
  for (const h of ['httpGet', 'tcpSocket'] as const) {
    const port = isObject(probe[h]) ? (probe[h] as Record<string, unknown>).port : undefined;
    if (typeof port === 'string' && !/^\d+$/.test(port) && !portNames(c).includes(port)) {
      push([...path, h, 'port'], `Invalid value: "${port}": must be a port number or the name of one of the container's ports`);
    }
  }
};

const checkPodSpec = (spec: unknown, path: Path, push: Push, managed: boolean) => {
  if (!isObject(spec)) return;
  const volumes = Array.isArray(spec.volumes) ? (spec.volumes as unknown[]).filter(isObject) : [];
  const volumeNames = new Set<string>();
  volumes.forEach((v, i) => {
    const name = v.name;
    if (typeof name === 'string') {
      if (volumeNames.has(name)) push([...path, 'volumes', i, 'name'], `Duplicate value: "${name}"`);
      volumeNames.add(name);
    }
    const sources = ['emptyDir', 'configMap', 'persistentVolumeClaim'].filter((s) => s in v);
    if (sources.length === 0) push([...path, 'volumes', i], 'must specify a volume type', 'Add one source: `emptyDir: {}`, `configMap` or `persistentVolumeClaim`.');
    if (sources.length > 1) push([...path, 'volumes', i], 'may not specify more than 1 volume type');
  });

  const containers = Array.isArray(spec.containers) ? (spec.containers as unknown[]) : [];
  if (Array.isArray(spec.containers) && containers.length === 0) push([...path, 'containers'], 'Required value: a Pod needs at least one container');
  const names = new Set<string>();
  containers.forEach((c, i) => {
    if (!isObject(c)) return;
    const cp = [...path, 'containers', i];
    if (typeof c.name === 'string') {
      if (!DNS_LABEL.test(c.name) || c.name.length > 63) {
        push([...cp, 'name'], `Invalid value: "${c.name}": a lowercase RFC 1123 label must consist of lower case alphanumeric characters or "-", and must start and end with an alphanumeric character`);
      }
      if (names.has(c.name)) push([...cp, 'name'], `Duplicate value: "${c.name}"`, 'Container names must be unique within a Pod.');
      names.add(c.name);
    }
    if (typeof c.image === 'string' && c.image.trim() === '') push([...cp, 'image'], 'Required value', 'Give an image such as `nginx:stable`.');

    if (isObject(c.resources)) {
      const req = isObject(c.resources.requests) ? c.resources.requests : {};
      const lim = isObject(c.resources.limits) ? c.resources.limits : {};
      for (const r of ['cpu', 'memory'] as const) {
        const parse = r === 'cpu' ? parseCpu : parseMemory;
        const rq = typeof req[r] === 'string' || typeof req[r] === 'number' ? parse(req[r] as string) : null;
        const lm = typeof lim[r] === 'string' || typeof lim[r] === 'number' ? parse(lim[r] as string) : null;
        if (rq !== null && lm !== null && rq > lm) {
          push([...cp, 'resources', 'requests', r], `Invalid value: "${String(req[r])}": must be less than or equal to ${r} limit of ${String(lim[r])}`);
        }
      }
    }
    if (Array.isArray(c.volumeMounts)) {
      (c.volumeMounts as unknown[]).forEach((m, j) => {
        if (isObject(m) && typeof m.name === 'string' && !volumeNames.has(m.name)) {
          push([...cp, 'volumeMounts', j, 'name'], `Not found: "${m.name}"`, `Declare a volume named "${m.name}" under the Pod's \`spec.volumes\`.`);
        }
      });
    }
    if (Array.isArray(c.env)) {
      (c.env as unknown[]).forEach((e, j) => {
        if (!isObject(e)) return;
        if (typeof e.name === 'string' && !ENV_NAME.test(e.name)) push([...cp, 'env', j, 'name'], `Invalid value: "${e.name}": a valid environment variable name must consist of alphabetic characters, digits, "_", "-", or "."`);
        if (e.value !== undefined && e.valueFrom !== undefined) push([...cp, 'env', j, 'valueFrom'], 'may not be specified when `value` is not empty');
        if (e.valueFrom !== undefined && isObject(e.valueFrom) && !e.valueFrom.configMapKeyRef) push([...cp, 'env', j, 'valueFrom'], 'must specify one of: `configMapKeyRef`');
      });
    }
    checkProbe(c.readinessProbe, c, [...cp, 'readinessProbe'], push);
    checkProbe(c.livenessProbe, c, [...cp, 'livenessProbe'], push);
  });
  if (managed && spec.restartPolicy !== undefined && spec.restartPolicy !== 'Always') {
    push([...path, 'restartPolicy'], `Unsupported value: "${String(spec.restartPolicy)}": supported values: "Always"`);
  }
};

const checkName = (kind: Kind, meta: Record<string, unknown>, push: Push) => {
  const name = meta.name;
  if (typeof name !== 'string') return;
  if (kind === 'Service') {
    if (!DNS_1035.test(name) || name.length > 63) {
      push(['metadata', 'name'], `Invalid value: "${name}": a DNS-1035 label must consist of lower case alphanumeric characters or "-", start with an alphabetic character, and end with an alphanumeric character`);
    }
  } else if (!DNS_SUBDOMAIN.test(name) || name.length > 253) {
    push(['metadata', 'name'], `Invalid value: "${name}": a lowercase RFC 1123 subdomain must consist of lower case alphanumeric characters, "-" or ".", and must start and end with an alphanumeric character`, 'Use lowercase letters, digits and "-", e.g. `hello-pod`.');
  }
};

const checkSemantics = (kind: Kind, value: Record<string, unknown>, push: Push) => {
  const meta = isObject(value.metadata) ? value.metadata : {};
  checkName(kind, meta, push);
  if (meta.namespace !== undefined && meta.namespace !== 'default') {
    push(['metadata', 'namespace'], `namespaces "${String(meta.namespace)}" not found`, 'The Playground cluster has one namespace for your objects: `default`. Remove the field or set it to `default`.');
  }
  checkLabels(meta.labels, ['metadata', 'labels'], push);
  const spec = isObject(value.spec) ? value.spec : {};

  if (kind === 'Pod') checkPodSpec(value.spec, ['spec'], push, false);

  if (kind === 'ReplicaSet' || kind === 'Deployment') {
    const selector = isObject(spec.selector) && isObject(spec.selector.matchLabels) ? (spec.selector.matchLabels as Record<string, unknown>) : null;
    const template = isObject(spec.template) ? spec.template : {};
    const tmeta = isObject(template.metadata) ? template.metadata : {};
    const tlabels = isObject(tmeta.labels) ? (tmeta.labels as Record<string, unknown>) : {};
    checkLabels(selector, ['spec', 'selector', 'matchLabels'], push);
    checkLabels(tmeta.labels, ['spec', 'template', 'metadata', 'labels'], push);
    if (selector && Object.keys(selector).length === 0) {
      push(['spec', 'selector'], 'Invalid value: empty selector is invalid for deployment', 'Add at least one label under `matchLabels`.');
    } else if (selector && Object.entries(selector).some(([k, v]) => tlabels[k] !== v)) {
      push(
        ['spec', 'template', 'metadata', 'labels'],
        `Invalid value: ${JSON.stringify(tlabels)}: \`selector\` does not match template \`labels\``,
        `Every label in \`spec.selector.matchLabels\` (${Object.entries(selector).map(([k, v]) => `${k}: ${String(v)}`).join(', ')}) must also appear in \`spec.template.metadata.labels\`. Otherwise the ${kind} could never find the Pods it creates.`,
      );
    }
    checkPodSpec(template.spec, ['spec', 'template', 'spec'], push, true);
  }

  if (kind === 'Service') {
    checkLabels(spec.selector, ['spec', 'selector'], push);
    const ports = Array.isArray(spec.ports) ? (spec.ports as unknown[]).filter(isObject) : [];
    if (Array.isArray(spec.ports) && ports.length === 0) push(['spec', 'ports'], 'Required value: at least one port');
    if (ports.length > 1) ports.forEach((p, i) => p.name === undefined && push(['spec', 'ports', i, 'name'], 'Required value: names are required when there is more than one port'));
    ports.forEach((p, i) => {
      if (typeof p.targetPort === 'number' && (p.targetPort < 1 || p.targetPort > 65535)) push(['spec', 'ports', i, 'targetPort'], `Invalid value: ${p.targetPort}: must be between 1 and 65535`);
      if (p.nodePort !== undefined && spec.type !== 'NodePort' && spec.type !== 'LoadBalancer') {
        push(['spec', 'ports', i, 'nodePort'], 'Forbidden: may not be used when `type` is \'ClusterIP\'');
      }
    });
  }

  if (kind === 'ConfigMap' && isObject(value.data)) {
    for (const k of Object.keys(value.data)) {
      if (!/^[-._a-zA-Z0-9]+$/.test(k)) push(['data', k], `Invalid value: "${k}": a valid config key must consist of alphanumeric characters, "-", "_" or "."`, undefined, true);
    }
  }
};

/** Validates one parsed document as a Kubernetes object. Returns schema-level issues only. */
const valueAtPath = (v: unknown, path: Path): unknown =>
  path.reduce<unknown>((cur, seg) => (cur !== null && typeof cur === 'object' ? (cur as Record<string | number, unknown>)[seg] : undefined), v);

/** The last line the value at `path` spans. */
export const lastLine = (v: unknown, path: Path, lineOf: ParsedDocument['lineOf']): number => {
  let max = lineOf(path, true) ?? lineOf(path) ?? 0;
  if (Array.isArray(v)) v.forEach((item, i) => (max = Math.max(max, lastLine(item, [...path, i], lineOf))));
  else if (isObject(v)) for (const [k, item] of Object.entries(v)) max = Math.max(max, lastLine(item, [...path, k], lineOf));
  return max;
};

const TOP_LEVEL_ORDER = ['apiVersion', 'kind', 'metadata', 'spec', 'data'];

/**
 * Written top to bottom, a manifest lacks its later fields for a while. A missing field is only
 * skipped when a field that comes after it is already there, or content follows its mapping;
 * an empty value only when content follows it.
 */
const notReachedYet = (value: unknown, path: Path, missing: Missing | undefined, lineOf: ParsedDocument['lineOf'], last: number): string | undefined => {
  if (missing) {
    const parent = valueAtPath(value, path);
    if (!isObject(parent)) return undefined;
    const later = missing.order.slice(missing.order.indexOf(missing.field) + 1);
    if (later.some((k) => parent[k] !== undefined)) return undefined;
    if (path.length > 0 && lastLine(parent, path, lineOf) < last) return undefined;
    return formatPath([...path, missing.field]);
  }
  if (path.length > 0 && valueAtPath(value, path) === null && (lineOf(path, true) ?? 0) >= last) return formatPath(path);
  return undefined;
};

export const validateObject = (value: unknown, lineOf?: ParsedDocument['lineOf']): { kind: Kind | null; issues: Issue[] } => {
  const issues: Issue[] = [];
  const raw: { path: Path; missing?: Missing }[] = [];
  const push: Push = (path, message, hint, key, missing) => {
    const p = formatPath(path);
    issues.push({ level: 'schema', message: p ? `${p}: ${message}` : message, path: p, line: lineOf?.(path, key), hint });
    raw.push({ path, missing });
  };
  const done = (kind: Kind | null) => {
    if (lineOf) {
      const last = lastLine(value, [], lineOf);
      issues.forEach((issue, i) => {
        const pending = notReachedYet(value, raw[i]!.path, raw[i]!.missing, lineOf, last);
        if (pending) issue.pending = pending;
      });
    }
    return { kind, issues };
  };
  if (!isObject(value)) {
    push([], `a Kubernetes manifest must be a mapping, got ${describeValue(value)}`, 'Start with `apiVersion:` and `kind:` at the beginning of the line.');
    return done(null);
  }
  if (value.apiVersion === undefined) push([], 'apiVersion not set', 'Every manifest starts with `apiVersion`, e.g. `apiVersion: v1` for a Pod.', true, { field: 'apiVersion', order: TOP_LEVEL_ORDER });
  if (value.kind === undefined) push([], 'kind not set', 'Every manifest needs `kind`, e.g. `kind: Pod`.', true, { field: 'kind', order: TOP_LEVEL_ORDER });
  if (issues.length) return done(null);

  const kind = asKind(value.kind);
  if (!kind) {
    push(['kind'], `no matches for kind "${String(value.kind)}" in version "${String(value.apiVersion)}"`, `The Playground supports: ${KINDS.join(', ')}. Kind names are case-sensitive.`);
    return done(null);
  }
  if (value.apiVersion !== KIND_API_VERSION[kind]) {
    push(['apiVersion'], `no matches for kind "${kind}" in version "${String(value.apiVersion)}"`, `A ${kind} uses \`apiVersion: ${KIND_API_VERSION[kind]}\`.`);
  }
  walk(SCHEMAS[kind], value, [], push);
  if (issues.length === 0) checkSemantics(kind, value, push);
  return done(kind);
};

// ---------------------------------------------------------------------------
// To the typed desired object (only for documents that validated)
// ---------------------------------------------------------------------------

const labelsOf = (v: unknown): Labels => (isObject(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, String(x)])) : {});

const clean = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const toProbe = (p: unknown): Probe | undefined => (isObject(p) ? clean(p as Probe) : undefined);

const toContainer = (c: Record<string, unknown>): ContainerSpec => {
  const out: ContainerSpec = { name: String(c.name), image: String(c.image) };
  if (Array.isArray(c.command)) out.command = c.command.map(String);
  if (Array.isArray(c.args)) out.args = c.args.map(String);
  if (Array.isArray(c.ports)) out.ports = clean(c.ports) as ContainerSpec['ports'];
  if (Array.isArray(c.env)) out.env = clean(c.env) as ContainerSpec['env'];
  if (Array.isArray(c.envFrom)) out.envFrom = clean(c.envFrom) as ContainerSpec['envFrom'];
  if (isObject(c.resources)) {
    const r = c.resources;
    const list = (v: unknown) => (isObject(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, String(x)])) : undefined);
    out.resources = { ...(r.requests ? { requests: list(r.requests) } : {}), ...(r.limits ? { limits: list(r.limits) } : {}) };
  }
  const readiness = toProbe(c.readinessProbe);
  const liveness = toProbe(c.livenessProbe);
  if (readiness) out.readinessProbe = readiness;
  if (liveness) out.livenessProbe = liveness;
  if (Array.isArray(c.volumeMounts)) out.volumeMounts = clean(c.volumeMounts) as ContainerSpec['volumeMounts'];
  return out;
};

const toPodSpec = (s: Record<string, unknown>): PodSpec => {
  const out: PodSpec = { containers: (s.containers as Record<string, unknown>[]).map(toContainer) };
  if (Array.isArray(s.volumes)) out.volumes = (s.volumes as Record<string, unknown>[]).map((v) => clean({ ...v, ...(v.emptyDir === null ? { emptyDir: {} } : {}) }) as VolumeSpec);
  if (typeof s.restartPolicy === 'string') out.restartPolicy = s.restartPolicy as PodSpec['restartPolicy'];
  return out;
};

const toTemplate = (t: Record<string, unknown>): PodTemplate => {
  const meta = t.metadata as Record<string, unknown>;
  return {
    metadata: { labels: labelsOf(meta.labels), ...(meta.annotations ? { annotations: labelsOf(meta.annotations) } : {}) },
    spec: toPodSpec(t.spec as Record<string, unknown>),
  };
};

/** The typed object a valid manifest describes, with API defaults applied. */
export const toDesired = (value: Record<string, unknown>): DesiredObject => {
  const meta = value.metadata as Record<string, unknown>;
  const metadata = {
    name: String(meta.name),
    namespace: typeof meta.namespace === 'string' ? meta.namespace : 'default',
    labels: labelsOf(meta.labels),
    annotations: labelsOf(meta.annotations),
  };
  const spec = (value.spec ?? {}) as Record<string, unknown>;
  const kind = value.kind as Kind;
  switch (kind) {
    case 'Pod':
      return { kind, apiVersion: 'v1', metadata, spec: toPodSpec(spec) };
    case 'ReplicaSet':
    case 'Deployment': {
      const base = {
        replicas: typeof spec.replicas === 'number' ? spec.replicas : 1,
        selector: { matchLabels: labelsOf((spec.selector as Record<string, unknown>).matchLabels) },
        template: toTemplate(spec.template as Record<string, unknown>),
      };
      if (kind === 'ReplicaSet') return { kind, apiVersion: 'apps/v1', metadata, spec: base };
      const strategy = isObject(spec.strategy) && spec.strategy.type === 'Recreate' ? 'Recreate' : 'RollingUpdate';
      return { kind, apiVersion: 'apps/v1', metadata, spec: { ...base, strategy: { type: strategy } } };
    }
    case 'Service': {
      const ports: ServicePort[] = (spec.ports as Record<string, unknown>[]).map((p) => ({
        ...(typeof p.name === 'string' ? { name: p.name } : {}),
        protocol: (p.protocol as ServicePort['protocol']) ?? 'TCP',
        port: p.port as number,
        targetPort: (p.targetPort as number | string | undefined) ?? (p.port as number),
        ...(typeof p.nodePort === 'number' ? { nodePort: p.nodePort } : {}),
      }));
      return {
        kind,
        apiVersion: 'v1',
        metadata,
        spec: {
          type: (spec.type as 'ClusterIP' | 'NodePort' | 'LoadBalancer') ?? 'ClusterIP',
          ...(spec.selector ? { selector: labelsOf(spec.selector) } : {}),
          ports,
        },
      };
    }
    case 'ConfigMap':
      return { kind, apiVersion: 'v1', metadata, data: labelsOf(value.data) };
    case 'PersistentVolumeClaim': {
      const resources = spec.resources as { requests: { storage: unknown } };
      return {
        kind,
        apiVersion: 'v1',
        metadata,
        spec: {
          accessModes: (spec.accessModes as string[]).map(String),
          resources: { requests: { storage: String(resources.requests.storage) } },
          storageClassName: typeof spec.storageClassName === 'string' ? spec.storageClassName : 'standard',
        },
      };
    }
  }
};

export interface ManifestResult {
  /** Valid objects, in document order. */
  objects: { desired: DesiredObject; line: number }[];
  issues: Issue[];
}

/** Everything `kubectl apply -f` needs from a file: parse, validate each document, build the objects. */
export const readManifests = (text: string): ManifestResult => {
  const { docs, issues } = parseYaml(text);
  if (issues.length) return { objects: [], issues };
  const objects: ManifestResult['objects'] = [];
  const all: Issue[] = [];
  for (const doc of docs) {
    const { issues: docIssues } = validateObject(doc.value, doc.lineOf);
    if (docIssues.length) all.push(...docIssues);
    else objects.push({ desired: toDesired(doc.value as Record<string, unknown>), line: doc.startLine });
  }
  if (docs.length === 0) all.push({ level: 'schema', message: 'no objects passed to apply', hint: 'The file is empty. Write a manifest first.' });
  return { objects: all.length ? [] : objects, issues: all };
};
