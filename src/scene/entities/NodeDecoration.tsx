import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import { palette } from '../palette';
import { PLATFORM_TOP } from '../layout';

interface Props {
  variant: number;
  accent: string;
  radius: number;
}

/** Purely decorative props that give each worker island its own silhouette. */
export function NodeDecoration({ variant, accent, radius }: Props) {
  if (variant === 0) return <Pylons accent={accent} radius={radius} />;
  if (variant === 1) return <Arch accent={accent} radius={radius} />;
  return <Shards accent={accent} radius={radius} />;
}

function Pylons({ accent, radius }: { accent: string; radius: number }) {
  const angles = [-0.5, 0.25, 1.0].map((a) => a + Math.PI);
  return (
    <group>
      {angles.map((a, i) => {
        const h = 0.9 + i * 0.35;
        const r = radius - 0.45;
        return (
          <group key={a} position={[Math.cos(a) * r, PLATFORM_TOP, Math.sin(a) * r]}>
            <mesh position={[0, h / 2, 0]} castShadow>
              <boxGeometry args={[0.16, h, 0.16]} />
              <meshStandardMaterial color={palette.slate} roughness={0.6} />
            </mesh>
            <mesh position={[0, h + 0.08, 0]}>
              <boxGeometry args={[0.12, 0.12, 0.12]} />
              <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.4} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function Arch({ accent, radius }: { accent: string; radius: number }) {
  const rings = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (rings.current) rings.current.rotation.z = Math.sin(clock.elapsedTime * 0.4) * 0.08;
  });
  const r = radius - 0.9;
  return (
    <group position={[-r * 0.85, PLATFORM_TOP, r * 0.4]} rotation={[0, Math.PI / 2 - 0.4, 0]}>
      <mesh castShadow>
        <torusGeometry args={[0.9, 0.07, 12, 48, Math.PI]} />
        <meshStandardMaterial color={palette.slate} roughness={0.5} metalness={0.3} />
      </mesh>
      <group ref={rings} position={[0, 0.5, 0]}>
        {[0.32, 0.5].map((rr) => (
          <mesh key={rr}>
            <torusGeometry args={[rr, 0.015, 8, 48]} />
            <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.2} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function Shards({ accent, radius }: { accent: string; radius: number }) {
  const shards = [
    { a: Math.PI * 0.85, h: 1.1, s: 0.22 },
    { a: Math.PI * 0.78, h: 0.7, s: 0.16 },
    { a: Math.PI * 0.92, h: 0.55, s: 0.13 },
    { a: Math.PI * 0.3, h: 0.8, s: 0.17 },
  ];
  return (
    <group>
      {shards.map(({ a, h, s }) => {
        const r = radius - 0.6;
        return (
          <mesh
            key={a}
            position={[Math.cos(a) * r, PLATFORM_TOP + h / 2, Math.sin(a) * r]}
            rotation={[0.1, a, 0.12]}
            scale={[s, h / 2, s]}
            castShadow
          >
            <octahedronGeometry args={[1, 0]} />
            <meshStandardMaterial
              color={accent}
              emissive={accent}
              emissiveIntensity={0.45}
              roughness={0.2}
              flatShading
              transparent
              opacity={0.85}
            />
          </mesh>
        );
      })}
    </group>
  );
}
