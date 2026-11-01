import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard, Sparkles } from '@react-three/drei';
import { AdditiveBlending, Color, DoubleSide, type ShaderMaterial } from 'three';
import { palette } from '../palette';

const shaftVertex = /* glsl */ `
  varying vec2 vUv;
  varying float vFacing;
  void main() {
    vUv = uv;
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * normal);
    vFacing = abs(dot(n, normalize(-view.xyz)));
    gl_Position = projectionMatrix * view;
  }
`;

const shaftFragment = /* glsl */ `
  uniform vec3 color;
  uniform float strength;
  varying vec2 vUv;
  varying float vFacing;
  void main() {
    // uv.y runs from the bottom (0) to the top (1) of the open cylinder.
    float along = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
    float edge = pow(vFacing, 2.0);
    gl_FragColor = vec4(color, along * edge * strength);
  }
`;

const haloFragment = /* glsl */ `
  uniform vec3 color;
  uniform float strength;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float glow = pow(max(1.0 - r, 0.0), 1.6);
    gl_FragColor = vec4(color, glow * strength);
  }
`;

const haloVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SHAFT_HEIGHT = 16;
const FADE_IN_SECONDS = 1.6;

/** A stage light falling from above onto the cluster seed, so the eye goes there first in the dark universe. */
export function SeedSpotlight({ y }: { y: number }) {
  const born = useRef<number | null>(null);
  const shaftMat = useRef<ShaderMaterial>(null);
  const haloMat = useRef<ShaderMaterial>(null);
  const shaft = useMemo(() => ({ color: { value: new Color(palette.lilac) }, strength: { value: 0 } }), []);
  const halo = useMemo(() => ({ color: { value: new Color(palette.cyan) }, strength: { value: 0 } }), []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    born.current ??= t;
    const x = Math.min(1, (t - born.current) / FADE_IN_SECONDS);
    const fade = x * x * (3 - 2 * x);
    const breathe = 0.85 + Math.sin(t * 1.1) * 0.15;
    if (shaftMat.current) shaftMat.current.uniforms.strength!.value = 0.2 * fade * breathe;
    if (haloMat.current) haloMat.current.uniforms.strength!.value = 0.45 * fade * breathe;
  });

  return (
    <group raycast={() => null}>
      <mesh position={[0, y - 1.2 + SHAFT_HEIGHT / 2, 0]} raycast={() => null}>
        <cylinderGeometry args={[0.3, 2, SHAFT_HEIGHT, 48, 1, true]} />
        <shaderMaterial
          ref={shaftMat}
          uniforms={shaft}
          vertexShader={shaftVertex}
          fragmentShader={shaftFragment}
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
          side={DoubleSide}
        />
      </mesh>
      <Billboard position={[0, y, 0]}>
        <mesh raycast={() => null}>
          <planeGeometry args={[7, 7]} />
          <shaderMaterial
            ref={haloMat}
            uniforms={halo}
            vertexShader={haloVertex}
            fragmentShader={haloFragment}
            transparent
            depthWrite={false}
            blending={AdditiveBlending}
          />
        </mesh>
      </Billboard>
      <Sparkles count={28} scale={[2.6, 9, 2.6]} position={[0, y + 3, 0]} size={1.6} speed={0.2} opacity={0.6} color={palette.lilac} />
    </group>
  );
}
