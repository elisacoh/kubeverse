import { useMemo } from 'react';
import { Sparkles } from '@react-three/drei';
import { LatheGeometry, Vector2 } from 'three';
import { palette } from '../palette';
import { seededRandom } from '../random';

interface Props {
  seed: string;
  radius: number;
  depth: number;
  sides: number;
  accent: string;
  /** A refractive, faceted diamond instead of rock, with a glowing core. */
  crystal?: boolean;
}

/** Stylised faceted rock underside of a floating island, with hanging crystals. */
export function FloatingRock({ seed, radius, depth, sides, accent, crystal = false }: Props) {
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

  if (crystal) return <DiamondRock radius={radius} depth={depth} sides={sides} accent={accent} chunks={chunks} crystals={crystals} />;

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

interface Piece {
  position: [number, number, number];
  size: number;
  rot?: number;
}

/** Refractive faceted body around a glowing core, with crystal shards in place of rock chunks. */
function DiamondRock({
  radius,
  depth,
  sides,
  accent,
  chunks,
  crystals,
}: {
  radius: number;
  depth: number;
  sides: number;
  accent: string;
  chunks: Piece[];
  crystals: Piece[];
}) {
  // A brilliant-cut pavilion: three breaks in the profile, twice as many sides as the island.
  const pavilion = useMemo(() => {
    const r = radius * 0.95;
    const profile = [
      new Vector2(0.0001, -depth),
      new Vector2(r * 0.34, -depth * 0.66),
      new Vector2(r * 0.74, -depth * 0.3),
      new Vector2(r, -0.05),
      new Vector2(0.0001, 0),
    ];
    return new LatheGeometry(profile, sides * 2, Math.PI / (sides * 2));
  }, [radius, depth, sides]);

  const facets = (
    <meshPhysicalMaterial
      color="#ffffff"
      roughness={0.02}
      metalness={0}
      transmission={1}
      thickness={1.4}
      ior={2.42}
      dispersion={6}
      iridescence={1}
      iridescenceIOR={1.8}
      iridescenceThicknessRange={[200, 900]}
      clearcoat={1}
      clearcoatRoughness={0.02}
      attenuationColor={accent}
      attenuationDistance={14}
      envMapIntensity={3.2}
      specularIntensity={1}
      flatShading
    />
  );
  return (
    <group>
      <mesh position={[0, -0.2, 0]} geometry={pavilion}>
        {facets}
      </mesh>
      {/* The light inside the stone: refracted and split by the facets around it. */}
      <mesh position={[0, -0.4 - depth * 0.45, 0]} scale={[radius * 0.2, depth * 0.3, radius * 0.2]}>
        <octahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#ffffff" emissive={accent} emissiveIntensity={2.2} flatShading toneMapped={false} />
      </mesh>
      <Sparkles
        count={26}
        scale={[radius * 1.5, depth * 0.9, radius * 1.5]}
        position={[0, -0.2 - depth * 0.45, 0]}
        size={6}
        speed={0.3}
        opacity={1}
        color="#ffffff"
      />
      {/* Glints: small hard lights that make the facets flash as the camera moves. */}
      <pointLight position={[radius * 1.1, -depth * 0.35, radius * 0.9]} intensity={40} distance={radius * 2.4} decay={2} color="#ffffff" />
      <pointLight position={[-radius * 1.0, -depth * 0.6, radius * 0.6]} intensity={24} distance={radius * 2.2} decay={2} color={accent} />
      {chunks.map((c, i) => (
        <mesh key={i} position={c.position} rotation={[c.rot ?? 0, (c.rot ?? 0) * 0.7, 0]} scale={[c.size * 0.6, c.size * 1.3, c.size * 0.6]}>
          <octahedronGeometry args={[0.7, 0]} />
          {facets}
        </mesh>
      ))}
      {crystals.map((c, i) => (
        <mesh key={i} position={c.position} scale={[c.size, c.size * 2.4, c.size]}>
          <octahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color="#ffffff" emissive={accent} emissiveIntensity={1.4} flatShading />
        </mesh>
      ))}
    </group>
  );
}
