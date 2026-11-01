import { describe, expect, it } from 'vitest';
import { buildManifest, toYaml } from './manifest';
import { EMPTY_WORLD, buildSandboxCluster } from '../learning/sandbox';
import { staticDemoSource } from '../simulation/staticDemoSource';

describe('toYaml', () => {
  it('serializes nested maps and lists, quoting ambiguous scalars', () => {
    expect(
      toYaml({
        a: { b: '4', c: 'x', empty: '' },
        list: [{ name: 'n', ports: [{ p: 80 }] }, 'plain'],
        none: [],
        skipped: undefined,
        when: '2026-11-01T00:00:00Z',
      }),
    ).toBe(
      [
        'a:',
        '  b: "4"',
        '  c: x',
        '  empty: ""',
        'list:',
        '- name: n',
        '  ports:',
        '  - p: 80',
        '- plain',
        'none: []',
        'when: "2026-11-01T00:00:00Z"',
        '',
      ].join('\n'),
    );
  });
});

describe('buildManifest', () => {
  const sandbox = buildSandboxCluster({ ...EMPTY_WORLD, initialized: true, workers: ['worker-1'] });
  const demo = staticDemoSource.snapshot();

  it('renders a Node with its capacity and taints', () => {
    const m = buildManifest(sandbox, { kind: 'node', name: 'control-plane-1' });
    expect(m?.source).toBe('Node/control-plane-1');
    expect(m?.yaml).toContain('kind: Node');
    expect(m?.yaml).toContain('effect: NoSchedule');
    expect(m?.yaml).toMatch(/capacity:\n {4}cpu: "4"\n {4}memory: 8Gi/);
  });

  it('renders every demo Pod, component and container', () => {
    for (const pod of demo.pods) {
      const m = buildManifest(demo, { kind: 'pod', uid: pod.metadata.uid });
      expect(m?.yaml).toContain(`name: ${pod.metadata.name}`);
      for (const c of pod.containers) {
        expect(buildManifest(demo, { kind: 'container', podUid: pod.metadata.uid, name: c.name })?.yaml).toContain(
          `name: ${c.name}`,
        );
      }
    }
    for (const c of demo.controlPlane) {
      if (c.runsAs === 'static-pod') expect(buildManifest(demo, { kind: 'component', uid: c.uid })).not.toBeNull();
    }
  });

  it('shows the on-disk static Pod file when a component has no mirror Pod', () => {
    const m = buildManifest(sandbox, { kind: 'component', uid: 'sandbox-cpc-etcd' });
    expect(m?.source).toBe('control-plane-1:/etc/kubernetes/manifests/etcd.yaml');
    expect(m?.yaml).toContain('hostNetwork: true');
  });

  it('returns null for unknown objects', () => {
    expect(buildManifest(sandbox, { kind: 'node', name: 'nope' })).toBeNull();
  });
});
