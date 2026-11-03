export type Vec3 = [number, number, number];

/** Where a camera keyframe's coordinates live: the world, or the local frame of a named anchor. */
export type Space = 'world' | (string & {});

export interface CameraKey {
  t: number;
  position: Vec3;
  target: Vec3;
  fov: number;
  space: Space;
  /** The camera settles on this key (zero velocity), e.g. where a move reverses. The last key always does. */
  rest?: boolean;
}

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export const smoothstep = (a: number, b: number, x: number) => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};

/** Piecewise value through (time, value) points, smoothed between each pair. */
export const keyed = (points: readonly (readonly [number, number])[], t: number): number => {
  const first = points[0]!;
  if (t <= first[0]) return first[1];
  for (let i = 1; i < points.length; i++) {
    const [t1, v1] = points[i]!;
    const [t0, v0] = points[i - 1]!;
    if (t <= t1) return v0 + (v1 - v0) * smoothstep(t0, t1, t);
  }
  return points.at(-1)![1];
};

/** Velocity at key i, per second: zero when resting, else from its neighbours (time-aware Catmull-Rom). */
const velocity = (keys: readonly CameraKey[], i: number, get: (k: CameraKey) => number): number => {
  const k = keys[i]!;
  const last = keys.length - 1;
  if (k.rest || i === last) return 0;
  const prev = keys[Math.max(0, i - 1)]!;
  const next = keys[Math.min(last, i + 1)]!;
  return (get(next) - get(prev)) / (next.t - prev.t);
};

const hermite = (p0: number, m0: number, p1: number, m1: number, u: number, dt: number) => {
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * dt * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * dt * m1;
};

const CHANNELS: ((k: CameraKey) => number)[] = [
  (k) => k.position[0],
  (k) => k.position[1],
  (k) => k.position[2],
  (k) => k.target[0],
  (k) => k.target[1],
  (k) => k.target[2],
  (k) => k.fov,
];

/** Samples a smooth path through already world-space keys; the camera flows through keys unless they rest. */
export function sampleKeys(keys: readonly CameraKey[], t: number): { position: Vec3; target: Vec3; fov: number } {
  const n = keys.length;
  if (n === 1 || t <= keys[0]!.t) return keys[0]!;
  if (t >= keys[n - 1]!.t) return keys[n - 1]!;
  let i = 0;
  while (keys[i + 1]!.t < t) i++;
  const a = keys[i]!;
  const b = keys[i + 1]!;
  const dt = b.t - a.t;
  const u = (t - a.t) / dt;
  const [px, py, pz, tx, ty, tz, fov] = CHANNELS.map((get) =>
    hermite(get(a), velocity(keys, i, get), get(b), velocity(keys, i + 1, get), u, dt),
  ) as [number, number, number, number, number, number, number];
  return { position: [px, py, pz], target: [tx, ty, tz], fov };
}
