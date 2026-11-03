import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import { CanvasTexture, CatmullRomCurve3, DoubleSide, ExtrudeGeometry, Shape, SRGBColorSpace, Vector3, type Group } from 'three';
import type { PodOrigin } from '../../domain/types';
import { palette } from '../palette';
import { creaturePoses } from '../creaturePose';

interface Props {
  origin: PodOrigin;
  accent: string;
  phase: number;
  /** The Pod's name: a StatefulSet Pod wears its ordinal (web-0, web-1…). */
  name: string;
  /** Looks up a scripted pose (see creaturePose). */
  uid?: string;
}

/**
 * Optional visual traits layered on the shared creature body.
 * Each trait hints at *how* the Pod is managed:
 *  - ReplicaSet: antenna whose tip colour is shared with its replicas
 *  - DaemonSet: mini horns ("one guardian per Node")
 *  - StatefulSet: its ordinal on a badge, a little tail and a storage backpack (unique, stable identity)
 *  - Job: hourglass with a twinkling star (temporary: runs to completion)
 *  - Static: halo, crown and runes + base plate bolted to the Node (system, kubelet-managed)
 *  - Standalone: nothing — no controller looks after it
 */
export function OriginTrait({ origin, accent, phase, name, uid }: Props) {
  switch (origin) {
    case 'replicaset':
      return <Antenna accent={accent} phase={phase} uid={uid} />;
    case 'daemonset':
      return <Horns accent={accent} />;
    case 'statefulset':
      return (
        <>
          <OrdinalBadge name={name} accent={accent} phase={phase} />
          <Tail accent={accent} phase={phase} />
          <Backpack accent={accent} />
        </>
      );
    case 'job':
      return <Hourglass accent={accent} phase={phase} />;
    case 'static':
      return <SystemCrown phase={phase} />;
    case 'standalone':
      return null;
  }
}

function Antenna({ accent, phase, uid }: { accent: string; phase: number; uid?: string }) {
  const tip = useRef<Group>(null);
  const h = 0.2;
  useFrame(({ clock }) => {
    if (!tip.current) return;
    const sway = Math.sin(clock.elapsedTime * 2.2 + phase) * 0.18;
    const pose = uid ? creaturePoses.get(uid) : undefined;
    if (!pose) {
      tip.current.rotation.z = sway;
      return;
    }
    const limp = 1 - pose.antenna;
    tip.current.rotation.z = sway * pose.antenna + limp * 0.75;
    tip.current.rotation.x = limp * 0.5;
  });
  return (
    <group ref={tip} position={[0, 0.33, 0]}>
      <mesh position={[0, h / 2, 0]} castShadow>
        <cylinderGeometry args={[0.012, 0.016, h, 8]} />
        <meshStandardMaterial color={palette.lilac} roughness={0.4} />
      </mesh>
      <mesh position={[0, h + 0.04, 0]}>
        <sphereGeometry args={[0.05, 16, 16]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.4} />
      </mesh>
    </group>
  );
}

/** Two small horns, curving outwards. */
function Horns({ accent }: { accent: string }) {
  return (
    <>
      {[-1, 1].map((side) => (
        <group key={side} position={[side * 0.17, 0.28, 0.03]} rotation={[-0.2, 0, side * -0.5]}>
          <mesh position={[0, 0.08, 0]} castShadow>
            <coneGeometry args={[0.065, 0.21, 14]} />
            <meshPhysicalMaterial color="#f3ead8" roughness={0.3} clearcoat={0.9} />
          </mesh>
          <mesh position={[0, 0.18, 0]}>
            <sphereGeometry args={[0.018, 10, 10]} />
            <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.5} />
          </mesh>
        </group>
      ))}
    </>
  );
}

/** A floating halo with runes over a tiny crown: a system Pod, run by the kubelet itself. */
function SystemCrown({ phase }: { phase: number }) {
  const halo = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (!halo.current) return;
    const t = clock.elapsedTime;
    halo.current.rotation.y = t * 0.7 + phase;
    halo.current.position.y = 0.66 + Math.sin(t * 1.8 + phase) * 0.025;
  });
  return (
    <>
      <group position={[0, 0.39, 0]} rotation={[-0.12, 0, 0]} scale={1.4}>
        <mesh>
          <cylinderGeometry args={[0.12, 0.1, 0.06, 20, 1, true]} />
          <meshStandardMaterial
            color={palette.gold}
            emissive={palette.gold}
            emissiveIntensity={0.5}
            metalness={0.6}
            roughness={0.3}
            side={DoubleSide}
          />
        </mesh>
        {[0, 1, 2, 3, 4].map((i) => {
          const a = (i / 5) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.sin(a) * 0.11, 0.06, Math.cos(a) * 0.11]}>
              <coneGeometry args={[0.022, 0.06, 6]} />
              <meshStandardMaterial color={palette.gold} emissive={palette.gold} emissiveIntensity={0.7} metalness={0.5} />
            </mesh>
          );
        })}
        <mesh position={[0, 0.01, 0.112]}>
          <octahedronGeometry args={[0.022, 0]} />
          <meshStandardMaterial color={palette.cyan} emissive={palette.cyan} emissiveIntensity={1.4} flatShading />
        </mesh>
      </group>
      <group ref={halo} position={[0, 0.66, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.17, 0.012, 8, 48]} />
          <meshStandardMaterial color={palette.gold} emissive={palette.gold} emissiveIntensity={1.3} />
        </mesh>
        {/* runes */}
        {[0, 1, 2, 3].map((i) => {
          const a = (i / 4) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.cos(a) * 0.17, 0, Math.sin(a) * 0.17]} rotation={[0, -a, Math.PI / 4]}>
              <boxGeometry args={[0.03, 0.03, 0.008]} />
              <meshStandardMaterial color={palette.white} emissive={palette.gold} emissiveIntensity={1.6} />
            </mesh>
          );
        })}
      </group>
    </>
  );
}

const ordinalOf = (name: string) => /-(\d+)$/.exec(name)?.[1] ?? '#';

/** The StatefulSet ordinal, always facing the camera: this Pod is web-0, not "a" web Pod. */
function OrdinalBadge({ name, accent, phase }: { name: string; accent: string; phase: number }) {
  const g = useRef<Group>(null);
  const ordinal = ordinalOf(name);
  const texture = useMemo(() => {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - 8, 0, Math.PI * 2);
      ctx.fillStyle = palette.ink;
      ctx.fill();
      ctx.lineWidth = 9;
      ctx.strokeStyle = accent;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${ordinal.length > 1 ? 54 : 70}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ordinal, size / 2, size / 2 + 4);
    }
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    return tex;
  }, [ordinal, accent]);
  useEffect(() => () => texture.dispose(), [texture]);
  useFrame(({ clock }) => {
    if (g.current) g.current.position.y = 0.6 + Math.sin(clock.elapsedTime * 2 + phase) * 0.02;
  });
  return (
    <group ref={g} position={[0, 0.6, 0]}>
      <mesh position={[0, -0.13, 0]}>
        <cylinderGeometry args={[0.008, 0.008, 0.16, 6]} />
        <meshStandardMaterial color={palette.lilac} />
      </mesh>
      <Billboard>
        <mesh>
          <circleGeometry args={[0.1, 32]} />
          <meshBasicMaterial map={texture} transparent toneMapped={false} />
        </mesh>
      </Billboard>
    </group>
  );
}

const TAIL_CURVE = new CatmullRomCurve3([
  new Vector3(0, 0, 0),
  new Vector3(0, -0.06, -0.12),
  new Vector3(0, 0.02, -0.24),
  new Vector3(0, 0.12, -0.27),
]);

function Tail({ accent, phase }: { accent: string; phase: number }) {
  const g = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (g.current) g.current.rotation.y = Math.sin(clock.elapsedTime * 3 + phase) * 0.35;
  });
  return (
    <group ref={g} position={[0, -0.24, -0.33]}>
      <mesh castShadow>
        <tubeGeometry args={[TAIL_CURVE, 20, 0.028, 8, false]} />
        <meshPhysicalMaterial color={palette.lilac} roughness={0.35} clearcoat={0.8} />
      </mesh>
      <mesh position={[0, 0.12, -0.27]}>
        <sphereGeometry args={[0.045, 14, 12]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.2} />
      </mesh>
    </group>
  );
}

function Backpack({ accent }: { accent: string }) {
  return (
    <group position={[0, 0.02, -0.36]}>
      <mesh castShadow>
        <cylinderGeometry args={[0.13, 0.13, 0.26, 24]} />
        <meshPhysicalMaterial color={palette.slate} roughness={0.35} clearcoat={0.8} />
      </mesh>
      {[-0.07, 0, 0.07].map((y) => (
        <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.132, 0.01, 6, 32]} />
          <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.8} />
        </mesh>
      ))}
    </group>
  );
}

const STAR_GEOMETRY = (() => {
  const s = new Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 0.05 : 0.022;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  const geo = new ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false });
  geo.center();
  return geo;
})();

/** An hourglass, with a little star circling it: this Pod is temporary. */
function Hourglass({ accent, phase }: { accent: string; phase: number }) {
  const g = useRef<Group>(null);
  const star = useRef<Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (g.current) g.current.rotation.y = t * 0.9;
    if (star.current) {
      const a = t * 1.6 + phase;
      star.current.position.set(Math.cos(a) * 0.2, 0.05 + Math.sin(t * 2.4) * 0.03, Math.sin(a) * 0.2);
      star.current.rotation.z = t * 2;
      star.current.scale.setScalar(0.85 + (Math.sin(t * 5 + phase) * 0.5 + 0.5) * 0.35);
    }
  });
  return (
    <group position={[0, 0.5, 0]}>
      <group ref={g}>
        <mesh position={[0, 0.06, 0]}>
          <coneGeometry args={[0.07, 0.12, 16]} />
          <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.6} transparent opacity={0.9} />
        </mesh>
        <mesh position={[0, -0.06, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.07, 0.12, 16]} />
          <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.6} transparent opacity={0.9} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.1, 0.008, 6, 32, Math.PI * 1.3]} />
          <meshStandardMaterial color={palette.white} emissive={palette.white} emissiveIntensity={0.6} />
        </mesh>
      </group>
      <group ref={star}>
        <mesh geometry={STAR_GEOMETRY}>
          <meshStandardMaterial color={palette.gold} emissive={palette.gold} emissiveIntensity={1.6} />
        </mesh>
      </group>
    </group>
  );
}

/** Hexagonal plate under a static Pod's feet — it is bound to this Node. */
export function StaticBasePlate() {
  return (
    <mesh position={[0, 0.015, 0]} receiveShadow>
      <cylinderGeometry args={[0.36, 0.4, 0.03, 6]} />
      <meshStandardMaterial
        color={palette.gold}
        emissive={palette.gold}
        emissiveIntensity={0.35}
        roughness={0.5}
        metalness={0.4}
      />
    </mesh>
  );
}
