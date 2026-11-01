import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, DoubleSide, type Group, type MeshBasicMaterial } from 'three';
import { palette } from '../palette';

interface Props {
  radius: number;
  /** Height of the light column above the ring. */
  height: number;
  y?: number;
}

/** Soft pulsing ring and light column marking an object relevant to the current lesson hint. */
export function LearningBeacon({ radius, height, y = 0 }: Props) {
  const ring = useRef<Group>(null);
  const ringMat = useRef<MeshBasicMaterial>(null);
  const beamMat = useRef<MeshBasicMaterial>(null);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const pulse = (t * 0.8) % 1;
    if (ring.current) ring.current.scale.setScalar(1 + pulse * 0.25);
    if (ringMat.current) ringMat.current.opacity = 0.85 * (1 - pulse);
    if (beamMat.current) beamMat.current.opacity = 0.03 + (Math.sin(t * 2.4) * 0.5 + 0.5) * 0.05;
  });

  return (
    <group position={[0, y, 0]} raycast={() => null}>
      <group ref={ring}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} raycast={() => null}>
          <ringGeometry args={[radius * 0.94, radius, 64]} />
          <meshBasicMaterial ref={ringMat} color={palette.gold} transparent depthWrite={false} blending={AdditiveBlending} />
        </mesh>
      </group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]} raycast={() => null}>
        <ringGeometry args={[radius * 0.97, radius * 1.01, 64]} />
        <meshBasicMaterial color={palette.gold} transparent opacity={0.7} depthWrite={false} />
      </mesh>
      <mesh position={[0, height / 2, 0]} raycast={() => null}>
        <cylinderGeometry args={[radius * 0.55, radius * 0.9, height, 32, 1, true]} />
        <meshBasicMaterial
          ref={beamMat}
          color={palette.gold}
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
          side={DoubleSide}
        />
      </mesh>
    </group>
  );
}
