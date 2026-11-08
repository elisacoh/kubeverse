import { describe, expect, it } from 'vitest';
import { LESSONS, lessonById } from './index';
import { startingPoint } from './startingPoint';
import { runCommand } from '../kubectl/run';
import { SimulatedCluster } from '../sim/backend';
import { settle } from '../sim/cluster';

const objectsFor = (id: string, api = new SimulatedCluster()) => startingPoint(lessonById(id)!, api.snapshot()).flatMap((a) => a.objects);

describe('startingPoint', () => {
  it('adds nothing before the first lessons', () => {
    expect(objectsFor('yaml-basics')).toEqual([]);
    expect(objectsFor('first-pod')).toEqual([]);
  });

  it("leaves objects a lesson's own setup provides to that setup", () => {
    expect(objectsFor('labels')).toEqual([]);
    expect(objectsFor('scaling')).not.toContain('deployment/frontend');
    expect(objectsFor('service')).not.toContain('deployment/frontend');
  });

  it('brings in the latest version of what earlier lessons built', () => {
    expect(objectsFor('deployment')).toEqual(['pod/hello-pod', 'replicaset/web-rs']);
    const l02 = startingPoint(lessonById('deployment')!, new SimulatedCluster().snapshot())[0]!;
    expect(l02.from.id).toBe('labels');
  });

  it('skips what the cluster already has', async () => {
    const api = new SimulatedCluster();
    for (const a of startingPoint(lessonById('deployment')!, api.snapshot())) await runCommand(`kubectl apply -f ${a.file}`, { api, files: { [a.file]: a.text } });
    expect(objectsFor('deployment', api)).toEqual([]);
  });

  it('builds a cluster where every earlier pod gets scheduled, up to the last lesson', async () => {
    const api = new SimulatedCluster();
    const last = LESSONS[LESSONS.length - 1]!;
    for (const a of startingPoint(last, api.snapshot())) {
      expect((await runCommand(`kubectl apply -f ${a.file}`, { api, files: { [a.file]: a.text } })).ok, a.file).toBe(true);
    }
    api.load(settle(api.snapshot()));
    const pods = api.snapshot().objects.filter((o) => o.kind === 'Pod');
    expect(pods.length).toBeGreaterThan(5);
    for (const p of pods) expect((p as { status: { phase: string } }).status.phase, p.metadata.name).toBe('Running');
  });
});
