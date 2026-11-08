import { describe, expect, it } from 'vitest';
import { parseYaml, readManifests, validateObject } from './manifest';
import { lookupField } from './schema';

const issuesOf = (yaml: string) => readManifests(yaml).issues;

describe('YAML syntax', () => {
  it('reports tabs and bad indentation as syntax errors with a line', () => {
    const issues = parseYaml('apiVersion: v1\nkind: Pod\nmetadata:\n\tname: x\n').issues;
    expect(issues[0]?.level).toBe('syntax');
    expect(issues[0]?.line).toBe(4);
  });

  it('reports duplicate keys', () => {
    const issues = parseYaml('kind: Pod\nkind: Service\n').issues;
    expect(issues[0]?.level).toBe('syntax');
  });

  it('accepts several documents', () => {
    expect(parseYaml('a: 1\n---\nb: 2\n').docs).toHaveLength(2);
  });
});

describe('schema validation', () => {
  it('flags unknown fields with a suggestion and the right line', () => {
    const issues = issuesOf('apiVersion: v1\nkind: Pod\nmetadata:\n  name: p\nspec:\n  contaners:\n    - name: a\n      image: nginx\n');
    const unknown = issues.find((i) => i.message.includes('unknown field "contaners"'));
    expect(unknown?.level).toBe('schema');
    expect(unknown?.hint).toMatch(/containers/);
    expect(unknown?.line).toBe(6);
  });

  it('flags missing required fields', () => {
    const issues = issuesOf('apiVersion: v1\nkind: Pod\nmetadata:\n  name: p\nspec:\n  containers:\n    - name: a\n');
    expect(issues.some((i) => i.message.includes('missing required field "image"'))).toBe(true);
  });

  describe('while a manifest is written top to bottom', () => {
    const pendingOf = (yaml: string) => {
      const doc = parseYaml(yaml).docs[0]!;
      const { issues } = validateObject(doc.value, doc.lineOf);
      return { pending: [...new Set(issues.flatMap((i) => (i.pending ? [i.pending] : [])))], real: issues.filter((i) => !i.pending).map((i) => i.message) };
    };

    it('treats fields not reached yet as still to write, not as errors', () => {
      expect(pendingOf('# pod.yaml\napiVersion: "v1"\nkind: "Pod"\n')).toEqual({ pending: ['metadata', 'spec'], real: [] });
      expect(pendingOf('apiVersion: v1\n').pending).toEqual(['kind']);
      expect(pendingOf('apiVersion: v1\nkind: Pod\nmetadata:\n').pending).toEqual(['metadata', 'spec']);
      expect(pendingOf('apiVersion: v1\nkind: Pod\nmetadata:\n  name: p\nspec:\n  containers:\n    - name: a\n')).toEqual({ pending: ['spec.containers[0].image'], real: [] });
    });

    it('flags a field skipped: one that comes after it is already written', () => {
      const r = pendingOf('apiVersion: v1\nkind: Pod\nspec:\n  containers:\n    - name: a\n      image: nginx\n');
      expect(r.pending).toEqual([]);
      expect(r.real.some((m) => m.includes('missing required field "metadata"'))).toBe(true);
      expect(pendingOf('kind: Pod\nmetadata:\n  name: p\n').real).toContain('apiVersion not set');
    });

    it('flags a field forgotten in a mapping the learner has moved past', () => {
      const r = pendingOf('apiVersion: v1\nkind: Pod\nmetadata:\n  name: p\nspec:\n  containers:\n    - name: a\n  restartPolicy: Always\n');
      expect(r.real.some((m) => m.includes('missing required field "image"'))).toBe(true);
      expect(pendingOf('apiVersion: v1\nkind: Pod\nmetadata:\nspec:\n  containers: []\n').real.some((m) => m.startsWith('metadata: expected a mapping'))).toBe(true);
    });
  });

  it('rejects a wrong apiVersion for the kind', () => {
    const issues = issuesOf('apiVersion: v1\nkind: Deployment\nmetadata:\n  name: d\n');
    expect(issues[0]?.message).toMatch(/no matches for kind "Deployment" in version "v1"/);
  });

  it('rejects a selector that does not match the template labels', () => {
    const issues = issuesOf(`apiVersion: apps/v1
kind: ReplicaSet
metadata:
  name: rs
spec:
  replicas: 2
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: api
    spec:
      containers:
        - name: a
          image: nginx
`);
    expect(issues.some((i) => i.message.includes('`selector` does not match template `labels`'))).toBe(true);
  });

  it('rejects requests above limits and non-string label values', () => {
    expect(issuesOf('apiVersion: v1\nkind: Pod\nmetadata:\n  name: p\nspec:\n  containers:\n    - name: a\n      image: nginx\n      resources:\n        requests:\n          cpu: "2"\n        limits:\n          cpu: "1"\n').some((i) => i.message.includes('must be less than or equal to cpu limit'))).toBe(true);
    expect(issuesOf('apiVersion: v1\nkind: Pod\nmetadata:\n  name: p\n  labels:\n    version: 1\nspec:\n  containers:\n    - name: a\n      image: nginx\n').some((i) => i.message.includes('must be a string'))).toBe(true);
  });

  it('accepts equivalent manifests regardless of formatting and order', () => {
    const a = 'apiVersion: v1\nkind: Pod\nmetadata:\n  name: p\nspec:\n  containers:\n    - name: a\n      image: nginx\n';
    const b = 'kind: Pod\nspec:\n    containers:\n    -   image: "nginx"\n        name: a\nmetadata: {name: p}\napiVersion: "v1"\n';
    expect(readManifests(a).issues).toEqual([]);
    expect(readManifests(b).issues).toEqual([]);
    expect(readManifests(a).objects[0]!.desired).toEqual(readManifests(b).objects[0]!.desired);
  });

  it('validates a document without a kind', () => {
    expect(validateObject({ foo: 1 }).issues[0]?.message).toMatch(/apiVersion not set/);
  });
});

describe('field documentation', () => {
  it('is context-aware: selector means different things on a Service and a Deployment', () => {
    const svc = lookupField('Service', ['spec', 'selector']);
    const dep = lookupField('Deployment', ['spec', 'selector']);
    expect(svc?.field.node.type).toBe('map');
    expect(dep?.field.node.type).toBe('object');
    expect(svc?.field.doc.summary).not.toBe(dep?.field.doc.summary);
  });

  it('resolves nested fields through lists', () => {
    expect(lookupField('Deployment', ['spec', 'template', 'spec', 'containers', 0, 'resources', 'limits'])?.parentType).toBe('ResourceRequirements');
    expect(lookupField('Pod', ['spec', 'containers', 0, 'image'])?.field.doc.summary).toMatch(/image/i);
  });
});
