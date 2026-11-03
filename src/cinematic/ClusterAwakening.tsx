import { useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  QuadraticBezierCurve3,
  Vector3,
  type Group,
  type Mesh,
  type MeshBasicMaterial,
  type ShaderMaterial,
} from 'three';
import type { Cluster, Pod } from '../domain/types';
import { useAppStore } from '../state/useAppStore';
import { podAccent } from '../scene/accent';
import { CONTROL_PLANE_POSITION, PLATFORM_TOP, componentSlots, nodeLayouts, type Vec3 } from '../scene/layout';
import { palette } from '../scene/palette';
import { APISERVER_ORB_HEIGHT } from '../scene/entities/ControlPlaneStructures';
import { PodCreature } from '../scene/entities/PodCreature';
import { clamp01, keyed } from './tracks';
import {
  API_FLARE_AT,
  SIGNALS,
  WORKERS,
  kubeletFlareAt,
  podBirthAt,
  type Signal,
  type Tone,
} from './awakening';

type Time = MutableRefObject<number>;

const TONE_COLOR: Record<Tone, string> = { watch: palette.cyan, probe: palette.lavender, bind: palette.gold };

/** Where a new Pod stands on its Node: near the centre, clear of the existing ring of Pods. */
const BIRTH_SPOT: Vec3 = [0.3, PLATFORM_TOP, 0.8];
/** The storefront replica the new Pods are copies of. */
const TEMPLATE_POD = 'pod-storefront-x2k4p';

interface Places {
  points: Record<string, Vector3>;
  workers: { name: string; index: number; position: Vec3; radius: number; facing: number }[];
}

/** Resolves the script's named points from the real layout, so the effects land on the actual components. */
function placesOf(cluster: Cluster): Places {
  const layouts = nodeLayouts(cluster);
  const [cx, cy, cz] = CONTROL_PLANE_POSITION;
  const sched = componentSlots['kube-scheduler'];
  const points: Record<string, Vector3> = {
    apiserver: new Vector3(cx, cy + PLATFORM_TOP + APISERVER_ORB_HEIGHT, cz),
    scheduler: new Vector3(cx + sched[0], cy + sched[1] + 1, cz + sched[2]),
  };
  const workers: Places['workers'] = [];
  let index = 0;
  for (const n of cluster.nodes) {
    if (n.role === 'control-plane') continue;
    const l = layouts.get(n.metadata.name);
    if (l) {
      const [x, y, z] = l.position;
      points[`node:${l.name}`] = new Vector3(x, y + PLATFORM_TOP + 0.1, z);
      points[`kubelet:${l.name}`] = new Vector3(x + l.kubelet[0], y + l.kubelet[1] + 1.05, z + l.kubelet[2]);
      workers.push({ name: l.name, index: index++, position: l.position, radius: l.radius, facing: Math.atan2(x, z) });
    }
  }
  return { points, workers };
}

/** Same float as the NodePlatform it stands on, so a new Pod's feet stay on the surface. */
const nodeBob = (t: number, index: number) => Math.sin(t * 0.6 + index * 2.1) * 0.12;

/** Cinematic-only: the scheduling and kubelet signals of 7–10 s, and the Pods they bring to life. */
export function ClusterAwakening({ time }: { time: Time }) {
  const cluster = useAppStore((s) => s.cluster);
  const places = useMemo(() => placesOf(cluster), [cluster]);
  const births = useMemo(() => {
    const template = cluster.pods.find((p) => p.metadata.uid === TEMPLATE_POD);
    if (!template) return [];
    return places.workers
      .filter((w) => (WORKERS as readonly string[]).includes(w.name))
      .map((w, i) => ({
        worker: w,
        at: podBirthAt(w.name),
        accent: podAccent(cluster, template),
        pod: {
          ...template,
          metadata: { ...template.metadata, uid: `cinematic-pod-${i}`, name: `storefront-6d8f7c9b5-new${i}` },
          nodeName: w.name,
        } satisfies Pod,
      }));
  }, [cluster, places]);

  return (
    <>
      {SIGNALS.map((s, i) => (
        <LightSignal key={i} signal={s} from={places.points[s.from]} to={places.points[s.to]} time={time} />
      ))}
      <Flare at={places.points.apiserver} start={API_FLARE_AT} color={palette.cyan} size={3.2} time={time} />
      {places.workers.map((w) => (
        <group key={w.name}>
          <Flare at={places.points[`kubelet:${w.name}`]} start={kubeletFlareAt(w.name)} color={palette.cyan} size={2.4} time={time} />
          <NodeScan
            center={places.points[`node:${w.name}`]}
            radius={w.radius}
            start={SIGNALS.find((s) => s.to === `node:${w.name}`)?.t ?? 0}
            arrive={SIGNALS.find((s) => s.to === `node:${w.name}`)?.duration ?? 0}
            time={time}
          />
        </group>
      ))}
      {births.map((b) => (
        <Materialize key={b.pod.metadata.uid} worker={b.worker} at={b.at} time={time}>
          <PodCreature pod={b.pod} position={[0, 0, 0]} accent={b.accent} />
        </Materialize>
      ))}
    </>
  );
}

const TRAIL = 10;
const TRAIL_SPAN = 0.22;

/** A bead of light travelling along an arc from one component to another, with a fading trail. */
function LightSignal({ signal, from, to, time }: { signal: Signal; from?: Vector3; to?: Vector3; time: Time }) {
  const beads = useRef<(Mesh | null)[]>([]);
  const curve = useMemo(() => {
    if (!from || !to) return null;
    const mid = from.clone().lerp(to, 0.5);
    mid.y += 1.5 + from.distanceTo(to) * 0.22;
    return new QuadraticBezierCurve3(from, mid, to);
  }, [from, to]);
  const p = useMemo(() => new Vector3(), []);

  useFrame(() => {
    if (!curve) return;
    const u = (time.current - signal.t) / signal.duration;
    beads.current.forEach((m, i) => {
      if (!m) return;
      const lag = (i / TRAIL) * TRAIL_SPAN;
      const along = u - lag;
      const visible = along > 0 && along < 1 + TRAIL_SPAN && u < 1 + TRAIL_SPAN * 1.5;
      m.visible = visible;
      if (!visible) return;
      curve.getPoint(clamp01(along), p);
      m.position.copy(p);
      const fade = (1 - i / TRAIL) * (u > 1 ? Math.max(0, 1 - (u - 1) / (TRAIL_SPAN * 1.5)) : 1);
      m.scale.setScalar(1 - (i / TRAIL) * 0.75);
      (m.material as MeshBasicMaterial).opacity = fade;
    });
  });

  const color = TONE_COLOR[signal.tone];
  return (
    <group raycast={() => null}>
      {Array.from({ length: TRAIL }, (_, i) => (
        <mesh
          key={i}
          visible={false}
          ref={(m) => {
            beads.current[i] = m;
          }}
        >
          <sphereGeometry args={[i === 0 ? 0.14 : 0.1, 12, 10]} />
          <meshBasicMaterial color={color} transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

const glowVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const glowFragment = /* glsl */ `
  uniform vec3 color;
  uniform float strength;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float g = pow(max(1.0 - r, 0.0), 2.2) + pow(max(1.0 - r, 0.0), 8.0) * 1.5;
    gl_FragColor = vec4(color, g * strength);
  }
`;

/** A soft burst of light on a component as it reacts: quick to flare, slow to settle. */
function Flare({ at, start, color, size, time }: { at?: Vector3; start: number; color: string; size: number; time: Time }) {
  const material = useRef<ShaderMaterial>(null);
  const uniforms = useMemo(() => ({ color: { value: new Color(color) }, strength: { value: 0 } }), [color]);
  useFrame(() => {
    const t = time.current;
    const k = keyed([[start, 0], [start + 0.12, 1], [start + 0.5, 0.55], [start + 1.6, 0.35]], t);
    if (material.current) material.current.uniforms.strength!.value = t < start ? 0 : k;
  });
  if (!at) return null;
  return (
    <Billboard position={at}>
      <mesh raycast={() => null}>
        <planeGeometry args={[size, size]} />
        <shaderMaterial
          ref={material}
          uniforms={uniforms}
          vertexShader={glowVertex}
          fragmentShader={glowFragment}
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
    </Billboard>
  );
}

/** The scheduler's evaluation reaching a Node: a ring of light sweeps across its surface. */
function NodeScan({ center, radius, start, arrive, time }: { center?: Vector3; radius: number; start: number; arrive: number; time: Time }) {
  const ring = useRef<Mesh>(null);
  const material = useRef<MeshBasicMaterial>(null);
  useFrame(() => {
    const u = (time.current - start - arrive) / 0.7;
    const on = u > 0 && u < 1;
    if (ring.current) {
      ring.current.visible = on;
      ring.current.scale.setScalar(0.25 + 0.75 * clamp01(u));
    }
    if (material.current) material.current.opacity = on ? 0.55 * (1 - u) : 0;
  });
  if (!center) return null;
  return (
    <mesh ref={ring} position={center} rotation={[-Math.PI / 2, 0, 0]} visible={false} raycast={() => null}>
      <ringGeometry args={[radius * 0.9, radius, 96]} />
      <meshBasicMaterial ref={material} color={palette.lavender} transparent depthWrite={false} blending={AdditiveBlending} side={DoubleSide} />
    </mesh>
  );
}

const beamVertex = /* glsl */ `
  varying vec2 vUv;
  varying float vFacing;
  void main() {
    vUv = uv;
    vec3 n = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vFacing = abs(dot(n, normalize(-mv.xyz)));
    gl_Position = projectionMatrix * mv;
  }
`;

const beamFragment = /* glsl */ `
  uniform vec3 color;
  uniform float strength;
  varying vec2 vUv;
  varying float vFacing;
  void main() {
    float rise = pow(1.0 - vUv.y, 1.8);
    float edge = pow(1.0 - vFacing, 1.4) * 0.8 + 0.2;
    gl_FragColor = vec4(color, rise * edge * strength);
  }
`;

const easeOutBack = (x: number) => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2);

/** A new Pod appearing where its container starts: a column of light, then the creature pops in. */
function Materialize({
  worker,
  at,
  time,
  children,
}: {
  worker: Places['workers'][number];
  at: number;
  time: Time;
  children: React.ReactNode;
}) {
  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
  const beam = useRef<Group>(null);
  const beamMat = useRef<ShaderMaterial>(null);
  const uniforms = useMemo(() => ({ color: { value: new Color(palette.cyan) }, strength: { value: 0 } }), []);
  const [x, y, z] = worker.position;
  const sx = Math.cos(worker.facing) * BIRTH_SPOT[0] + Math.sin(worker.facing) * BIRTH_SPOT[2];
  const sz = -Math.sin(worker.facing) * BIRTH_SPOT[0] + Math.cos(worker.facing) * BIRTH_SPOT[2];

  useFrame(({ clock }) => {
    const t = time.current;
    if (root.current) root.current.position.set(x + sx, y + BIRTH_SPOT[1] + nodeBob(clock.elapsedTime, worker.index), z + sz);
    const pop = clamp01((t - at - 0.2) / 0.5);
    if (body.current) {
      body.current.visible = pop > 0;
      body.current.scale.setScalar(Math.max(0.001, easeOutBack(pop)));
    }
    const glow = keyed([[at, 0], [at + 0.15, 1], [at + 0.6, 0.8], [at + 1.3, 0]], t);
    if (beam.current) {
      beam.current.visible = t > at && glow > 0.01;
      beam.current.scale.set(1, clamp01((t - at) / 0.3), 1);
    }
    if (beamMat.current) beamMat.current.uniforms.strength!.value = glow;
  });

  return (
    <group ref={root}>
      <group ref={body} rotation={[0, worker.facing, 0]} visible={false}>
        {children}
      </group>
      <group ref={beam} visible={false}>
        <mesh position={[0, 1.6, 0]} raycast={() => null}>
          <cylinderGeometry args={[0.35, 0.55, 3.2, 32, 1, true]} />
          <shaderMaterial
            ref={beamMat}
            uniforms={uniforms}
            vertexShader={beamVertex}
            fragmentShader={beamFragment}
            transparent
            depthWrite={false}
            blending={AdditiveBlending}
            side={DoubleSide}
          />
        </mesh>
      </group>
    </group>
  );
}
