import { describe, expect, it } from 'vitest';
import { keyed, sampleKeys, type CameraKey } from './tracks';

const key = (t: number, z: number, rest = false): CameraKey => ({
  t,
  space: 'world',
  position: [0, 0, z],
  target: [0, 0, 0],
  fov: 30,
  rest,
});

describe('sampleKeys', () => {
  it('passes through every key and holds outside the range', () => {
    const keys = [key(0, 2), key(2, 1, true), key(3, 4), key(4, 10)];
    for (const k of keys) expect(sampleKeys(keys, k.t).position[2]).toBeCloseTo(k.position[2]);
    expect(sampleKeys(keys, -1).position[2]).toBe(2);
    expect(sampleKeys(keys, 9).position[2]).toBe(10);
  });

  it('does not overshoot a resting key where the move reverses', () => {
    const keys = [key(0, 2), key(2, 1, true), key(3, 4), key(4, 10)];
    for (let t = 0; t <= 4; t += 0.05) expect(sampleKeys(keys, t).position[2]).toBeGreaterThanOrEqual(1 - 1e-9);
  });

  it('keeps moving through a key that does not rest', () => {
    const keys = [key(0, 0), key(1, 1), key(2, 2)];
    const before = sampleKeys(keys, 0.99).position[2];
    const after = sampleKeys(keys, 1.01).position[2];
    expect(after - before).toBeCloseTo(0.02, 2);
  });
});

describe('keyed', () => {
  it('holds the first and last values and blends between points', () => {
    const points = [[1, 0], [2, 1]] as const;
    expect(keyed(points, 0)).toBe(0);
    expect(keyed(points, 1.5)).toBeCloseTo(0.5);
    expect(keyed(points, 3)).toBe(1);
  });
});
