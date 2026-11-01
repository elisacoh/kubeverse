import { useMemo } from 'react';
import { palette } from '../palette';
import { seededRandom } from '../random';

interface Props {
  seed: string;
  radius: number;
  depth: number;
  sides: number;
  accent: string;
}

/** Stylised faceted rock underside of a floating island, with hanging crystals. */
export function FloatingRock({ seed, radius, depth, sides, accent }: Props) {
  const chunks = useMemo(() => {
    const rnd = seededRandom(seed);
    return Array.from({ length: 6 }, (_, i) => {
      const a = (i / 6) * Math.PI * 2 + rnd() * 0.6;
      const r = radius * (0.45 + rnd() * 0.35);
      return {
        position: [Math.cos(a) * r, -0.6 - rnd() * depth * 0.35, Math.sin(a) * r] as [number, number, number],
        size: 0.5 + rnd() * 0.7,
        rot: rnd() * Math.PI,
      };
    });
  }, [seed, radius, depth]);

  const crystals = useMemo(() => {
    const rnd = seededRandom(seed + ':crystals');
    return Array.from({ length: 5 }, () => {
      const a = rnd() * Math.PI * 2;
      const r = radius * (0.15 + rnd() * 0.35);
      return {
        position: [Math.cos(a) * r, -depth * (0.55 + rnd() * 0.35), Math.sin(a) * r] as [number, number, number],
        size: 0.12 + rnd() * 0.18,
      };
    });
  }, [seed, radius, depth]);

  return (
    <group>
      <mesh position={[0, -0.2 - depth / 2, 0]} rotation={[Math.PI, 0, 0]} castShadow>
        <coneGeometry args={[radius * 0.97, depth, sides, 2]} />
        <meshStandardMaterial color={palette.rock} roughness={0.9} flatShading />
      </mesh>
      {chunks.map((c, i) => (
        <mesh key={i} position={c.position} rotation={[c.rot, c.rot * 0.7, 0]} scale={c.size}>
          <dodecahedronGeometry args={[0.7, 0]} />
          <meshStandardMaterial color={palette.rockDark} roughness={0.95} flatShading />
        </mesh>
      ))}
      {crystals.map((c, i) => (
        <mesh key={i} position={c.position} scale={[c.size, c.size * 2.4, c.size]}>
          <octahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.9} flatShading />
        </mesh>
      ))}
    </group>
  );
}
