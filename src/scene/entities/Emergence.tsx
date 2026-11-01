import { useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, type Group, type Mesh, type MeshBasicMaterial } from 'three';
import { palette } from '../palette';
import { PLATFORM_TOP } from '../layout';

interface Props {
  /** Play the entrance; when false, children render in place immediately. */
  active: boolean;
  radius: number;
  accent: string;
  children: ReactNode;
}

const DURATION = 1.9;
const easeOutBack = (t: number) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/** A platform rising out of the void, with a shockwave ring where it settles. */
export function Emergence({ active, radius, accent, children }: Props) {
  const body = useRef<Group>(null);
  const wave = useRef<Mesh>(null);
  const waveMat = useRef<MeshBasicMaterial>(null);
  const t = useRef(active ? 0 : 1);

  useFrame((_, delta) => {
    if (t.current >= 1.6) return;
    t.current = Math.min(1.6, t.current + delta / DURATION);
    const p = Math.min(1, t.current);
    if (body.current) {
      body.current.scale.setScalar(Math.max(0.001, easeOutBack(p)));
      body.current.position.y = (1 - easeOutCubic(p)) * -6;
    }
    // The shockwave starts as the platform arrives and fades out afterwards.
    const w = Math.max(0, (t.current - 0.55) / 1.05);
    if (wave.current) wave.current.scale.setScalar(0.8 + w * 1.4);
    if (waveMat.current) waveMat.current.opacity = w > 0 && w < 1 ? (1 - w) * 0.7 : 0;
  });

  const start = active ? 0.001 : 1;
  return (
    <>
      <group ref={body} scale={start} position={[0, active ? -6 : 0, 0]}>
        {children}
      </group>
      {active && (
        <mesh ref={wave} rotation={[-Math.PI / 2, 0, 0]} position={[0, PLATFORM_TOP + 0.05, 0]} raycast={() => null}>
          <ringGeometry args={[radius * 0.96, radius * 1.04, 96]} />
          <meshBasicMaterial
            ref={waveMat}
            color={accent ?? palette.cyan}
            transparent
            opacity={0}
            depthWrite={false}
            blending={AdditiveBlending}
          />
        </mesh>
      )}
    </>
  );
}
