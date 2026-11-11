import { useMemo, useRef, useState } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { CatmullRomCurve3, Vector3, type Group, type Mesh } from 'three';
import { useAppStore } from '../../state/useAppStore';
import { usePlayground } from '../../playground/store';
import type { Toy } from '../../playground/toys';
import type { Vec3 } from '../layout';
import { useHoverHandlers } from '../interaction';
import { WorldLabel } from '../WorldLabel';
import { accentFor, palette } from '../palette';

/** Centre stage in L00's empty universe. */
const IN_UNIVERSE: Vec3 = [0, 0.4, -3.5];

const show = (v: unknown): string =>
  Array.isArray(v)
    ? v.map(show).join(', ')
    : v !== null && typeof v === 'object'
      ? Object.entries(v).map(([k, x]) => `${k}: ${show(x)}`).join(' · ')
      : String(v);

const furOf = (fields: Record<string, unknown>) => {
  const c = fields.color ?? fields.colour;
  return typeof c === 'string' && typeof CSS !== 'undefined' && CSS.supports('color', c) ? c : palette.warm;
};

const easeOutBack = (t: number) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);

/** L00's pet.yaml, applied for fun: a little cat wearing the learner's fields. It lives only in L00's empty universe. */
export function PlaygroundToy() {
  const toy = usePlayground((s) => s.toy);
  const universe = useAppStore((s) => s.cluster.nodes.length === 0);
  if (!toy || toy.kind !== 'cat' || !universe) return null;
  return <Cat key={toy.seq} toy={toy} position={IN_UNIVERSE} size={2.4} />;
}

function Cat({ toy, position, size }: { toy: Toy; position: Vec3; size: number }) {
  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
  const head = useRef<Group>(null);
  const tail = useRef<Group>(null);
  const eyes = useRef<Mesh[]>([]);
  const born = useRef<number | null>(null);
  const jumpAt = useRef<number | null>(null);
  const jumpRequested = useRef(false);
  const [meow, setMeow] = useState(false);
  const hover = useHoverHandlers('toy:cat');
  const fur = furOf(toy.fields);
  const rows = Object.entries(toy.fields).filter(([k]) => k !== 'name' && k !== 'color' && k !== 'colour').slice(0, 6);
  const toys = Array.isArray(toy.fields.toys) ? toy.fields.toys.slice(0, 6).map(show) : [];
  const title = typeof toy.fields.name === 'string' || typeof toy.fields.name === 'number' ? String(toy.fields.name) : toy.name;

  const tailCurve = useMemo(
    () => new CatmullRomCurve3([new Vector3(0, 0, 0), new Vector3(0.32, 0.08, -0.32), new Vector3(0.55, 0.55, -0.3), new Vector3(0.42, 0.95, -0.05)]),
    [],
  );

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    born.current ??= t;
    const appear = Math.min(1, (t - born.current) / 0.7);
    let lift = 0;
    if (jumpRequested.current) {
      jumpRequested.current = false;
      jumpAt.current = t;
    }
    if (jumpAt.current !== null) {
      const p = (t - jumpAt.current) / 0.55;
      if (p >= 1) jumpAt.current = null;
      else lift = Math.sin(Math.PI * p) * 0.7;
    }
    if (root.current) {
      root.current.scale.setScalar(Math.max(0.001, easeOutBack(appear) * size));
      root.current.position.set(position[0], position[1] + ((1 - appear) * 1.2 + lift) * size, position[2]);
    }
    if (body.current) body.current.scale.set(1, 1 + Math.sin(t * 2.2) * 0.025, 1);
    if (head.current) head.current.rotation.z = Math.sin(t * 0.7) * 0.08;
    if (tail.current) tail.current.rotation.y = Math.sin(t * 2.4) * 0.45;
    const blink = t % 4.2 < 0.12 ? 0.15 : 1;
    for (const e of eyes.current) if (e) e.scale.y = blink;
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    jumpRequested.current = true;
    setMeow(true);
    window.setTimeout(() => setMeow(false), 1400);
  };

  return (
    <group ref={root} position={position}>
      {/* Cushion */}
      <mesh position={[0, -0.04, 0]}>
        <cylinderGeometry args={[1.05, 1.15, 0.2, 40]} />
        <meshStandardMaterial color={palette.surface} emissive={palette.lavender} emissiveIntensity={0.18} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.06, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.05, 0.06, 10, 48]} />
        <meshStandardMaterial color={palette.lavender} emissive={palette.lavender} emissiveIntensity={0.5} />
      </mesh>

      <group {...hover} onClick={onClick}>
        <group ref={body}>
          <mesh position={[0, 0.6, 0]} scale={[0.95, 1.1, 0.9]}>
            <sphereGeometry args={[0.55, 28, 20]} />
            <meshStandardMaterial color={fur} emissive={fur} emissiveIntensity={0.18} roughness={0.7} />
          </mesh>
          <mesh position={[0, 0.55, 0.33]} scale={[0.7, 0.85, 0.5]}>
            <sphereGeometry args={[0.45, 20, 16]} />
            <meshStandardMaterial color={palette.white} roughness={0.8} />
          </mesh>
          {[-0.2, 0.2].map((x) => (
            <mesh key={x} position={[x, 0.1, 0.38]} scale={[1, 0.7, 1.3]}>
              <sphereGeometry args={[0.14, 14, 10]} />
              <meshStandardMaterial color={fur} emissive={fur} emissiveIntensity={0.18} roughness={0.7} />
            </mesh>
          ))}
        </group>

        <group ref={head} position={[0, 1.35, 0.1]}>
          <mesh>
            <sphereGeometry args={[0.42, 28, 20]} />
            <meshStandardMaterial color={fur} emissive={fur} emissiveIntensity={0.18} roughness={0.7} />
          </mesh>
          {[-1, 1].map((s) => (
            <group key={s} position={[s * 0.22, 0.34, 0]} rotation={[0, 0, -s * 0.28]}>
              <mesh>
                <coneGeometry args={[0.13, 0.3, 4]} />
                <meshStandardMaterial color={fur} emissive={fur} emissiveIntensity={0.18} roughness={0.7} />
              </mesh>
              <mesh position={[0, -0.02, 0.05]} scale={0.6}>
                <coneGeometry args={[0.13, 0.3, 4]} />
                <meshStandardMaterial color={palette.coral} emissive={palette.coral} emissiveIntensity={0.3} />
              </mesh>
            </group>
          ))}
          {[-1, 1].map((s, i) => (
            <group key={s} position={[s * 0.15, 0.06, 0.37]}>
              <mesh
                ref={(m) => {
                  if (m) eyes.current[i] = m;
                }}
              >
                <sphereGeometry args={[0.065, 14, 10]} />
                <meshStandardMaterial color={palette.ink} roughness={0.3} />
              </mesh>
              <mesh position={[0.02, 0.025, 0.05]}>
                <sphereGeometry args={[0.018, 8, 6]} />
                <meshBasicMaterial color={palette.white} />
              </mesh>
            </group>
          ))}
          {[-0.07, 0.07].map((x) => (
            <mesh key={x} position={[x, -0.1, 0.36]}>
              <sphereGeometry args={[0.09, 14, 10]} />
              <meshStandardMaterial color={palette.white} roughness={0.8} />
            </mesh>
          ))}
          <mesh position={[0, -0.03, 0.42]}>
            <sphereGeometry args={[0.035, 10, 8]} />
            <meshStandardMaterial color={palette.coral} emissive={palette.coral} emissiveIntensity={0.4} />
          </mesh>
          {[-1, 1].flatMap((s) => [-0.06, 0.02].map((dy) => (
            <mesh key={`${s}${dy}`} position={[s * 0.3, -0.08 + dy, 0.3]} rotation={[0, 0, s * dy * 3]}>
              <boxGeometry args={[0.3, 0.008, 0.008]} />
              <meshBasicMaterial color={palette.lilac} />
            </mesh>
          )))}
        </group>

        <group ref={tail} position={[0, 0.2, -0.4]}>
          <mesh>
            <tubeGeometry args={[tailCurve, 24, 0.065, 8, false]} />
            <meshStandardMaterial color={fur} emissive={fur} emissiveIntensity={0.18} roughness={0.7} />
          </mesh>
        </group>

        <mesh visible={false} position={[0, 0.9, 0]}>
          <sphereGeometry args={[0.95, 10, 8]} />
          <meshBasicMaterial />
        </mesh>
      </group>

      {toys.map((name, i) => (
        <OrbitingToy key={`${i}-${name}`} name={name} index={i} count={toys.length} />
      ))}

      <WorldLabel position={[0, 2.2, 0]} center>
        <div className="pointer-events-none flex -translate-y-1/2 flex-col items-center gap-1">
          {meow && <span className="kv-card-in rounded-full bg-white px-2.5 py-0.5 font-display text-[12px] font-semibold text-[#0d1226]">Meow!</span>}
          <div className="rounded-xl border px-3 py-2 text-left" style={{ borderColor: `color-mix(in srgb, ${fur} 45%, transparent)`, background: 'rgb(9 14 36 / 0.78)' }}>
            <p className="text-[9px] font-medium uppercase tracking-[0.14em]" style={{ color: fur }}>
              cat · from {toy.file}
            </p>
            <p className="font-display text-[14px] font-semibold text-white">{title}</p>
            {rows.map(([k, v]) => (
              <p key={k} className="max-w-[240px] truncate font-mono text-[11px] leading-snug">
                <span className="text-cyan">{k}</span>
                <span className="text-lavender/60">: </span>
                <span className="text-white">{show(v)}</span>
              </p>
            ))}
          </div>
        </div>
      </WorldLabel>
    </group>
  );
}

function OrbitingToy({ name, index, count }: { name: string; index: number; count: number }) {
  const ref = useRef<Group>(null);
  const color = accentFor(name);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const a = (index / count) * Math.PI * 2 + clock.elapsedTime * 0.45;
    ref.current.position.set(Math.cos(a) * 1.6, 0.45 + Math.sin(clock.elapsedTime * 1.6 + index) * 0.12, Math.sin(a) * 1.6);
    ref.current.rotation.y = clock.elapsedTime;
  });
  return (
    <group ref={ref}>
      <mesh>
        <icosahedronGeometry args={[0.15, 0]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.7} flatShading />
      </mesh>
      <WorldLabel position={[0, 0.32, 0]} center>
        <span className="pointer-events-none whitespace-nowrap rounded-md bg-[rgb(9_14_36/0.7)] px-1.5 py-px font-mono text-[10px] text-white/85">{name}</span>
      </WorldLabel>
    </group>
  );
}
