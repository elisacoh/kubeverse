/**
 * A simulated shell with the kubectl subset the lessons use. Every answer is
 * computed from the cluster state behind `ClusterApi` and from the workspace
 * files; nothing is a canned success message.
 */
import { readManifests, type Issue } from '../sim/manifest';
import { containerEnv, controllerOf, findObject, isDeleting, matchesSelector, objectsOf, ownerChain, probeFailure, resourceName, serviceEndpoints, type ApplyAction } from '../sim/cluster';
import { describeType, explainPath, kindFromResource, type SchemaNode } from '../sim/schema';
import type { ClusterApi } from '../sim/backend';
import type { DesiredObject, KObject, Kind, PodObject, Probe, SimState } from '../sim/types';
import { isoAt } from '../sim/toCluster';
import {
  ACCESS_MODE_SHORT,
  ageOf,
  endpointsText,
  humanAge,
  labelsText,
  ownerText,
  podReady,
  podRestarts,
  podStatus,
  servicePorts,
  table,
  toApiObject,
  toYaml,
} from './format';

export type Tone = 'error' | 'success' | 'muted' | 'hint' | 'warn';

export interface OutputLine {
  text: string;
  tone?: Tone;
}

/** What a command did, in a form lessons can check without parsing text. */
export interface Effect {
  verb: string;
  kind?: Kind;
  /** For get: every resource type listed ("pods", "all"…), normalised to kinds or pseudo-types. */
  resources?: string[];
  name?: string;
  file?: string;
  action?: ApplyAction | 'deleted';
  output?: string;
  selector?: string;
  showLabels?: boolean;
}

export interface CommandResult {
  ok: boolean;
  lines: OutputLine[];
  effects: Effect[];
  clear?: boolean;
}

export interface ShellContext {
  api: ClusterApi;
  files: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export const tokenize = (input: string): string[] => {
  const tokens: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let started = false;
  for (const ch of input) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started || cur) tokens.push(cur);
      cur = '';
      started = false;
    } else {
      cur += ch;
    }
  }
  if (started || cur) tokens.push(cur);
  return tokens;
};

const VALUE_FLAGS: Record<string, string> = {
  '-f': 'filename',
  '--filename': 'filename',
  '-o': 'output',
  '--output': 'output',
  '-n': 'namespace',
  '--namespace': 'namespace',
  '-l': 'selector',
  '--selector': 'selector',
  '-c': 'container',
  '--container': 'container',
  '--replicas': 'replicas',
  '--tail': 'tail',
};

const BOOL_FLAGS: Record<string, string> = {
  '-A': 'all-namespaces',
  '--all-namespaces': 'all-namespaces',
  '--show-labels': 'show-labels',
  '--all': 'all',
  '-w': 'watch',
  '--watch': 'watch',
  '-h': 'help',
  '--help': 'help',
  '-it': 'interactive',
  '-i': 'interactive',
  '-t': 'interactive',
};

interface Parsed {
  args: string[];
  flags: Record<string, string[]>;
  bools: Set<string>;
  /** After `--` (exec). */
  rest: string[];
  unknown: string[];
}

const parseArgs = (tokens: string[]): Parsed => {
  const p: Parsed = { args: [], flags: {}, bools: new Set(), rest: [], unknown: [] };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t === '--') {
      p.rest = tokens.slice(i + 1);
      break;
    }
    if (!t.startsWith('-') || t === '-') {
      p.args.push(t);
      continue;
    }
    const eq = t.indexOf('=');
    const name = eq > 0 ? t.slice(0, eq) : t;
    if (VALUE_FLAGS[name]) {
      const value = eq > 0 ? t.slice(eq + 1) : tokens[++i];
      if (value !== undefined) (p.flags[VALUE_FLAGS[name]!] ??= []).push(value);
      continue;
    }
    if (/^-o\w/.test(t)) {
      (p.flags.output ??= []).push(t.slice(2));
      continue;
    }
    if (/^-n\S/.test(t)) {
      (p.flags.namespace ??= []).push(t.slice(2));
      continue;
    }
    if (BOOL_FLAGS[name]) {
      p.bools.add(BOOL_FLAGS[name]!);
      continue;
    }
    p.unknown.push(name);
  }
  return p;
};

// ---------------------------------------------------------------------------
// Resource types
// ---------------------------------------------------------------------------

type Pseudo = 'Node' | 'Namespace' | 'Event' | 'Endpoints' | 'PersistentVolume';
type ResourceType = Kind | Pseudo;

const PSEUDO: Record<string, Pseudo> = {
  node: 'Node',
  nodes: 'Node',
  no: 'Node',
  namespace: 'Namespace',
  namespaces: 'Namespace',
  ns: 'Namespace',
  event: 'Event',
  events: 'Event',
  ev: 'Event',
  endpoints: 'Endpoints',
  ep: 'Endpoints',
  persistentvolume: 'PersistentVolume',
  persistentvolumes: 'PersistentVolume',
  pv: 'PersistentVolume',
};

const resourceType = (r: string): ResourceType | null => {
  const base = r.toLowerCase().replace(/\.apps$/, '').replace(/\.v1$/, '');
  return kindFromResource(base) ?? PSEUDO[base] ?? null;
};

const unknownResource = (r: string): CommandResult =>
  fail([`error: the server doesn't have a resource type "${r}"`], 'Supported: pods, deployments, replicasets, services, configmaps, pvc, pv, nodes, namespaces, endpoints, events, all.');

const KIND_LABEL: Record<ResourceType, string> = {
  Pod: 'pod',
  ReplicaSet: 'replicaset.apps',
  Deployment: 'deployment.apps',
  Service: 'service',
  ConfigMap: 'configmap',
  PersistentVolumeClaim: 'persistentvolumeclaim',
  Node: 'node',
  Namespace: 'namespace',
  Event: 'event',
  Endpoints: 'endpoints',
  PersistentVolume: 'persistentvolume',
};

const PLURAL_LABEL: Record<ResourceType, string> = {
  Pod: 'pods',
  ReplicaSet: 'replicasets.apps',
  Deployment: 'deployments.apps',
  Service: 'services',
  ConfigMap: 'configmaps',
  PersistentVolumeClaim: 'persistentvolumeclaims',
  Node: 'nodes',
  Namespace: 'namespaces',
  Event: 'events',
  Endpoints: 'endpoints',
  PersistentVolume: 'persistentvolumes',
};

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

const out = (lines: (string | OutputLine)[], effects: Effect[] = [], ok = true): CommandResult => ({
  ok,
  lines: lines.map((l) => (typeof l === 'string' ? { text: l } : l)),
  effects,
});

const fail = (errors: string[], hint?: string, effects: Effect[] = []): CommandResult =>
  out([...errors.map((text) => ({ text, tone: 'error' as const })), ...(hint ? [{ text: `hint: ${hint}`, tone: 'hint' as const }] : [])], effects, false);

const issueLines = (file: string, issues: Issue[]): OutputLine[] => {
  const syntax = issues.some((i) => i.level === 'syntax');
  const lines: OutputLine[] = [
    {
      text: syntax
        ? `error: error parsing ${file}: the file is not valid YAML`
        : `error: error validating "${file}": the manifest was rejected by the API server`,
      tone: 'error',
    },
  ];
  for (const i of issues) {
    lines.push({ text: `  ${i.line ? `line ${i.line}: ` : ''}${i.message}`, tone: 'error' });
    if (i.hint) lines.push({ text: `    hint: ${i.hint}`, tone: 'hint' });
  }
  return lines;
};

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const HELP = [
  'KubeVerse Playground shell. The cluster is simulated in your browser.',
  '',
  'Workspace:',
  '  ls                         list your manifest files',
  '  cat <file>                 print a file',
  '  clear                      clear the terminal',
  '',
  'kubectl:',
  '  kubectl apply -f <file>            create or update the objects in a file',
  '  kubectl create -f <file>           create them (fails if they exist)',
  '  kubectl get <type> [name]          list objects (pods, deploy, rs, svc, cm, pvc, pv, nodes, all…)',
  '      -o wide | yaml | name, --show-labels, -l key=value',
  '  kubectl describe <type> <name>     details and events of one object',
  '  kubectl delete -f <file>           delete the objects in a file',
  '  kubectl delete <type> <name>       delete one object',
  '  kubectl scale deployment <name> --replicas=N',
  '  kubectl logs <pod>                 (simulated) container logs',
  '  kubectl exec <pod> -- env          environment seen inside the container',
  '  kubectl explain <type.field>       documentation of a field, e.g. pod.spec.containers',
  '',
  'Use ↑/↓ for history and Tab to complete.',
];

const NOT_SUPPORTED = ['edit', 'patch', 'port-forward', 'proxy', 'cp', 'attach', 'run', 'expose', 'set', 'rollout', 'label', 'annotate', 'top', 'auth', 'config', 'cordon', 'drain', 'taint', 'autoscale', 'debug', 'diff', 'replace', 'wait', 'kustomize'];

const fileArg = (p: Parsed, verb: string): { files?: string[]; error?: CommandResult } => {
  const files = p.flags.filename;
  if (!files?.length) {
    return { error: fail([`error: must specify one of -f and -k`], `Try: kubectl ${verb} -f pod.yaml`) };
  }
  return { files: files.flatMap((f) => f.split(',')).map((f) => f.replace(/^\.\//, '')) };
};

const missingFile = (file: string, ctx: ShellContext) =>
  fail([`error: the path "${file}" does not exist`], Object.keys(ctx.files).length ? `Files in your workspace: ${Object.keys(ctx.files).join(', ')}` : 'Create a file in the editor first.');

const apply = async (p: Parsed, ctx: ShellContext, verb: 'apply' | 'create'): Promise<CommandResult> => {
  const { files, error } = fileArg(p, verb);
  if (error) return error;
  const lines: OutputLine[] = [];
  const effects: Effect[] = [];
  let ok = true;
  for (const file of files!) {
    const text = ctx.files[file];
    if (text === undefined) return missingFile(file, ctx);
    const { objects, issues } = readManifests(text);
    if (issues.length) {
      lines.push(...issueLines(file, issues));
      effects.push({ verb, file });
      ok = false;
      continue;
    }
    for (const { desired } of objects) {
      if (verb === 'create' && findObject(ctx.api.snapshot(), desired.kind, desired.metadata.name, desired.metadata.namespace)) {
        lines.push({ text: `Error from server (AlreadyExists): error when creating "${file}": ${PLURAL_LABEL[desired.kind]} "${desired.metadata.name}" already exists`, tone: 'error' });
        lines.push({ text: 'hint: `kubectl apply` updates objects that already exist; `create` only creates.', tone: 'hint' });
        ok = false;
        continue;
      }
      const r = await ctx.api.apply(desired);
      if (r.ok) {
        lines.push({ text: `${resourceName(desired.kind)}/${desired.metadata.name} ${r.action}`, tone: r.action === 'unchanged' ? undefined : 'success' });
        effects.push({ verb, file, kind: desired.kind, name: desired.metadata.name, action: r.action });
      } else {
        lines.push({ text: `Error from server: error when applying "${file}": ${r.error}`, tone: 'error' });
        if (r.hint) lines.push({ text: `hint: ${r.hint}`, tone: 'hint' });
        effects.push({ verb, file, kind: desired.kind, name: desired.metadata.name });
        ok = false;
      }
    }
  }
  return { ok, lines, effects };
};

/** Splits `pods`, `pods hello`, `pod/hello`, `pods,svc` into types and names. */
const targets = (args: string[]): { types: string[]; names: string[]; pairs: { type: string; name: string }[] } => {
  if (args.length === 0) return { types: [], names: [], pairs: [] };
  if (args.every((a) => a.includes('/'))) {
    const pairs = args.map((a) => {
      const [type, ...rest] = a.split('/');
      return { type: type!, name: rest.join('/') };
    });
    return { types: [...new Set(pairs.map((x) => x.type))], names: pairs.map((x) => x.name), pairs };
  }
  const [first, ...names] = args;
  return { types: first!.split(','), names, pairs: [] };
};

const namespaceOf = (p: Parsed) => p.flags.namespace?.[p.flags.namespace.length - 1] ?? 'default';

const filterSelector = (objs: KObject[], selector: string | undefined): KObject[] | string => {
  if (!selector) return objs;
  const required: Record<string, string> = {};
  for (const part of selector.split(',')) {
    const m = /^([^=!]+)==?(.*)$/.exec(part.trim());
    if (!m) return `error: unable to parse requirement: "${part}": only key=value selectors are supported here`;
    required[m[1]!.trim()] = m[2]!.trim();
  }
  return objs.filter((o) => matchesSelector(o.metadata.labels, required));
};

const KUBERNETES_SERVICE_AGE = 3600 * 24 * 12;

interface Grid {
  header: string[];
  rows: string[][];
}
const grid = (header: string[], rows: string[][]): Grid => ({ header, rows });

const getRows = (s: SimState, type: ResourceType, objs: KObject[], wide: boolean, showLabels: boolean, prefix: boolean, allNs: boolean): Grid => {
  const name = (o: KObject) => (prefix ? `${KIND_LABEL[type]}/${o.metadata.name}` : o.metadata.name);
  const ns = (o: KObject) => (allNs ? [o.metadata.namespace] : []);
  const nsHead = allNs ? ['NAMESPACE'] : [];
  const lbl = (o: KObject) => (showLabels ? [labelsText(o.metadata.labels)] : []);
  const lblHead = showLabels ? ['LABELS'] : [];
  switch (type) {
    case 'Pod':
      return grid(
        [...nsHead, 'NAME', 'READY', 'STATUS', 'RESTARTS', 'AGE', ...(wide ? ['IP', 'NODE', 'NOMINATED NODE', 'READINESS GATES'] : []), ...lblHead],
        (objs as PodObject[]).map((p) => [
          ...ns(p),
          name(p),
          podReady(p),
          podStatus(p),
          String(podRestarts(p)),
          ageOf(s, p),
          ...(wide ? [p.status.podIP ?? '<none>', p.status.nodeName ?? '<none>', '<none>', '<none>'] : []),
          ...lbl(p),
        ]),
      );
    case 'Deployment':
      return grid(
        [...nsHead, 'NAME', 'READY', 'UP-TO-DATE', 'AVAILABLE', 'AGE', ...(wide ? ['CONTAINERS', 'IMAGES', 'SELECTOR'] : []), ...lblHead],
        objs.map((o) => {
          const d = o as Extract<KObject, { kind: 'Deployment' }>;
          return [
            ...ns(d),
            name(d),
            `${d.status.readyReplicas}/${d.spec.replicas}`,
            String(d.status.updatedReplicas),
            String(d.status.availableReplicas),
            ageOf(s, d),
            ...(wide ? [d.spec.template.spec.containers.map((c) => c.name).join(','), d.spec.template.spec.containers.map((c) => c.image).join(','), labelsText(d.spec.selector.matchLabels)] : []),
            ...lbl(d),
          ];
        }),
      );
    case 'ReplicaSet':
      return grid(
        [...nsHead, 'NAME', 'DESIRED', 'CURRENT', 'READY', 'AGE', ...(wide ? ['CONTAINERS', 'IMAGES', 'SELECTOR'] : []), ...lblHead],
        objs.map((o) => {
          const r = o as Extract<KObject, { kind: 'ReplicaSet' }>;
          return [
            ...ns(r),
            name(r),
            String(r.spec.replicas),
            String(r.status.replicas),
            String(r.status.readyReplicas),
            ageOf(s, r),
            ...(wide ? [r.spec.template.spec.containers.map((c) => c.name).join(','), r.spec.template.spec.containers.map((c) => c.image).join(','), labelsText(r.spec.selector.matchLabels)] : []),
            ...lbl(r),
          ];
        }),
      );
    case 'Service': {
      const rows = objs.map((o) => {
        const v = o as Extract<KObject, { kind: 'Service' }>;
        return [
          ...ns(v),
          name(v),
          v.spec.type,
          v.spec.clusterIP,
          v.spec.type === 'LoadBalancer' ? '<pending>' : '<none>',
          servicePorts(v),
          ageOf(s, v),
          ...(wide ? [v.spec.selector ? labelsText(v.spec.selector) : '<none>'] : []),
          ...lbl(v),
        ];
      });
      return grid([...nsHead, 'NAME', 'TYPE', 'CLUSTER-IP', 'EXTERNAL-IP', 'PORT(S)', 'AGE', ...(wide ? ['SELECTOR'] : []), ...lblHead], rows);
    }
    case 'ConfigMap':
      return grid(
        [...nsHead, 'NAME', 'DATA', 'AGE', ...lblHead],
        objs.map((o) => [...ns(o), name(o), String(Object.keys((o as Extract<KObject, { kind: 'ConfigMap' }>).data).length), ageOf(s, o), ...lbl(o)]),
      );
    case 'PersistentVolumeClaim':
      return grid(
        [...nsHead, 'NAME', 'STATUS', 'VOLUME', 'CAPACITY', 'ACCESS MODES', 'STORAGECLASS', 'VOLUMEATTRIBUTESCLASS', 'AGE', ...lblHead],
        objs.map((o) => {
          const c = o as Extract<KObject, { kind: 'PersistentVolumeClaim' }>;
          const bound = c.status.phase === 'Bound';
          return [
            ...ns(c),
            name(c),
            c.status.phase,
            bound ? (c.spec.volumeName ?? '') : '',
            bound ? (c.status.capacity ?? '') : '',
            bound ? c.spec.accessModes.map((m) => ACCESS_MODE_SHORT[m] ?? m).join(',') : '',
            c.spec.storageClassName,
            '<unset>',
            ageOf(s, c),
            ...lbl(c),
          ];
        }),
      );
    default:
      return grid([], []);
  }
};

const listOf = (s: SimState, type: Kind, namespace: string | null): KObject[] =>
  objectsOf(s, type).filter((o) => namespace === null || o.metadata.namespace === namespace);

const get = (p: Parsed, ctx: ShellContext): CommandResult => {
  const s = ctx.api.snapshot();
  const { types, names, pairs } = targets(p.args);
  if (types.length === 0) {
    return fail(
      ['You must specify the type of resource to get. Use "kubectl api-resources" for a complete list of supported resources.'],
      'Try: kubectl get pods',
    );
  }
  if (p.bools.has('watch')) return fail(['error: --watch is not supported in the Playground terminal.'], 'Run the command again to see the latest state; the cluster view updates live.');
  const output = p.flags.output?.[0];
  if (output && !['wide', 'yaml', 'json', 'name'].includes(output)) return fail([`error: unable to match a printer suitable for the output format "${output}", allowed formats are: json,name,wide,yaml`]);
  const allNs = p.bools.has('all-namespaces');
  const namespace = allNs ? null : namespaceOf(p);
  const showLabels = p.bools.has('show-labels');
  const selector = p.flags.selector?.[0];
  const wide = output === 'wide';

  const expanded: string[] = types.flatMap((t) => (t.toLowerCase() === 'all' ? ['pods', 'services', 'deployments', 'replicasets'] : [t]));
  const resolved: ResourceType[] = [];
  for (const t of expanded) {
    const r = resourceType(t);
    if (!r) return unknownResource(t);
    resolved.push(r);
  }
  const effect: Effect = { verb: 'get', resources: types.some((t) => t.toLowerCase() === 'all') ? ['all', ...resolved] : resolved, output, selector, showLabels };
  if (names.length === 1 && pairs.length === 0) effect.name = names[0];
  if (pairs.length === 1) effect.name = pairs[0]!.name;
  if (resolved.length === 1) effect.kind = resolved[0] as Kind;

  const sections: string[][] = [];
  const errors: string[] = [];
  const found: KObject[] = [];
  const multi = resolved.length > 1;

  for (const type of [...new Set(resolved)]) {
    const wanted = pairs.length ? pairs.filter((x) => resourceType(x.type) === type).map((x) => x.name) : names;
    if (type === 'Node') {
      const nodes = s.nodes.filter((n) => wanted.length === 0 || wanted.includes(n.name));
      wanted.filter((w) => !s.nodes.some((n) => n.name === w)).forEach((w) => errors.push(`Error from server (NotFound): nodes "${w}" not found`));
      if (nodes.length) {
        sections.push(
          table(
            ['NAME', 'STATUS', 'ROLES', 'AGE', 'VERSION', ...(wide ? ['INTERNAL-IP', 'OS-IMAGE', 'CONTAINER-RUNTIME'] : [])],
            nodes.map((n) => [n.name, 'Ready', n.role === 'control-plane' ? 'control-plane' : '<none>', '12d', 'v1.34.1', ...(wide ? [n.internalIP, 'KubeVerse Playground', 'simulated'] : [])]),
          ),
        );
      }
      continue;
    }
    if (type === 'Namespace') {
      sections.push(table(['NAME', 'STATUS', 'AGE'], ['default', 'kube-node-lease', 'kube-public', 'kube-system'].map((n) => [n, 'Active', '12d'])));
      continue;
    }
    if (type === 'Event') {
      const events = s.events.filter((e) => namespace === null || e.object.namespace === namespace).slice(-40);
      if (events.length) {
        sections.push(
          table(
            ['LAST SEEN', 'TYPE', 'REASON', 'OBJECT', 'MESSAGE'],
            events.map((e) => [humanAge(s.time - e.time), e.type, e.reason, `${KIND_LABEL[e.object.kind].split('.')[0]}/${e.object.name}`, e.message]),
          ),
        );
      }
      continue;
    }
    if (type === 'Endpoints') {
      const svcs = listOf(s, 'Service', namespace).filter((o) => wanted.length === 0 || wanted.includes(o.metadata.name)) as Extract<KObject, { kind: 'Service' }>[];
      const rows = svcs.map((v) => [v.metadata.name, endpointsText(s, v), ageOf(s, v)]);
      if (namespace === 'default' && (wanted.length === 0 || wanted.includes('kubernetes'))) rows.unshift(['kubernetes', '192.168.49.2:6443', humanAge(KUBERNETES_SERVICE_AGE)]);
      wanted.filter((w) => w !== 'kubernetes' && !svcs.some((v) => v.metadata.name === w)).forEach((w) => errors.push(`Error from server (NotFound): endpoints "${w}" not found`));
      if (rows.length) sections.push(table(['NAME', 'ENDPOINTS', 'AGE'], rows));
      continue;
    }
    if (type === 'PersistentVolume') {
      const bound = objectsOf(s, 'PersistentVolumeClaim').filter((c) => c.status.phase === 'Bound');
      if (bound.length) {
        sections.push(
          table(
            ['NAME', 'CAPACITY', 'ACCESS MODES', 'RECLAIM POLICY', 'STATUS', 'CLAIM', 'STORAGECLASS', 'VOLUMEATTRIBUTESCLASS', 'REASON', 'AGE'],
            bound.map((c) => [c.spec.volumeName ?? '', c.status.capacity ?? '', c.spec.accessModes.map((m) => ACCESS_MODE_SHORT[m] ?? m).join(','), 'Delete', 'Bound', `${c.metadata.namespace}/${c.metadata.name}`, c.spec.storageClassName, '<unset>', '', ageOf(s, c)]),
          ),
        );
      }
      continue;
    }
    let objs = listOf(s, type, namespace);
    if (wanted.length) {
      wanted.filter((w) => !objs.some((o) => o.metadata.name === w) && !(type === 'Service' && w === 'kubernetes')).forEach((w) => errors.push(`Error from server (NotFound): ${PLURAL_LABEL[type]} "${w}" not found`));
      objs = objs.filter((o) => wanted.includes(o.metadata.name));
    }
    const filtered = filterSelector(objs, selector);
    if (typeof filtered === 'string') return fail([filtered]);
    found.push(...filtered);
    if (output === 'yaml' || output === 'json' || output === 'name') continue;
    const includeK8sSvc = type === 'Service' && namespace !== 'kube-system' && !selector && (wanted.length === 0 || wanted.includes('kubernetes'));
    if (filtered.length === 0 && !includeK8sSvc) continue;
    const g = getRows(s, type, filtered, wide, showLabels, multi, allNs);
    if (includeK8sSvc) {
      g.rows.unshift([
        ...(allNs ? ['default'] : []),
        multi ? 'service/kubernetes' : 'kubernetes',
        'ClusterIP',
        '10.96.0.1',
        '<none>',
        '443/TCP',
        humanAge(KUBERNETES_SERVICE_AGE),
        ...(wide ? ['<none>'] : []),
        ...(showLabels ? ['component=apiserver,provider=kubernetes'] : []),
      ]);
    }
    sections.push(table(g.header, g.rows));
  }

  if (output === 'yaml' || output === 'json') {
    const items = found.map((o) => toApiObject(o));
    const value = items.length === 1 && (names.length || pairs.length) ? items[0] : { apiVersion: 'v1', items, kind: 'List', metadata: { resourceVersion: '' } };
    return out(
      [...(output === 'yaml' ? toYaml(value) : JSON.stringify(value, null, 2)).split('\n'), ...errors.map((e) => ({ text: e, tone: 'error' as const }))],
      [effect],
      errors.length === 0,
    );
  }
  if (output === 'name') {
    return out([...found.map((o) => `${KIND_LABEL[o.kind]}/${o.metadata.name}`), ...errors.map((e) => ({ text: e, tone: 'error' as const }))], [effect], errors.length === 0);
  }
  const lines: OutputLine[] = [];
  sections.forEach((sec, i) => {
    if (i > 0) lines.push({ text: '' });
    lines.push({ text: sec[0]!, tone: 'muted' }, ...sec.slice(1).map((text) => ({ text })));
  });
  errors.forEach((e) => lines.push({ text: e, tone: 'error' }));
  if (lines.length === 0) {
    lines.push({ text: namespace === null ? 'No resources found' : `No resources found in ${namespace} namespace.`, tone: 'muted' });
  }
  return { ok: errors.length === 0, lines, effects: [effect] };
};

// ---------------------------------------------------------------------------
// describe
// ---------------------------------------------------------------------------

const kv = (pairs: [string, string][], indent = '', width?: number): string[] => {
  const w = width ?? Math.max(...pairs.map(([k]) => k.length)) + 2;
  return pairs.map(([k, v]) => `${indent}${`${k}:`.padEnd(w)}${v}`);
};

const multiline = (label: string, values: string[], width: number) =>
  values.length === 0 ? [`${`${label}:`.padEnd(width)}<none>`] : values.map((v, i) => `${(i === 0 ? `${label}:` : '').padEnd(width)}${v}`);

const timeText = (seconds: number) => {
  const d = new Date(isoAt(seconds));
  return d.toUTCString().replace('GMT', '+0000');
};

const eventsFor = (s: SimState, o: KObject): string[] => {
  const evs = s.events.filter((e) => e.object.kind === o.kind && e.object.name === o.metadata.name && e.time >= o.metadata.creationTime);
  if (evs.length === 0) return ['Events:  <none>'];
  // Repeated events collapse like kubectl does ("x3 over 10s").
  const groups: { e: (typeof evs)[number]; count: number; first: number }[] = [];
  for (const e of evs) {
    const g = groups.find((x) => x.e.reason === e.reason && x.e.message === e.message && x.e.source === e.source);
    if (g) {
      g.count += 1;
      g.e = e;
    } else groups.push({ e, count: 1, first: e.time });
  }
  return [
    'Events:',
    ...table(
      ['Type', 'Reason', 'Age', 'From', 'Message'],
      [['----', '------', '----', '----', '-------'], ...groups.map((g) => [g.e.type, g.e.reason, g.count > 1 ? `${humanAge(s.time - g.e.time)} (x${g.count} over ${humanAge(g.e.time - g.first)})` : humanAge(s.time - g.e.time), g.e.source, g.e.message])],
    ).map((l) => `  ${l}`),
  ];
};

const probeText = (pr: Probe) => {
  const timing = `delay=${pr.initialDelaySeconds ?? 0}s timeout=1s period=${pr.periodSeconds ?? 10}s #success=1 #failure=${pr.failureThreshold ?? 3}`;
  if (pr.httpGet) return `http-get http://:${pr.httpGet.port}${pr.httpGet.path ?? '/'} ${timing}`;
  if (pr.tcpSocket) return `tcp-socket :${pr.tcpSocket.port} ${timing}`;
  return `exec [${pr.exec?.command.join(' ') ?? ''}] ${timing}`;
};

const describePod = (s: SimState, p: PodObject): string[] => {
  const W = 18;
  const lines = kv(
    [
      ['Name', p.metadata.name],
      ['Namespace', p.metadata.namespace],
      ['Priority', '0'],
      ['Service Account', 'default'],
      ['Node', p.status.nodeName ? `${p.status.nodeName}/${p.status.hostIP}` : '<none>'],
      ['Start Time', p.status.startTime !== undefined ? timeText(p.status.startTime) : '<none>'],
    ],
    '',
    W,
  );
  lines.push(...multiline('Labels', Object.entries(p.metadata.labels).map(([k, v]) => `${k}=${v}`), W));
  lines.push(...multiline('Annotations', Object.entries(p.metadata.annotations).map(([k, v]) => `${k}: ${v}`), W));
  lines.push(...kv([['Status', podStatus(p) === 'Terminating' ? 'Terminating (lasts 2s)' : p.status.phase]], '', W));
  if (p.status.reason) lines.push(...kv([['Reason', p.status.reason]], '', W));
  lines.push(...kv([['IP', p.status.podIP ?? '']], '', W));
  if (p.status.podIP) lines.push('IPs:', `  IP:  ${p.status.podIP}`);
  else lines.push('IPs:              <none>');
  const owner = ownerText(p);
  if (owner) lines.push(`Controlled By:  ${owner}`);
  lines.push('Containers:');
  for (const c of p.spec.containers) {
    const cs = p.status.containerStatuses.find((x) => x.name === c.name);
    const pairs: [string, string][] = [['Image', c.image]];
    const port = c.ports?.[0];
    pairs.push(['Port', port ? `${port.containerPort}/${port.protocol ?? 'TCP'}${port.name ? ` (${port.name})` : ''}` : '<none>']);
    pairs.push(['Host Port', port ? `0/${port.protocol ?? 'TCP'}` : '<none>']);
    if (cs?.state === 'running') pairs.push(['State', 'Running'], ['  Started', timeText(cs.startedAt ?? 0)]);
    else pairs.push(['State', 'Waiting'], ['  Reason', cs?.reason ?? 'ContainerCreating'], ...(cs?.message ? ([['  Message', cs.message]] as [string, string][]) : []));
    pairs.push(['Ready', cs?.ready ? 'True' : 'False'], ['Restart Count', String(cs?.restartCount ?? 0)]);
    lines.push(`  ${c.name}:`);
    lines.push(...kv(pairs, '    ', 16));
    for (const which of ['limits', 'requests'] as const) {
      const r = c.resources?.[which];
      if (r && (r.cpu || r.memory)) {
        lines.push(`    ${which === 'limits' ? 'Limits' : 'Requests'}:`);
        if (r.cpu) lines.push(`      cpu:     ${r.cpu}`);
        if (r.memory) lines.push(`      memory:  ${r.memory}`);
      }
    }
    if (c.livenessProbe) lines.push(`    Liveness:     ${probeText(c.livenessProbe)}`);
    if (c.readinessProbe) lines.push(`    Readiness:    ${probeText(c.readinessProbe)}`);
    if (c.envFrom?.length) {
      lines.push('    Environment Variables from:');
      c.envFrom.forEach((e) => e.configMapRef && lines.push(`      ${e.configMapRef.name}  ConfigMap  Optional: false`));
    }
    if (c.env?.length) {
      lines.push('    Environment:');
      c.env.forEach((e) => {
        const ref = e.valueFrom?.configMapKeyRef;
        lines.push(`      ${e.name}:  ${ref ? `<set to the key '${ref.key}' of config map '${ref.name}'>` : (e.value ?? '')}`);
      });
    } else lines.push('    Environment:  <none>');
    lines.push('    Mounts:');
    if (c.volumeMounts?.length) c.volumeMounts.forEach((m) => lines.push(`      ${m.mountPath} from ${m.name} (${m.readOnly ? 'ro' : 'rw'})`));
    else lines.push('      <none>');
  }
  lines.push('Conditions:');
  if (p.status.conditions.length) lines.push(...table(['Type', 'Status'], p.status.conditions.map((c) => [c.type, c.status])).map((l) => `  ${l}`));
  else lines.push('  <none>');
  lines.push('Volumes:');
  if (p.spec.volumes?.length) {
    for (const v of p.spec.volumes) {
      lines.push(`  ${v.name}:`);
      if (v.persistentVolumeClaim) lines.push('    Type:       PersistentVolumeClaim (a reference to a PersistentVolumeClaim in the same namespace)', `    ClaimName:  ${v.persistentVolumeClaim.claimName}`, '    ReadOnly:   false');
      else if (v.configMap) lines.push('    Type:      ConfigMap (a volume populated by a ConfigMap)', `    Name:      ${v.configMap.name}`, '    Optional:  false');
      else lines.push('    Type:       EmptyDir (a temporary directory that shares a pod\'s lifetime)', '    Medium:     ');
    }
  } else lines.push('  <none>');
  lines.push(
    `QoS Class:                   ${p.status.qosClass}`,
    'Node-Selectors:              <none>',
    'Tolerations:                 node.kubernetes.io/not-ready:NoExecute op=Exists for 300s',
    '                             node.kubernetes.io/unreachable:NoExecute op=Exists for 300s',
  );
  lines.push(...eventsFor(s, p));
  return lines;
};

const podsStatusLine = (pods: PodObject[]) => {
  const running = pods.filter((p) => p.status.phase === 'Running' && !isDeleting(p)).length;
  const waiting = pods.filter((p) => p.status.phase === 'Pending' && !isDeleting(p)).length;
  return `${running} Running / ${waiting} Waiting / 0 Succeeded / 0 Failed`;
};

const templateLines = (t: { metadata: { labels: Record<string, string> }; spec: PodObject['spec'] }): string[] => [
  'Pod Template:',
  ...multiline('  Labels', Object.entries(t.metadata.labels).map(([k, v]) => `${k}=${v}`), 10),
  '  Containers:',
  ...t.spec.containers.flatMap((c) => [
    `   ${c.name}:`,
    `    Image:         ${c.image}`,
    `    Port:          ${c.ports?.[0] ? `${c.ports[0].containerPort}/${c.ports[0].protocol ?? 'TCP'}` : '<none>'}`,
    ...(c.resources?.requests ? [`    Requests:      ${Object.entries(c.resources.requests).map(([k, v]) => `${k}=${v}`).join(', ')}`] : []),
    ...(c.resources?.limits ? [`    Limits:        ${Object.entries(c.resources.limits).map(([k, v]) => `${k}=${v}`).join(', ')}`] : []),
    `    Environment:   ${c.env?.length ? c.env.map((e) => e.name).join(', ') : '<none>'}`,
    `    Mounts:        ${c.volumeMounts?.length ? c.volumeMounts.map((m) => m.mountPath).join(', ') : '<none>'}`,
  ]),
  `  Volumes:         ${t.spec.volumes?.length ? t.spec.volumes.map((v) => v.name).join(', ') : '<none>'}`,
];

const describeObject = (s: SimState, o: KObject): string[] => {
  const head = (extra: [string, string][]) => [
    ...kv([['Name', o.metadata.name], ['Namespace', o.metadata.namespace], ...extra], '', 20),
  ];
  const labels = multiline('Labels', Object.entries(o.metadata.labels).map(([k, v]) => `${k}=${v}`), 20);
  const annotations = multiline('Annotations', Object.entries(o.metadata.annotations).map(([k, v]) => `${k}: ${v}`), 20);
  switch (o.kind) {
    case 'Pod':
      return describePod(s, o);
    case 'ReplicaSet': {
      const pods = objectsOf(s, 'Pod').filter((p) => controllerOf(p)?.uid === o.metadata.uid);
      return [
        ...head([['Selector', labelsText(o.spec.selector.matchLabels)]]),
        ...labels,
        ...annotations,
        ...(ownerText(o) ? [`Controlled By:  ${ownerText(o)}`] : []),
        `Replicas:     ${o.status.replicas} current / ${o.spec.replicas} desired`,
        `Pods Status:  ${podsStatusLine(pods)}`,
        ...templateLines(o.spec.template),
        ...eventsFor(s, o),
      ];
    }
    case 'Deployment': {
      const rss = objectsOf(s, 'ReplicaSet').filter((r) => controllerOf(r)?.uid === o.metadata.uid);
      const current = rss.find((r) => r.status.replicas > 0 || r.spec.replicas > 0) ?? rss[rss.length - 1];
      const unavailable = Math.max(0, o.status.replicas - o.status.availableReplicas);
      return [
        ...head([['CreationTimestamp', timeText(o.metadata.creationTime)]]),
        ...labels,
        ...annotations,
        ...kv([['Selector', labelsText(o.spec.selector.matchLabels)]], '', 20),
        `Replicas:               ${o.spec.replicas} desired | ${o.status.updatedReplicas} updated | ${o.status.replicas} total | ${o.status.availableReplicas} available | ${unavailable} unavailable`,
        `StrategyType:           ${o.spec.strategy.type}`,
        'MinReadySeconds:        0',
        ...(o.spec.strategy.type === 'RollingUpdate' ? ['RollingUpdateStrategy:  25% max unavailable, 25% max surge'] : []),
        ...templateLines(o.spec.template),
        'Conditions:',
        '  Type           Status  Reason',
        '  ----           ------  ------',
        `  Available      ${o.status.availableReplicas >= o.spec.replicas ? 'True ' : 'False'}   ${o.status.availableReplicas >= o.spec.replicas ? 'MinimumReplicasAvailable' : 'MinimumReplicasUnavailable'}`,
        `  Progressing    True    ${o.status.updatedReplicas === o.spec.replicas ? 'NewReplicaSetAvailable' : 'ReplicaSetUpdated'}`,
        `OldReplicaSets:  ${rss.filter((r) => r !== current && r.status.replicas > 0).map((r) => `${r.metadata.name} (${r.status.replicas}/${r.spec.replicas} replicas created)`).join(', ') || '<none>'}`,
        `NewReplicaSet:   ${current ? `${current.metadata.name} (${current.status.replicas}/${current.spec.replicas} replicas created)` : '<none>'}`,
        ...eventsFor(s, o),
      ];
    }
    case 'Service': {
      const eps = serviceEndpoints(s, o);
      const port = o.spec.ports[0];
      return [
        ...head([]),
        ...labels,
        ...annotations,
        ...kv(
          [
            ['Selector', o.spec.selector ? labelsText(o.spec.selector) : '<none>'],
            ['Type', o.spec.type],
            ['IP Family Policy', 'SingleStack'],
            ['IP Families', 'IPv4'],
            ['IP', o.spec.clusterIP],
            ['IPs', o.spec.clusterIP],
            ...(port
              ? ([
                  ['Port', `${port.name ?? '<unset>'}  ${port.port}/${port.protocol}`],
                  ['TargetPort', `${port.targetPort}/${port.protocol}`],
                ] as [string, string][])
              : []),
            ['Endpoints', eps.filter((e) => e.ready).map((e) => `${e.ip}:${e.port}`).join(',') || '<none>'],
            ['Session Affinity', 'None'],
            ['Internal Traffic Policy', 'Cluster'],
          ],
          '',
          25,
        ),
        ...(eps.some((e) => !e.ready) ? [`Not ready endpoints:     ${eps.filter((e) => !e.ready).map((e) => `${e.ip}:${e.port} (${e.podName})`).join(', ')}`] : []),
        ...eventsFor(s, o),
      ];
    }
    case 'ConfigMap':
      return [
        ...head([]),
        ...labels,
        ...annotations,
        '',
        'Data',
        '====',
        ...Object.entries(o.data).flatMap(([k, v]) => [`${k}:`, '----', v, '']),
        '',
        'BinaryData',
        '====',
        '',
        ...eventsFor(s, o),
      ];
    case 'PersistentVolumeClaim': {
      const users = objectsOf(s, 'Pod').filter((p) => p.spec.volumes?.some((v) => v.persistentVolumeClaim?.claimName === o.metadata.name));
      return [
        ...head([['StorageClass', o.spec.storageClassName], ['Status', o.status.phase], ['Volume', o.spec.volumeName ?? '']]),
        ...labels,
        ...annotations,
        ...kv(
          [
            ['Finalizers', '[kubernetes.io/pvc-protection]'],
            ['Capacity', o.status.capacity ?? ''],
            ['Access Modes', o.status.phase === 'Bound' ? o.spec.accessModes.map((m) => ACCESS_MODE_SHORT[m] ?? m).join(',') : ''],
            ['VolumeMode', 'Filesystem'],
            ['Used By', users.map((u) => u.metadata.name).join(', ') || '<none>'],
          ],
          '',
          20,
        ),
        ...eventsFor(s, o),
      ];
    }
  }
};

const describe = (p: Parsed, ctx: ShellContext): CommandResult => {
  const s = ctx.api.snapshot();
  const { types, names, pairs } = targets(p.args);
  if (types.length === 0) return fail(['error: You must specify the type of resource to describe.'], 'Try: kubectl describe pod hello-pod');
  const type = resourceType(types[0]!);
  if (!type) return unknownResource(types[0]!);
  const wanted = pairs.length ? pairs.map((x) => x.name) : names;
  if (type === 'Node') {
    const nodes = s.nodes.filter((n) => wanted.length === 0 || wanted.includes(n.name));
    if (!nodes.length) return fail([`Error from server (NotFound): nodes "${wanted[0]}" not found`]);
    const lines = nodes.flatMap((n, i) => {
      const podsHere = objectsOf(s, 'Pod').filter((x) => x.status.nodeName === n.name && !isDeleting(x));
      return [
        ...(i ? [''] : []),
        `Name:               ${n.name}`,
        `Roles:              ${n.role === 'control-plane' ? 'control-plane' : '<none>'}`,
        `Taints:             ${n.role === 'control-plane' ? 'node-role.kubernetes.io/control-plane:NoSchedule' : '<none>'}`,
        'Addresses:',
        `  InternalIP:  ${n.internalIP}`,
        `  Hostname:    ${n.name}`,
        'Allocatable:',
        `  cpu:     ${n.cpuMillis}m`,
        `  memory:  ${n.memoryMiB}Mi`,
        '  pods:    110',
        `PodCIDR:            ${n.podCIDR}`,
        `Non-terminated Pods:          (${podsHere.length} in total, your objects only)`,
        ...podsHere.map((x) => `  default    ${x.metadata.name}`),
      ];
    });
    return out(lines, [{ verb: 'describe', name: wanted[0] }]);
  }
  if (!['Pod', 'ReplicaSet', 'Deployment', 'Service', 'ConfigMap', 'PersistentVolumeClaim'].includes(type)) {
    return fail([`error: describe is not supported for ${PLURAL_LABEL[type]} in the Playground`]);
  }
  const kind = type as Kind;
  const namespace = namespaceOf(p);
  let objs = listOf(s, kind, namespace);
  if (wanted.length) {
    const missing = wanted.filter((w) => !objs.some((o) => o.metadata.name === w));
    if (missing.length) {
      const close = objs.filter((o) => o.metadata.name.startsWith(missing[0]!.slice(0, 3))).map((o) => o.metadata.name);
      return fail(
        [`Error from server (NotFound): ${PLURAL_LABEL[kind]} "${missing[0]}" not found`],
        close.length ? `Did you mean ${close.join(', ')}? Run: kubectl get ${PLURAL_LABEL[kind].split('.')[0]}` : `List what exists with: kubectl get ${PLURAL_LABEL[kind].split('.')[0]}`,
        [{ verb: 'describe', kind, name: missing[0] }],
      );
    }
    objs = objs.filter((o) => wanted.includes(o.metadata.name));
  }
  if (objs.length === 0) return out([{ text: `No resources found in ${namespace} namespace.`, tone: 'muted' }], [{ verb: 'describe', kind }]);
  const lines = objs.flatMap((o, i) => [...(i ? [''] : []), ...describeObject(s, o)]);
  return out(lines, objs.map((o) => ({ verb: 'describe', kind, name: o.metadata.name })));
};

// ---------------------------------------------------------------------------
// delete, scale, logs, exec, explain
// ---------------------------------------------------------------------------

const del = async (p: Parsed, ctx: ShellContext): Promise<CommandResult> => {
  const lines: OutputLine[] = [];
  const effects: Effect[] = [];
  let ok = true;
  const remove = async (kind: Kind, name: string, file?: string) => {
    const r = await ctx.api.delete(kind, name, namespaceOf(p));
    if (r.ok) {
      lines.push({ text: `${resourceName(kind).split('.')[0]} "${name}" deleted`, tone: 'success' });
      effects.push({ verb: 'delete', kind, name, file, action: 'deleted' });
    } else {
      lines.push({ text: r.error, tone: 'error' });
      ok = false;
    }
  };
  if (p.flags.filename?.length) {
    const { files } = fileArg(p, 'delete');
    for (const file of files!) {
      const text = ctx.files[file];
      if (text === undefined) return missingFile(file, ctx);
      const { objects, issues } = readManifests(text);
      if (issues.length) return { ok: false, lines: issueLines(file, issues), effects: [] };
      for (const { desired } of objects) await remove(desired.kind, desired.metadata.name, file);
    }
    return { ok, lines, effects };
  }
  const { types, names, pairs } = targets(p.args);
  if (types.length === 0) return fail(['error: You must provide one or more resources by argument or filename.'], 'Try: kubectl delete pod hello-pod   or   kubectl delete -f pod.yaml');
  const list = pairs.length ? pairs : names.map((name) => ({ type: types[0]!, name }));
  if (list.length === 0 && p.bools.has('all')) {
    const kind = resourceType(types[0]!);
    if (!kind || !['Pod', 'ReplicaSet', 'Deployment', 'Service', 'ConfigMap', 'PersistentVolumeClaim'].includes(kind)) return unknownResource(types[0]!);
    const objs = listOf(ctx.api.snapshot(), kind as Kind, namespaceOf(p));
    if (!objs.length) return out([{ text: 'No resources found', tone: 'muted' }]);
    for (const o of objs) await remove(kind as Kind, o.metadata.name);
    return { ok, lines, effects };
  }
  if (list.length === 0) return fail(['error: resource(s) were provided, but no name was specified'], `Try: kubectl delete ${types[0]} <name>  (or --all)`);
  for (const { type, name } of list) {
    const kind = resourceType(type);
    if (!kind) return unknownResource(type);
    if (!['Pod', 'ReplicaSet', 'Deployment', 'Service', 'ConfigMap', 'PersistentVolumeClaim'].includes(kind)) return fail([`error: deleting ${PLURAL_LABEL[kind]} is not allowed in the Playground`]);
    await remove(kind as Kind, name);
  }
  return { ok, lines, effects };
};

/** The manifest an existing object would have, for edits made by commands (scale). */
const desiredFrom = (o: KObject): DesiredObject | null => {
  const metadata = { name: o.metadata.name, namespace: o.metadata.namespace, labels: o.metadata.labels, annotations: o.metadata.annotations };
  if (o.kind === 'Deployment') return { kind: 'Deployment', apiVersion: 'apps/v1', metadata, spec: structuredClone(o.spec) };
  if (o.kind === 'ReplicaSet') return { kind: 'ReplicaSet', apiVersion: 'apps/v1', metadata, spec: structuredClone(o.spec) };
  return null;
};

const scale = async (p: Parsed, ctx: ShellContext): Promise<CommandResult> => {
  const replicas = p.flags.replicas?.[0];
  if (replicas === undefined || !/^\d+$/.test(replicas)) return fail(['error: --replicas=COUNT is required, and COUNT must be greater than or equal to 0'], 'Try: kubectl scale deployment web --replicas=5');
  const { types, names, pairs } = targets(p.args);
  const target = pairs[0] ?? (types[0] && names[0] ? { type: types[0], name: names[0] } : undefined);
  if (!target) return fail(['error: resource(s) were provided, but no name was specified'], 'Try: kubectl scale deployment web --replicas=5');
  const kind = resourceType(target.type);
  if (kind !== 'Deployment' && kind !== 'ReplicaSet') return fail([`error: cannot scale ${target.type}: only deployments and replicasets can be scaled here`]);
  const existing = findObject(ctx.api.snapshot(), kind, target.name, namespaceOf(p));
  if (!existing) return fail([`Error from server (NotFound): ${PLURAL_LABEL[kind]} "${target.name}" not found`]);
  const desired = desiredFrom(existing)!;
  if (desired.kind === 'Deployment' || desired.kind === 'ReplicaSet') desired.spec.replicas = Number(replicas);
  const r = await ctx.api.apply(desired);
  if (!r.ok) return fail([r.error]);
  return out([{ text: `${resourceName(kind)}/${target.name} scaled`, tone: 'success' }, { text: 'note: your YAML file still says the old number. The next `kubectl apply -f` will set it back.', tone: 'hint' }], [
    { verb: 'scale', kind, name: target.name },
  ]);
};

const podArg = (p: Parsed, ctx: ShellContext, verb: string): { pod?: PodObject; error?: CommandResult } => {
  const arg = p.args[0];
  if (!arg) return { error: fail([`error: expected 'kubectl ${verb} POD'`], `Find a Pod name with: kubectl get pods`) };
  const name = arg.replace(/^(pods?|po)\//, '');
  if (arg.startsWith('deployment/') || arg.startsWith('deploy/')) {
    const dep = findObject(ctx.api.snapshot(), 'Deployment', arg.split('/')[1]!, namespaceOf(p));
    const pod = dep && objectsOf(ctx.api.snapshot(), 'Pod').find((x) => ownerChain(ctx.api.snapshot(), x).includes(dep) && !isDeleting(x));
    if (pod) return { pod };
  }
  const pod = findObject(ctx.api.snapshot(), 'Pod', name, namespaceOf(p));
  if (!pod) return { error: fail([`Error from server (NotFound): pods "${name}" not found`], 'Find a Pod name with: kubectl get pods') };
  return { pod };
};

const NGINX_LOG = [
  '/docker-entrypoint.sh: /docker-entrypoint.d/ is not empty, will attempt to perform configuration',
  '/docker-entrypoint.sh: Looking for shell scripts in /docker-entrypoint.d/',
  '/docker-entrypoint.sh: Launching /docker-entrypoint.d/10-listen-on-ipv6-by-default.sh',
  '/docker-entrypoint.sh: Configuration complete; ready for start up',
  'nginx/1.27.3',
  'start worker processes',
];

const logs = (p: Parsed, ctx: ShellContext): CommandResult => {
  const { pod, error } = podArg(p, ctx, 'logs');
  if (error) return error;
  const s = ctx.api.snapshot();
  const cname = p.flags.container?.[0] ?? pod!.spec.containers[0]!.name;
  const c = pod!.spec.containers.find((x) => x.name === cname);
  if (!c) return fail([`error: container ${cname} is not valid for pod ${pod!.metadata.name}`]);
  const cs = pod!.status.containerStatuses.find((x) => x.name === cname);
  if (cs?.state !== 'running') {
    return fail([`Error from server (BadRequest): container "${cname}" in pod "${pod!.metadata.name}" is waiting to start: ${cs?.reason ?? 'ContainerCreating'}`], 'A container has no logs until it has started. Check its state with kubectl describe pod.');
  }
  const started = isoAt(cs.startedAt ?? 0).replace('T', ' ').replace('Z', '');
  const lines: OutputLine[] = [{ text: '(simulated logs: no real process runs in the Playground)', tone: 'muted' }];
  const repo = c.image.split(':')[0]!.split('/').pop();
  if (repo === 'nginx') {
    NGINX_LOG.forEach((l, i) => lines.push({ text: i < 4 ? l : `${started.replace(/-/g, '/')} [notice] 1#1: ${l}` }));
    const probes = [c.readinessProbe, c.livenessProbe].filter((x): x is Probe => !!x && !!x.httpGet && probeFailure(c, x) === null);
    if (probes.length) {
      const count = Math.min(4, Math.max(1, Math.floor((s.time - (cs.startedAt ?? 0)) / 10)));
      for (let i = 0; i < count; i++) lines.push({ text: `${pod!.status.podIP?.replace(/\.\d+$/, '.1')} - - [${started}] "GET ${probes[0]!.httpGet!.path ?? '/'} HTTP/1.1" 200 615 "-" "kube-probe/1.34"` });
    }
  } else {
    lines.push({ text: `${started} ${c.name}: started (image ${c.image})` });
    const env = containerEnv(s, pod!, c);
    if (env.GREETING) lines.push({ text: `${started} ${c.name}: ${env.GREETING}` });
  }
  return out(lines, [{ verb: 'logs', kind: 'Pod', name: pod!.metadata.name }]);
};

const exec = (p: Parsed, ctx: ShellContext): CommandResult => {
  const { pod, error } = podArg(p, ctx, 'exec');
  if (error) return error;
  const s = ctx.api.snapshot();
  if (p.rest.length === 0) return fail(['error: you must specify at least one command for the container'], `Try: kubectl exec ${pod!.metadata.name} -- env`);
  const cname = p.flags.container?.[0] ?? pod!.spec.containers[0]!.name;
  const c = pod!.spec.containers.find((x) => x.name === cname);
  if (!c) return fail([`error: container ${cname} not found in pod ${pod!.metadata.name}`]);
  const cs = pod!.status.containerStatuses.find((x) => x.name === cname);
  if (cs?.state !== 'running') return fail([`error: unable to upgrade connection: container not found ("${cname}")`], 'The container is not running yet.');
  const [cmd, ...args] = p.rest;
  const effect: Effect = { verb: 'exec', kind: 'Pod', name: pod!.metadata.name, output: p.rest.join(' ') };
  const env = containerEnv(s, pod!, c);
  if (cmd === 'env' || (cmd === 'printenv' && args.length === 0)) return out(Object.entries(env).map(([k, v]) => `${k}=${v}`), [effect]);
  if (cmd === 'printenv') {
    const values = args.map((a) => env[a]).filter((v): v is string => v !== undefined);
    return values.length ? out(values, [effect]) : { ok: false, lines: [], effects: [effect] };
  }
  if (cmd === 'echo') return out([args.join(' ').replace(/\$(\w+)/g, (_, k: string) => env[k] ?? '')], [effect]);
  if (cmd === 'hostname') return out([pod!.metadata.name], [effect]);
  if (cmd === 'ls' || cmd === 'df') {
    const mounts = c.volumeMounts ?? [];
    if (cmd === 'df') return out(['Filesystem     Size  Used Avail Use% Mounted on', 'overlay         20G  4.1G   16G  21% /', ...mounts.map((m) => `${m.name.padEnd(14)} ${'1.0G'.padStart(4)}     0  1.0G   0% ${m.mountPath}`), '(simulated)'], [effect]);
    const target = args[0] ?? '/';
    const mount = mounts.find((m) => m.mountPath === target);
    if (mount) return out([{ text: `(simulated) ${target} is the volume "${mount.name}": empty until your application writes to it.`, tone: 'muted' }], [effect]);
    return out(['bin  boot  dev  docker-entrypoint.d  etc  home  lib  media  mnt  opt  proc  root  run  sbin  srv  sys  tmp  usr  var'], [effect]);
  }
  return fail([`(simulated) "${cmd}" is not available inside Playground containers.`], 'Supported: env, printenv [VAR], echo, hostname, ls, df.', [effect]);
};

const explainNode = (node: SchemaNode): string[] => {
  let n = node;
  while (n.type === 'array') n = n.items;
  if (n.type !== 'object') return [];
  return [
    'FIELDS:',
    ...Object.entries(n.fields).flatMap(([k, f]) => [`  ${k}\t<${describeType(f.node)}>${f.required ? ' -required-' : ''}`, `    ${f.doc.summary}`, '']),
  ];
};

const explain = (p: Parsed): CommandResult => {
  const arg = p.args[0];
  if (!arg) return fail(['error: You must specify the type of resource to explain.'], 'Try: kubectl explain pod.spec.containers');
  const r = explainPath(arg);
  if (!r) return fail([`error: field "${arg}" does not exist`], 'Try: kubectl explain pod, pod.spec, deployment.spec.selector…');
  const lines: string[] = [`KIND:       ${r.kind}`, `VERSION:    ${r.kind === 'Deployment' || r.kind === 'ReplicaSet' ? 'apps/v1' : 'v1'}`, ''];
  if (r.lookup) {
    const d = r.lookup.field.doc;
    lines.push(`FIELD: ${r.lookup.key} <${describeType(r.lookup.field.node)}>${r.lookup.field.required ? ' -required-' : ''}`, '', 'DESCRIPTION:');
    lines.push(`    ${d.summary}`);
    if (d.why) lines.push(`    Why: ${d.why}`);
    if (d.values) lines.push(`    Values: ${d.values}`);
    if (d.how) lines.push(`    How Kubernetes uses it: ${d.how}`);
    lines.push('');
  } else {
    lines.push('DESCRIPTION:', `    ${(r.node.type === 'object' && Object.values(r.node.fields).find((x) => x.doc.summary.startsWith('The type'))?.doc.summary) || r.kind}`, '');
  }
  lines.push(...explainNode(r.node));
  return out(lines, [{ verb: 'explain', output: arg }]);
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export const KUBECTL_VERBS = ['apply', 'create', 'get', 'describe', 'delete', 'scale', 'logs', 'exec', 'explain', 'version', 'cluster-info', 'api-resources'];

export const runCommand = async (input: string, ctx: ShellContext): Promise<CommandResult> => {
  const line = input.trim();
  if (!line) return out([]);
  if (line.includes('|')) return fail(['(simulated) pipes are not supported in the Playground shell.'], 'Run the kubectl command on its own.');
  const tokens = tokenize(line);
  const [cmd, ...rest] = tokens;
  switch (cmd) {
    case 'clear':
      return { ok: true, lines: [], effects: [], clear: true };
    case 'help':
      return out(HELP, [{ verb: 'help' }]);
    case 'ls':
      return out(Object.keys(ctx.files).length ? [Object.keys(ctx.files).sort().join('  ')] : [{ text: '(no files yet)', tone: 'muted' }]);
    case 'cat': {
      if (!rest[0]) return fail(['cat: missing file operand']);
      const text = ctx.files[rest[0].replace(/^\.\//, '')];
      return text === undefined ? fail([`cat: ${rest[0]}: No such file or directory`]) : out(text.replace(/\n$/, '').split('\n'));
    }
    case 'pwd':
      return out(['/home/learner/playground']);
    case 'whoami':
      return out(['learner']);
    case 'echo':
      return out([rest.join(' ')]);
    case 'kubectl':
    case 'k':
      break;
    default:
      return fail([`${cmd}: command not found`], cmd === 'kubeclt' || cmd === 'kubect' || cmd === 'kubctl' ? 'Did you mean kubectl?' : 'Type `help` to see what this shell supports.');
  }

  const p = parseArgs(rest);
  const [verb, ...args] = p.args;
  p.args = args;
  if (!verb || p.bools.has('help')) return out(HELP);
  if (p.unknown.length) return fail([`error: unknown flag: ${p.unknown[0]}`], `See 'kubectl ${verb} --help' — or type \`help\` for what the Playground supports.`);
  const ns = p.flags.namespace?.[0];
  if (ns && !['default', 'kube-system', 'kube-public', 'kube-node-lease'].includes(ns)) {
    return fail([`Error from server (NotFound): namespaces "${ns}" not found`]);
  }
  switch (verb) {
    case 'apply':
      return apply(p, ctx, 'apply');
    case 'create':
      return apply(p, ctx, 'create');
    case 'get':
      return get(p, ctx);
    case 'describe':
      return describe(p, ctx);
    case 'delete':
      return del(p, ctx);
    case 'scale':
      return scale(p, ctx);
    case 'logs':
      return logs(p, ctx);
    case 'exec':
      return exec(p, ctx);
    case 'explain':
      return explain(p);
    case 'version':
      return out(['Client Version: v1.34.1', 'Kustomize Version: v5.7.1', 'Server Version: v1.34.1 (KubeVerse simulated control plane)']);
    case 'cluster-info':
      return out([
        { text: 'Kubernetes control plane is running at https://192.168.49.2:6443 (simulated)', tone: 'success' },
        'CoreDNS is running at https://192.168.49.2:6443/api/v1/namespaces/kube-system/services/kube-dns:dns/proxy (simulated)',
      ]);
    case 'api-resources':
      return out(
        table(
          ['NAME', 'SHORTNAMES', 'APIVERSION', 'NAMESPACED', 'KIND'],
          [
            ['configmaps', 'cm', 'v1', 'true', 'ConfigMap'],
            ['endpoints', 'ep', 'v1', 'true', 'Endpoints'],
            ['events', 'ev', 'v1', 'true', 'Event'],
            ['namespaces', 'ns', 'v1', 'false', 'Namespace'],
            ['nodes', 'no', 'v1', 'false', 'Node'],
            ['persistentvolumeclaims', 'pvc', 'v1', 'true', 'PersistentVolumeClaim'],
            ['persistentvolumes', 'pv', 'v1', 'false', 'PersistentVolume'],
            ['pods', 'po', 'v1', 'true', 'Pod'],
            ['services', 'svc', 'v1', 'true', 'Service'],
            ['deployments', 'deploy', 'apps/v1', 'true', 'Deployment'],
            ['replicasets', 'rs', 'apps/v1', 'true', 'ReplicaSet'],
          ],
        ),
      );
    default:
      if (NOT_SUPPORTED.includes(verb)) return fail([`(simulated) kubectl ${verb} is not available in the Playground yet.`], 'Edit the YAML file and run kubectl apply -f instead: that is the declarative way.');
      return fail([`error: unknown command "${verb}" for "kubectl"`], 'Type `help` to see the supported commands.');
  }
};

/** Candidates for Tab completion of the last word. */
export const completions = (input: string, ctx: ShellContext): string[] => {
  const tokens = tokenize(input);
  const endsWithSpace = /\s$/.test(input);
  const current = endsWithSpace ? '' : (tokens[tokens.length - 1] ?? '');
  const before = endsWithSpace ? tokens : tokens.slice(0, -1);
  const s = ctx.api.snapshot();
  let options: string[] = [];
  if (before.length === 0) options = ['kubectl', 'clear', 'help', 'ls', 'cat'];
  else if ((before[0] === 'kubectl' || before[0] === 'k') && before.length === 1) options = KUBECTL_VERBS;
  else if (before[before.length - 1] === '-f' || before[0] === 'cat') options = Object.keys(ctx.files);
  else if (before[0] === 'kubectl' || before[0] === 'k') {
    const verb = before[1];
    const args = before.slice(2).filter((t) => !t.startsWith('-'));
    if (['get', 'describe', 'delete'].includes(verb ?? '') && args.length === 0) options = ['pods', 'deployments', 'replicasets', 'services', 'configmaps', 'pvc', 'nodes', 'all', 'events', 'endpoints', 'pv'];
    else if (['get', 'describe', 'delete', 'scale'].includes(verb ?? '') && args.length === 1) {
      const kind = resourceType(args[0]!);
      if (kind && kind !== 'Node' && kind !== 'Namespace' && kind !== 'Event' && kind !== 'Endpoints' && kind !== 'PersistentVolume') options = listOf(s, kind, 'default').map((o) => o.metadata.name);
      else if (kind === 'Node') options = s.nodes.map((n) => n.name);
    } else if (['logs', 'exec'].includes(verb ?? '') && args.length === 0) options = objectsOf(s, 'Pod').map((o) => o.metadata.name);
    else if (verb === 'scale' && args.length === 0) options = ['deployment', 'replicaset'];
  }
  return options.filter((o) => o.startsWith(current) && o !== current);
};