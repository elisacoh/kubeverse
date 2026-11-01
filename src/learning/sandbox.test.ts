import { describe, expect, it } from 'vitest';
import { demoCluster } from '../domain/demoCluster';
import { EMPTY_WORLD, buildSandboxCluster } from './sandbox';
import { deriveActions } from './observe';

describe('sandbox cluster', () => {
  it('is empty before initialization', () => {
    const c = buildSandboxCluster(EMPTY_WORLD);
    expect(c.nodes).toEqual([]);
    expect(c.controlPlane).toEqual([]);
    expect(c.pods).toEqual([]);
  });

  it('models the control plane as several components on a control-plane Node, without Pods', () => {
    const c = buildSandboxCluster({ ...EMPTY_WORLD, initialized: true, workers: [] });
    expect(c.nodes.map((n) => [n.metadata.name, n.role])).toEqual([['control-plane-1', 'control-plane']]);
    expect(c.controlPlane.length).toBeGreaterThan(1);
    expect(c.controlPlane.every((x) => x.nodeName === 'control-plane-1')).toBe(true);
    expect(c.pods).toEqual([]);
    expect(c.workloads).toEqual([]);
  });

  it('adds worker Nodes with finite capacity and stable identifiers', () => {
    const a = buildSandboxCluster({ ...EMPTY_WORLD, initialized: true, workers: ['worker-1', 'worker-2'] });
    const b = buildSandboxCluster({ ...EMPTY_WORLD, initialized: true, workers: ['worker-1', 'worker-2'] });
    expect(a).toEqual(b);
    const workers = a.nodes.filter((n) => n.role === 'worker');
    expect(workers.map((n) => n.metadata.uid)).toEqual(['sandbox-node-worker-1', 'sandbox-node-worker-2']);
    for (const w of workers) {
      expect(w.capacity.cpuMillis).toBeGreaterThan(0);
      expect(w.capacity.memoryMiB).toBeGreaterThan(0);
    }
  });

  it('never touches the Explore demo cluster', () => {
    const before = JSON.stringify(demoCluster);
    buildSandboxCluster({ ...EMPTY_WORLD, initialized: true, workers: ['worker-1', 'worker-2'] });
    expect(JSON.stringify(demoCluster)).toBe(before);
  });
});

describe('deriveActions', () => {
  const cluster = buildSandboxCluster({ ...EMPTY_WORLD, initialized: true, workers: ['worker-1'] });

  it('maps picked Nodes to semantic entity kinds', () => {
    expect(deriveActions(cluster, null, { kind: 'node', id: 'control-plane-1', seq: 1 })).toEqual([
      { type: 'ENTITY_SELECTED', entityId: 'control-plane-1', entityKind: 'control-plane' },
    ]);
    expect(deriveActions(cluster, null, { kind: 'node', id: 'worker-1', seq: 2 })).toEqual([
      { type: 'ENTITY_SELECTED', entityId: 'worker-1', entityKind: 'worker-node' },
    ]);
  });

  it('emits again when the same entity is picked again, but not without a new pick', () => {
    const p1 = { kind: 'node' as const, id: 'worker-1', seq: 1 };
    expect(deriveActions(cluster, p1, p1)).toEqual([]);
    expect(deriveActions(cluster, p1, { ...p1, seq: 2 })).toHaveLength(1);
  });

  it('ignores entities that do not exist in the shown cluster', () => {
    expect(deriveActions(cluster, null, { kind: 'node', id: 'worker-aurora', seq: 3 })).toEqual([]);
  });
});
