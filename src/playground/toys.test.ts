import { describe, expect, it } from 'vitest';
import { emptyProgress, type ProgressMap } from './curriculum/progress';
import { toyCommand } from './toys';

const PET = 'name: Mochi\nage: 3\ntoys:\n  - ball\n  - feather\nowner:\n  city: Lisbon\n';
const done: ProgressMap = { 'yaml-basics': { ...emptyProgress(), done: ['what', 'indent-quiz', 'pet'] } };

describe('toyCommand', () => {
  it('ignores commands that are not about a toy file', () => {
    expect(toyCommand('kubectl apply -f pod.yaml', { files: { 'pod.yaml': '' }, progress: done, toy: null })).toBeNull();
    expect(toyCommand('kubectl get pods', { files: {}, progress: done, toy: null })).toBeNull();
  });

  it('adds a hint to the usual error until the exercise is done and valid', () => {
    const notDone = toyCommand('kubectl apply -f pet.yaml', { files: { 'pet.yaml': PET }, progress: {}, toy: null });
    expect(notDone && 'hint' in notDone).toBe(true);
    const invalid = toyCommand('kubectl apply -f pet.yaml', { files: { 'pet.yaml': 'name: Mochi\n' }, progress: done, toy: null });
    expect(invalid && 'hint' in invalid).toBe(true);
  });

  it('creates, reconfigures and deletes the cat once the exercise is done', () => {
    const created = toyCommand('k apply -f pet.yaml', { files: { 'pet.yaml': PET }, progress: done, toy: null });
    if (!created || !('result' in created) || !created.toy) throw new Error('expected a cat');
    expect(created.result.lines[0]?.text).toBe('cat/mochi created');
    expect(created.result.effects).toEqual([]);
    expect(created.toy.fields).toMatchObject({ name: 'Mochi', age: 3, owner: { city: 'Lisbon' } });

    const same = toyCommand('kubectl apply -f pet.yaml', { files: { 'pet.yaml': PET }, progress: done, toy: created.toy });
    expect(same && 'result' in same && same.result.lines[0]?.text).toBe('cat/mochi unchanged');

    const grey = toyCommand('kubectl apply -f pet.yaml', { files: { 'pet.yaml': `${PET}color: grey\n` }, progress: done, toy: created.toy });
    expect(grey && 'result' in grey && grey.result.lines[0]?.text).toBe('cat/mochi configured');

    const deleted = toyCommand('kubectl delete -f pet.yaml', { files: { 'pet.yaml': PET }, progress: done, toy: created.toy });
    expect(deleted && 'result' in deleted && deleted.toy).toBeNull();
    expect(toyCommand('kubectl delete -f pet.yaml', { files: { 'pet.yaml': PET }, progress: done, toy: null })).toBeNull();
  });
});
