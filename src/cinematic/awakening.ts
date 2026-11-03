import type { CreaturePose } from '../scene/creaturePose';
import { keyed, type CameraKey } from './tracks';

/**
 * "The Awakening" teaser script. Times are in seconds from the first frame.
 * Written so far: the awakening close-up (0–2 s), the pull-back onto its Node (2–4 s)
 * the control plane revealed by a rising light (4–7 s), the cluster coming to life (7–10 s)
 * and a pullback onto a whole universe of clusters (10–15 s).
 */

/** The hero: a storefront replica on worker-borealis, the Node closest to the default camera. */
export const HERO_POD = 'pod-storefront-q8v3n';
export const HERO_NODE = 'worker-borealis';

export const DURATION = 15;

/**
 * 'hero' keys are in the hero's local frame: origin at its feet, +Z the
 * direction it faces, face at roughly y 0.5. 'node' keys are relative to the
 * centre of its Node, whose walkable surface is at y 0.3; the hero stands at
 * about [-2.1, 0.3, -0.9] there, facing +Z.
 */
export const CAMERA_KEYS: CameraKey[] = [
  // 0–2 s: extreme close-up, a slow push-in while it wakes up.
  { t: 0, space: 'hero', position: [0.22, 0.62, 1.75], target: [0, 0.48, 0.2], fov: 30 },
  { t: 2, space: 'hero', position: [0.08, 0.56, 1.45], target: [0, 0.5, 0.25], fov: 30, rest: true },
  // 2–4 s: rise and pull back in an arc, until the whole floating Node and its other creatures are in view.
  { t: 3, space: 'node', position: [-3.4, 2.2, 3.6], target: [-1.8, 0.75, -0.6], fov: 32 },
  { t: 4, space: 'node', position: [-6.8, 5.2, 9.4], target: [-0.6, 0.4, -0.3], fov: 34, rest: true },
  // 4–7 s: a light rises behind the control plane; the camera swoops down behind the hero as it turns
  // to face it, then glides over the Node and settles low by the control plane's edge, looking up.
  { t: 5.3, space: 'world', position: [-3.2, 0.6, 15.5], target: [-0.6, 1.3, -5], fov: 40 },
  { t: 7, space: 'world', position: [2, 3.4, 4.8], target: [0, 5.1, -5.5], fov: 42, rest: true },
  // 7–10 s: rise beside the scheduler as its probes fly out, then open up onto the whole cluster.
  { t: 8.4, space: 'world', position: [7.5, 8.5, 6.5], target: [1, 3.2, -3], fov: 44 },
  { t: 10, space: 'world', position: [0, 13, 28], target: [0, 0.2, 5], fov: 50 },
  // 10–15 s: one long pullback until this cluster is a single light among many.
  { t: 12, space: 'world', position: [7, 30, 62], target: [0, -1, 2], fov: 52 },
  { t: 15, space: 'world', position: [-12, 64, 122], target: [0, -6, -22], fov: 48 },
];

/** The rest of the universe wakes outward from this cluster, as a wave travelling at this speed (units per second). */
export const REVEAL_START = 10.1;
export const REVEAL_SPEED = 48;
export const revealAt = (distance: number) => REVEAL_START + distance / REVEAL_SPEED;

/** Pushes the fog back as the camera pulls away, so the distant clusters read instead of dissolving. */
export const fogOpening = (t: number) => keyed([[10, 0], [12.6, 1]], t);

/** The closing title: fades in once the universe is revealed. */
export const titleLevel = (t: number) => keyed([[13.4, 0], [14.6, 1]], t);

/**
 * 7–10 s: the cluster comes to life. An artistic abstraction of the real flow,
 * where every exchange goes through the API server: the scheduler, watching
 * the API, sees a new Pod with no Node; it evaluates the worker Nodes and
 * records its choice (a binding) back in the API; each chosen Node's kubelet,
 * watching the API, picks its Pod up and has the container runtime start it.
 */
export const WORKERS = ['worker-aurora', 'worker-borealis', 'worker-cascade'] as const;

/** Named points, resolved from the real layout: 'apiserver', 'scheduler', 'node:<name>' or 'kubelet:<name>'. */
export type Point = 'apiserver' | 'scheduler' | `node:${string}` | `kubelet:${string}`;

/** watch: a component learns of a change through the API · probe: the scheduler evaluates a Node · bind: its decision. */
export type Tone = 'watch' | 'probe' | 'bind';

export interface Signal {
  from: Point;
  to: Point;
  t: number;
  duration: number;
  tone: Tone;
}

const stagger = (i: number) => i * 0.1;

export const SIGNALS: Signal[] = [
  { from: 'apiserver', to: 'scheduler', t: 7.1, duration: 0.4, tone: 'watch' },
  ...WORKERS.map((n, i): Signal => ({ from: 'scheduler', to: `node:${n}`, t: 7.5 + stagger(i), duration: 0.5, tone: 'probe' })),
  { from: 'scheduler', to: 'apiserver', t: 8.2, duration: 0.35, tone: 'bind' },
  ...WORKERS.map((n, i): Signal => ({ from: 'apiserver', to: `kubelet:${n}`, t: 8.5 + stagger(i), duration: 0.45, tone: 'watch' })),
];

/** The API server records the new Pod as the sequence begins. */
export const API_FLARE_AT = 7;

/** When each kubelet lights up: as the API's notification reaches it. */
export const kubeletFlareAt = (node: string) => {
  const s = SIGNALS.find((x) => x.to === `kubelet:${node}`)!;
  return s.t + s.duration;
};

/** When a new Pod materialises on a Node: once its kubelet has had the runtime start the container. */
export const podBirthAt = (node: string) => kubeletFlareAt(node) + 0.15;

/** The light behind the control plane: absent, rising from 4.3 s, full by 6.2 s. */
export const dawnLevel = (t: number) => keyed([[4.3, 0], [6.2, 1], [10.5, 1], [13.5, 0.3]], t);

/**
 * Sleeping, a twitch of the antenna, a lifted head, a sleepy blink, a look at
 * the camera; then a happy blink while its eyes follow the camera away; then
 * its antenna twitches at the rising light and it turns round to face it.
 */
export function heroPose(t: number, pose: CreaturePose): void {
  pose.droop = keyed([[0.9, 1], [1.5, 0]], t);
  pose.glow = keyed([[1.2, 1], [1.8, 0.25], [4.6, 0.25], [5.6, 0.8]], t);
  pose.eyes = keyed([[1.1, 0], [1.28, 0.55], [1.38, 0.1], [1.65, 1], [2.85, 1], [2.93, 0.1], [3.05, 1]], t);
  pose.gaze = keyed([[1.45, -0.4], [1.95, 0], [2.3, 0], [3.9, -0.38], [4.5, -0.38], [5.5, -2.5]], t);
  pose.antenna = keyed([[0.55, 0], [0.65, 0.5], [0.78, 0.15], [0.88, 0.15], [1.15, 1], [4.4, 1], [4.5, 0.6], [4.65, 1]], t);
}
