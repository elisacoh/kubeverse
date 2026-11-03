import { useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import { AdditiveBlending, Color, type PointLight, type ShaderMaterial } from 'three';
import { CONTROL_PLANE_POSITION } from '../scene/layout';
import { palette } from '../scene/palette';

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragment = /* glsl */ `
  uniform vec3 core;
  uniform vec3 halo;
  uniform float strength;
  uniform float time;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv - 0.5;
    float r = length(p) * 2.0;
    float a = atan(p.y, p.x);
    float fall = max(1.0 - r, 0.0);
    float inner = pow(fall, 6.0);
    float soft = pow(fall, 1.6) * 0.34;
    float rays = pow(abs(sin(a * 6.0 + time * 0.04)), 24.0) * 0.32
               + pow(abs(sin(a * 11.0 - time * 0.03 + 1.3)), 30.0) * 0.18;
    rays *= pow(fall, 2.2);
    vec3 col = mix(halo, core, clamp(inner * 1.6, 0.0, 1.0));
    gl_FragColor = vec4(col, (inner + soft + rays) * strength);
  }
`;

interface Props {
  /** Sequence time in seconds. */
  time: MutableRefObject<number>;
  /** Light level, 0 … 1, at a sequence time. */
  level: (t: number) => number;
}

const RIM_INTENSITY = 160;
const UP_INTENSITY = 28;

/**
 * Cinematic-only: an enormous light rising far behind the control plane,
 * with rim and up-lights so its components stand out against it.
 */
export function ControlPlaneDawn({ time, level }: Props) {
  const glow = useRef<ShaderMaterial>(null);
  const rim = useRef<PointLight>(null);
  const up = useRef<PointLight>(null);
  const uniforms = useMemo(
    () => ({
      core: { value: new Color('#fff1d6') },
      halo: { value: new Color(palette.lavender) },
      strength: { value: 0 },
      time: { value: 0 },
    }),
    [],
  );
  const [x, y, z] = CONTROL_PLANE_POSITION;

  useFrame(() => {
    const t = time.current;
    const k = level(t);
    const u = glow.current?.uniforms;
    if (u) {
      u.strength!.value = k;
      u.time!.value = t;
    }
    // Lights stay in the scene at zero so their appearance never recompiles materials mid-shot.
    if (rim.current) rim.current.intensity = RIM_INTENSITY * k;
    if (up.current) up.current.intensity = UP_INTENSITY * k;
  });

  return (
    <>
      {/* Slightly left of the island's axis, so it sits behind the control plane for most of the camera move. */}
      <Billboard position={[x - 3, y + 8.4, z - 45]}>
        <mesh raycast={() => null}>
          <planeGeometry args={[90, 90]} />
          <shaderMaterial
            ref={glow}
            uniforms={uniforms}
            vertexShader={vertex}
            fragmentShader={fragment}
            transparent
            depthWrite={false}
            blending={AdditiveBlending}
          />
        </mesh>
      </Billboard>
      <pointLight ref={rim} position={[x, y + 6, z - 9]} intensity={0} distance={34} decay={1.2} color={palette.lilac} />
      <pointLight ref={up} position={[x, y - 0.5, z + 6.5]} intensity={0} distance={8} decay={1.2} color={palette.gold} />
    </>
  );
}
