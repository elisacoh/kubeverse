import { describe, expect, it } from 'vitest';
import { docPath, pathAtOffset } from './yamlPath';

const POD = `apiVersion: v1
kind: Pod
metadata:
  name: hello-pod
spec:
  containers:
    - name: web
      image: nginx:stable
`;

const at = (text: string, needle: string, delta = 0) => pathAtOffset(text, text.indexOf(needle) + delta);

describe('pathAtOffset', () => {
  it('finds keys and values with their kind', () => {
    expect(at(POD, 'kind')).toMatchObject({ path: ['kind'], kind: 'Pod' });
    expect(at(POD, 'hello-pod')?.path).toEqual(['metadata', 'name']);
    expect(at(POD, 'image', 2)?.path).toEqual(['spec', 'containers', 0, 'image']);
    expect(docPath(at(POD, 'nginx')!.path)).toBe('spec.containers.image');
  });

  it('works per document in multi-document files', () => {
    const text = `${POD}---\napiVersion: v1\nkind: Service\nmetadata:\n  name: web\nspec:\n  selector:\n    app: web\n`;
    expect(at(text, 'selector')).toMatchObject({ path: ['spec', 'selector'], kind: 'Service' });
  });

  it('tolerates incomplete YAML while typing', () => {
    expect(at('apiVersion: v1\nkind: Pod\nmetadata:\n  na', 'na')?.path[0]).toBe('metadata');
  });
});
