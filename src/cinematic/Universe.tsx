import { useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Euler,
  Float32BufferAttribute,
  Matrix4,
  Quaternion,
  Vector3,
  type Fog,
  type InstancedMesh,
  type ShaderMaterial,
} from 'three';
import { CONTROL_PLANE_POSITION, PLATFORM_TOP } from '../scene/layout';
import { namespaceColor, palette } from '../scene/palette';
import { seededRandom } from '../scene/random';
import { APISERVER_ORB_HEIGHT } from '../scene/entities/ControlPlaneStructures';
import { clamp01 } from './tracks';
import { fogOpening, revealAt } from './awakening';

type Time = MutableRefObject<number>;

/**
 * Cinematic-only: the wider universe revealed by the final pullback. Purely
 * decorative and generated from a fixed seed, it never touches the simulated
 * cluster. Every repeated shape is a single instanced draw, and the farthest
 * clusters are only points of light.
 */

interface Placed {
  p: Vector3;
  scale: number;
  reveal: number;
  color?: Color;
}

interface Link {
  a: Vector3;
  c: Vector3;
  b: Vector3;
  reveal: number;
}

interface Glow {
  p: Vector3;
  color: Color;
  size: number;
  reveal: number;
}

const CLUSTERS = 16;
const FAR_CLUMPS = 46;
const ARC_STEPS = 14;

const API_SERVER = new Vector3(
  CONTROL_PLANE_POSITION[0],
  CONTROL_PLANE_POSITION[1] + PLATFORM_TOP + APISERVER_ORB_HEIGHT,
  CONTROL_PLANE_POSITION[2],
);

const NODE_ACCENTS = [palette.teal, palette.cyan, palette.lavender].map((c) => new Color(c));
const POD_COLORS = Object.values(namespaceColor).map((c) => new Color(c));

const arcBetween = (a: Vector3, b: Vector3, reveal: number): Link => {
  const c = a.clone().lerp(b, 0.5);
  c.y += 2 + a.distanceTo(b) * 0.12;
  return { a, c, b, reveal };
};

const arcPoint = (l: Link, u: number, out: Vector3) => {
  const v = 1 - u;
  return out
    .copy(l.a)
    .multiplyScalar(v * v)
    .addScaledVector(l.c, 2 * v * u)
    .addScaledVector(l.b, u * u);
};

function generate() {
  const rnd = seededRandom('kubeverse-universe');
  const hubs: Placed[] = [];
  const platforms: Placed[] = [];
  const pods: Placed[] = [];
  const links: Link[] = [];
  const glows: Glow[] = [];
  const gold = new Color(palette.gold);

  for (let i = 0; i < CLUSTERS; i++) {
    // The nearest cluster sits on the camera's side, so the pullback sweeps over it.
    const a = i === 0 ? 2.35 : i * 2.39996 + rnd() * 0.5;
    const r = 40 + Math.pow((i + 0.5) / CLUSTERS, 0.8) * 120 + rnd() * 8;
    const hub = new Vector3(Math.cos(a) * r, -10 + rnd() * 18, Math.sin(a) * r - 6);
    const hubReveal = revealAt(hub.length());
    hubs.push({ p: hub, scale: 5 + rnd() * 1.2, reveal: hubReveal });
    glows.push({ p: hub.clone().add(new Vector3(0, 3.2, 0)), color: gold, size: 9, reveal: hubReveal });

    const workers = 3 + Math.floor(rnd() * 3);
    const turn = rnd() * Math.PI * 2;
    for (let w = 0; w < workers; w++) {
      const wa = turn + (w / workers) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
      const wd = 11 + rnd() * 4;
      const p = hub.clone().add(new Vector3(Math.cos(wa) * wd, -1.5 + rnd() * 3, Math.sin(wa) * wd));
      const radius = 3 + rnd() * 1.3;
      const reveal = revealAt(p.length());
      const accent = NODE_ACCENTS[Math.floor(rnd() * NODE_ACCENTS.length)]!;
      platforms.push({ p, scale: radius, reveal, color: accent });
      links.push(arcBetween(hub.clone().add(new Vector3(0, 3.2, 0)), p.clone().add(new Vector3(0, 0.6, 0)), reveal));
      glows.push({ p: p.clone().add(new Vector3(radius * 0.7, 1.2, 0)), color: NODE_ACCENTS[1]!, size: 3.5, reveal: reveal + 0.2 });

      const count = 3 + Math.floor(rnd() * 4);
      for (let k = 0; k < count; k++) {
        const pa = (k / count) * Math.PI * 2 + rnd() * 0.4;
        const pr = radius * (0.35 + rnd() * 0.3);
        pods.push({
          p: p.clone().add(new Vector3(Math.cos(pa) * pr, 0.62, Math.sin(pa) * pr)),
          scale: 0.42 + rnd() * 0.1,
          reveal: reveal + 0.15 + k * 0.06,
          color: POD_COLORS[Math.floor(rnd() * POD_COLORS.length)]!,
        });
      }
    }
  }

  // Each control plane talks to its two nearest neighbours; this cluster to the closest three.
  hubs.forEach((h, i) => {
    hubs
      .map((o, j) => ({ j, d: o.p.distanceTo(h.p) }))
      .filter((o) => o.j > i && o.d < 75)
      .sort((x, y) => x.d - y.d)
      .slice(0, 2)
      .forEach(({ j }) => {
        const o = hubs[j]!;
        links.push(arcBetween(h.p.clone().setY(h.p.y + 3.2), o.p.clone().setY(o.p.y + 3.2), Math.max(h.reveal, o.reveal)));
      });
  });
  [...hubs]
    .sort((x, y) => x.p.length() - y.p.length())
    .slice(0, 3)
    .forEach((h) => links.push(arcBetween(API_SERVER, h.p.clone().setY(h.p.y + 3.2), h.reveal)));

  // Beyond them, more clusters too far away to be anything but clusters of light.
  const far = seededRandom('kubeverse-far');
  for (let i = 0; i < FAR_CLUMPS; i++) {
    // Spread over the far side, where the final shot looks.
    const a = Math.PI * (0.92 + far() * 1.16);
    const r = 175 + far() * 230;
    const centre = new Vector3(Math.cos(a) * r, -32 + far() * 40, Math.sin(a) * r - 30);
    // Too far for the wave to reach in time: they kindle in quick succession as the pullback ends.
    const reveal = 12.2 + ((r - 175) / 230) * 1.8;
    glows.push({ p: centre, color: gold, size: 30, reveal });
    for (let k = 0; k < 14; k++) {
      const off = new Vector3(far() - 0.5, (far() - 0.5) * 0.3, far() - 0.5).multiplyScalar(26);
      glows.push({
        p: centre.clone().add(off),
        color: k % 3 === 0 ? NODE_ACCENTS[2]! : NODE_ACCENTS[1]!,
        size: 9 + far() * 8,
        reveal: reveal + far() * 0.4,
      });
    }
  }

  return { hubs, platforms, pods, links, glows };
}

const easeOutBack = (x: number) => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2);
const grow = (t: number, reveal: number) => {
  const u = clamp01((t - reveal) / 0.55);
  return u <= 0 ? 0 : easeOutBack(u);
};

export function Universe({ time }: { time: Time }) {
  const world = useMemo(generate, []);
  const opened = useRef(-1);

  useFrame(({ scene }) => {
    const k = fogOpening(time.current);
    if (k === opened.current) return;
    opened.current = k;
    const fog = scene.fog as Fog | null;
    if (fog) {
      fog.near = 45 + k * 110;
      fog.far = 120 + k * 330;
    }
  });

  return (
    <group raycast={() => null}>
      <Instances items={world.platforms} time={time} shape="platform" />
      <Instances items={world.platforms} time={time} shape="rim" />
      <Instances items={world.platforms} time={time} shape="rock" />
      <Instances items={world.hubs} time={time} shape="hub" />
      <Instances items={world.hubs} time={time} shape="hubRim" />
      <Instances items={world.hubs} time={time} shape="hubRock" />
      <Instances items={world.pods} time={time} shape="pod" />
      <Links links={world.links} time={time} />
      <Pulses links={world.links} time={time} />
      <Glows glows={world.glows} time={time} />
    </group>
  );
}

type Shape = 'platform' | 'rim' | 'rock' | 'hub' | 'hubRim' | 'hubRock' | 'pod';

const FLAT = new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0));
const HEX_FLAT = new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0)).multiply(FLAT);
const UPSIDE_DOWN = new Quaternion().setFromEuler(new Euler(Math.PI, 0, 0));
const UPRIGHT = new Quaternion();

/** Per-shape orientation, proportions and height offset, relative to the item's scale (its radius). */
const SHAPE: Record<Shape, { q: Quaternion; s: (r: number) => [number, number, number]; y: (r: number) => number }> = {
  platform: { q: UPRIGHT, s: (r) => [r, 1, r], y: () => 0 },
  rim: { q: FLAT, s: (r) => [r, r, 1], y: () => 0.2 },
  rock: { q: UPSIDE_DOWN, s: (r) => [r * 0.8, r * 0.4, r * 0.8], y: (r) => -0.2 - r * 0.6 },
  hub: { q: UPRIGHT, s: (r) => [r, 1, r], y: () => 0 },
  hubRim: { q: HEX_FLAT, s: (r) => [r, r, 1], y: () => 0.23 },
  hubRock: { q: UPSIDE_DOWN, s: (r) => [r * 0.85, r * 0.45, r * 0.85], y: (r) => -0.22 - r * 0.765 },
  pod: { q: UPRIGHT, s: (r) => [r, r * 0.92, r], y: () => 0 },
};

function ShapeGeometry({ shape }: { shape: Shape }) {
  switch (shape) {
    case 'platform':
      return <cylinderGeometry args={[1, 1, 0.4, 28]} />;
    case 'rim':
      return <torusGeometry args={[1, 0.04, 5, 48]} />;
    case 'rock':
      return <coneGeometry args={[1, 3, 7]} />;
    case 'hub':
      return <cylinderGeometry args={[1, 1, 0.45, 6]} />;
    case 'hubRim':
      return <torusGeometry args={[1, 0.05, 5, 6]} />;
    case 'hubRock':
      return <coneGeometry args={[1, 3.4, 6]} />;
    case 'pod':
      return <sphereGeometry args={[1, 14, 10]} />;
  }
}

function ShapeMaterial({ shape }: { shape: Shape }) {
  switch (shape) {
    case 'platform':
      return <meshStandardMaterial color={palette.surface} emissive={palette.deep} emissiveIntensity={0.6} roughness={0.8} />;
    case 'hub':
      return <meshStandardMaterial color="#8f8cd8" emissive={palette.slate} emissiveIntensity={0.5} roughness={0.7} />;
    case 'rock':
    case 'hubRock':
      return <meshStandardMaterial color={palette.rock} flatShading roughness={1} />;
    case 'rim':
      return <meshBasicMaterial toneMapped={false} />;
    case 'hubRim':
      return <meshBasicMaterial color={palette.gold} toneMapped={false} />;
    case 'pod':
      return <meshStandardMaterial roughness={0.35} emissive="#1d2a55" emissiveIntensity={0.5} />;
  }
}

/** Shapes that take each item's own colour (a Node's accent, a Pod's namespace). */
const TINTED = new Set<Shape>(['rim', 'pod']);

const tmpMatrix = new Matrix4();
const tmpPos = new Vector3();
const tmpScale = new Vector3();

/** One instanced draw per shape; each instance pops in as the reveal wave reaches it. */
function Instances({ items, time, shape }: { items: Placed[]; time: Time; shape: Shape }) {
  const mesh = useRef<InstancedMesh>(null);
  const last = useRef(-1);
  const { q, s, y } = SHAPE[shape];

  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m || !TINTED.has(shape)) return;
    items.forEach((it, i) => {
      if (it.color) m.setColorAt(i, it.color);
    });
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [items, shape]);

  useFrame(() => {
    const m = mesh.current;
    const t = time.current;
    if (!m || t === last.current) return;
    last.current = t;
    items.forEach((it, i) => {
      const g = Math.max(grow(t, it.reveal), 0.0001);
      const [sx, sy, sz] = s(it.scale);
      tmpPos.set(it.p.x, it.p.y + y(it.scale) * g, it.p.z);
      tmpMatrix.compose(tmpPos, q, tmpScale.set(sx * g, sy * g, sz * g));
      m.setMatrixAt(i, tmpMatrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, items.length]} frustumCulled={false}>
      <ShapeGeometry shape={shape} />
      <ShapeMaterial shape={shape} />
    </instancedMesh>
  );
}

const linkVertex = /* glsl */ `
  attribute float reveal;
  attribute float along;
  uniform float time;
  varying float vAlpha;
  void main() {
    float drawn = clamp((time - reveal) / 0.7, 0.0, 1.0);
    vAlpha = step(along, drawn) * step(0.0001, drawn);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const linkFragment = /* glsl */ `
  uniform vec3 color;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(color, vAlpha * 0.32);
  }
`;

/** Faint arcs between control planes and their Nodes, drawn on as the wave passes. */
function Links({ links, time }: { links: Link[]; time: Time }) {
  const material = useRef<ShaderMaterial>(null);
  const geometry = useMemo(() => {
    const pos: number[] = [];
    const reveal: number[] = [];
    const along: number[] = [];
    const a = new Vector3();
    const b = new Vector3();
    for (const l of links) {
      for (let s = 0; s < ARC_STEPS; s++) {
        arcPoint(l, s / ARC_STEPS, a);
        arcPoint(l, (s + 1) / ARC_STEPS, b);
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
        reveal.push(l.reveal, l.reveal);
        along.push(s / ARC_STEPS, (s + 1) / ARC_STEPS);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('reveal', new Float32BufferAttribute(reveal, 1));
    g.setAttribute('along', new Float32BufferAttribute(along, 1));
    return g;
  }, [links]);
  const uniforms = useMemo(() => ({ time: { value: 0 }, color: { value: new Color(palette.cyan) } }), []);

  useFrame(() => {
    if (material.current) material.current.uniforms.time!.value = time.current;
  });

  return (
    <lineSegments geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        vertexShader={linkVertex}
        fragmentShader={linkFragment}
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </lineSegments>
  );
}

/** One bead of light per link, endlessly carrying the universe's API traffic. */
function Pulses({ links, time }: { links: Link[]; time: Time }) {
  const mesh = useRef<InstancedMesh>(null);
  const p = useMemo(() => new Vector3(), []);
  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const t = time.current;
    links.forEach((l, i) => {
      const live = t - l.reveal - 0.7;
      const u = (live * 0.45 + (i * 0.37) % 1) % 1;
      arcPoint(l, u, p);
      const s = live > 0 ? Math.min(1, live * 3) * 0.32 : 0.0001;
      tmpMatrix.compose(p, UPRIGHT, tmpScale.setScalar(s));
      m.setMatrixAt(i, tmpMatrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, links.length]} frustumCulled={false}>
      <sphereGeometry args={[1, 8, 6]} />
      <meshBasicMaterial color={palette.cyan} transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
    </instancedMesh>
  );
}

const glowVertex = /* glsl */ `
  attribute float size;
  attribute float reveal;
  attribute vec3 tint;
  uniform float time;
  uniform float pixelRatio;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = tint;
    vAlpha = clamp((time - reveal) / 0.5, 0.0, 1.0);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * pixelRatio * (300.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const glowFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float g = pow(max(1.0 - r, 0.0), 2.4) + pow(max(1.0 - r, 0.0), 10.0);
    gl_FragColor = vec4(vColor, g * vAlpha * 0.9);
  }
`;

/** Soft points of light: the control planes and kubelets nearby, whole clusters far away. */
function Glows({ glows, time }: { glows: Glow[]; time: Time }) {
  const material = useRef<ShaderMaterial>(null);
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(glows.flatMap((x) => [x.p.x, x.p.y, x.p.z]), 3));
    g.setAttribute('tint', new Float32BufferAttribute(glows.flatMap((x) => [x.color.r, x.color.g, x.color.b]), 3));
    g.setAttribute('size', new Float32BufferAttribute(glows.map((x) => x.size), 1));
    g.setAttribute('reveal', new Float32BufferAttribute(glows.map((x) => x.reveal), 1));
    return g;
  }, [glows]);
  const uniforms = useMemo(() => ({ time: { value: 0 }, pixelRatio: { value: 1 } }), []);

  useFrame(({ gl }) => {
    const u = material.current?.uniforms;
    if (!u) return;
    u.time!.value = time.current;
    u.pixelRatio!.value = gl.getPixelRatio();
  });

  return (
    <points geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        vertexShader={glowVertex}
        fragmentShader={glowFragment}
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </points>
  );
}
