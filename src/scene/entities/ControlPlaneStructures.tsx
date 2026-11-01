import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import type { ControlPlaneComponentType } from '../../domain/types';
import { palette } from '../palette';

interface StructureProps {
  glow: number;
}

/** Height (above its base) of the API server's beacon orb; connection arcs start here. */
export const APISERVER_ORB_HEIGHT = 2.75;

export function ComponentStructure({ type, glow }: { type: ControlPlaneComponentType; glow: number }) {
  switch (type) {
    case 'kube-apiserver':
      return <ApiServer glow={glow} />;
    case 'etcd':
      return <Etcd glow={glow} />;
    case 'kube-scheduler':
      return <Scheduler glow={glow} />;
    case 'kube-controller-manager':
    case 'cloud-controller-manager':
      return <ControllerManager glow={glow} />;
  }
}

function Pedestal({ r = 0.75 }: { r?: number }) {
  return (
    <mesh position={[0, 0.1, 0]} castShadow receiveShadow>
      <cylinderGeometry args={[r, r * 1.1, 0.2, 6]} />
      <meshStandardMaterial color={palette.slate} roughness={0.55} metalness={0.3} flatShading />
    </mesh>
  );
}

/** The front door: a tall tower with a gateway ring. */
function ApiServer({ glow }: StructureProps) {
  const orb = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (orb.current) orb.current.rotation.y = clock.elapsedTime * 0.7;
  });
  return (
    <group>
      <Pedestal r={0.95} />
      <mesh position={[0, 1.2, 0]} castShadow>
        <cylinderGeometry args={[0.28, 0.5, 2.0, 6]} />
        <meshStandardMaterial color={palette.deep} roughness={0.4} metalness={0.5} flatShading />
      </mesh>
      {[0.6, 1.1, 1.6].map((y) => (
        <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.47 - y * 0.1, 0.02, 6, 6]} />
          <meshStandardMaterial color={palette.gold} emissive={palette.gold} emissiveIntensity={0.6 * glow} />
        </mesh>
      ))}
      <mesh position={[0, 0.85, 0.82]}>
        <torusGeometry args={[0.62, 0.06, 12, 48]} />
        <meshStandardMaterial color={palette.gold} emissive={palette.gold} emissiveIntensity={0.9 * glow} metalness={0.4} />
      </mesh>
      <mesh position={[0, 0.85, 0.82]}>
        <circleGeometry args={[0.56, 48]} />
        <meshBasicMaterial color={palette.cyan} transparent opacity={0.12 * glow} />
      </mesh>
      <group ref={orb} position={[0, APISERVER_ORB_HEIGHT, 0]}>
        <mesh>
          <icosahedronGeometry args={[0.26, 0]} />
          <meshStandardMaterial color={palette.gold} emissive={palette.gold} emissiveIntensity={1.6 * glow} flatShading />
        </mesh>
        <mesh rotation={[Math.PI / 2.4, 0, 0]}>
          <torusGeometry args={[0.45, 0.015, 6, 48]} />
          <meshStandardMaterial color={palette.cyan} emissive={palette.cyan} emissiveIntensity={1.2} />
        </mesh>
      </group>
    </group>
  );
}

/** Consistent key-value store: stacked data discs with orbiting keys. */
function Etcd({ glow }: StructureProps) {
  const keys = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (keys.current) keys.current.rotation.y = -clock.elapsedTime * 0.6;
  });
  return (
    <group>
      <Pedestal />
      {[0.4, 0.75, 1.1].map((y) => (
        <group key={y} position={[0, y, 0]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.55, 0.55, 0.26, 32]} />
            <meshPhysicalMaterial color={palette.deep} roughness={0.3} clearcoat={1} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.13, 0]}>
            <torusGeometry args={[0.55, 0.018, 6, 48]} />
            <meshStandardMaterial color={palette.lavender} emissive={palette.lavender} emissiveIntensity={1.1 * glow} />
          </mesh>
        </group>
      ))}
      <group ref={keys} position={[0, 0.75, 0]}>
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i / 8) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.cos(a) * 0.9, Math.sin(a * 2) * 0.25, Math.sin(a) * 0.9]} rotation={[a, a, 0]}>
              <boxGeometry args={[0.09, 0.09, 0.09]} />
              <meshStandardMaterial color={palette.lilac} emissive={palette.lavender} emissiveIntensity={0.8 * glow} />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}

/** Picks a Node for each Pod: an astrolabe weighing options. */
function Scheduler({ glow }: StructureProps) {
  const a = useRef<Group>(null);
  const b = useRef<Group>(null);
  const c = useRef<Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (a.current) a.current.rotation.x = t * 0.5;
    if (b.current) b.current.rotation.y = t * 0.7;
    if (c.current) c.current.rotation.z = t * 0.35;
  });
  return (
    <group>
      <Pedestal />
      <mesh position={[0, 0.45, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.12, 0.5, 8]} />
        <meshStandardMaterial color={palette.slate} metalness={0.5} roughness={0.4} />
      </mesh>
      <group position={[0, 1.2, 0]}>
        <mesh>
          <sphereGeometry args={[0.16, 24, 16]} />
          <meshStandardMaterial color={palette.cyan} emissive={palette.cyan} emissiveIntensity={1.4 * glow} />
        </mesh>
        <group ref={a}>
          <mesh>
            <torusGeometry args={[0.62, 0.025, 8, 64]} />
            <meshStandardMaterial color={palette.gold} metalness={0.7} roughness={0.25} />
          </mesh>
        </group>
        <group ref={b}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.5, 0.02, 8, 64]} />
            <meshStandardMaterial color={palette.cyan} emissive={palette.cyan} emissiveIntensity={0.6 * glow} />
          </mesh>
        </group>
        <group ref={c}>
          <mesh rotation={[0, Math.PI / 2, 0]}>
            <torusGeometry args={[0.38, 0.018, 8, 64]} />
            <meshStandardMaterial color={palette.lilac} metalness={0.6} roughness={0.3} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

function Gear({ radius, teeth, color }: { radius: number; teeth: number; color: string }) {
  return (
    <group>
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[radius, radius, 0.14, 32]} />
        <meshStandardMaterial color={color} metalness={0.6} roughness={0.35} />
      </mesh>
      {Array.from({ length: teeth }, (_, i) => {
        const a = (i / teeth) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * radius, Math.sin(a) * radius, 0]} rotation={[0, 0, a]}>
            <boxGeometry args={[0.16, 0.1, 0.14]} />
            <meshStandardMaterial color={color} metalness={0.6} roughness={0.35} />
          </mesh>
        );
      })}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[radius * 0.3, radius * 0.3, 0.18, 16]} />
        <meshStandardMaterial color={palette.deep} />
      </mesh>
    </group>
  );
}

/** Reconciliation loops: interlocking gears that never stop turning. */
function ControllerManager({ glow }: StructureProps) {
  const g1 = useRef<Group>(null);
  const g2 = useRef<Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (g1.current) g1.current.rotation.z = t * 0.6;
    if (g2.current) g2.current.rotation.z = -t * 0.6 * (0.5 / 0.34) + 0.2;
  });
  return (
    <group>
      <Pedestal r={0.9} />
      <mesh position={[0, 0.55, 0]}>
        <boxGeometry args={[0.14, 0.7, 0.14]} />
        <meshStandardMaterial color={palette.slate} />
      </mesh>
      <group ref={g1} position={[-0.28, 1.05, 0]}>
        <Gear radius={0.5} teeth={10} color={palette.gold} />
      </group>
      <group ref={g2} position={[0.55, 1.4, 0.02]}>
        <Gear radius={0.34} teeth={7} color={palette.lilac} />
      </group>
      <mesh position={[0, 0.25, 0]}>
        <sphereGeometry args={[0.1, 12, 12]} />
        <meshStandardMaterial color={palette.teal} emissive={palette.teal} emissiveIntensity={1.2 * glow} />
      </mesh>
    </group>
  );
}
