import { useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Environment, Lightformer, Sparkles } from '@react-three/drei';
import { BackSide, Color, type Fog, type Group, type Light, type ShaderMaterial } from 'three';
import { palette } from './palette';
import { seededRandom } from './random';
import { useAwaitingCluster } from './useAwaitingCluster';

const skyVertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const skyFragment = /* glsl */ `
  uniform vec3 top;
  uniform vec3 horizon;
  uniform vec3 bottom;
  uniform vec3 glowA;
  uniform vec3 glowB;
  uniform float dim;
  varying vec3 vWorld;
  void main() {
    vec3 d = normalize(vWorld);
    float h = d.y;
    vec3 col = h > 0.0 ? mix(horizon, top, pow(h, 0.55)) : mix(horizon, bottom, pow(-h, 0.7));
    float a = max(dot(d, normalize(vec3(-0.4, 0.05, -1.0))), 0.0);
    float b = max(dot(d, normalize(vec3(0.9, -0.15, -0.3))), 0.0);
    col *= mix(1.0, 0.2, dim);
    col += glowA * pow(a, 6.0) * 0.55 * mix(1.0, 0.35, dim);
    col += glowB * pow(b, 8.0) * 0.35 * mix(1.0, 0.35, dim);
    gl_FragColor = vec4(col, 1.0);
  }
`;

function Sky({ dim }: { dim: Dim }) {
  const uniforms = useMemo(
    () => ({
      top: { value: new Color('#070b22') },
      horizon: { value: new Color('#2a2b68') },
      bottom: { value: new Color('#121741') },
      glowA: { value: new Color('#7a5cc9') },
      glowB: { value: new Color('#2bb3b0') },
      dim: { value: dim.current },
    }),
    [dim],
  );
  const material = useRef<ShaderMaterial>(null);
  useFrame(() => {
    if (material.current) material.current.uniforms.dim!.value = dim.current;
  });
  return (
    <mesh scale={180}>
      <sphereGeometry args={[1, 32, 16]} />
      <shaderMaterial
        ref={material}
        side={BackSide}
        depthWrite={false}
        uniforms={uniforms}
        vertexShader={skyVertex}
        fragmentShader={skyFragment}
      />
    </mesh>
  );
}

const seaFragment = /* glsl */ `
  uniform vec3 inner;
  uniform vec3 outer;
  uniform float time;
  uniform float dim;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv - 0.5;
    float r = length(p) * 2.0;
    float swirl = sin(atan(p.y, p.x) * 5.0 + r * 14.0 - time * 0.15) * 0.5 + 0.5;
    vec3 col = mix(inner, outer, smoothstep(0.0, 0.9, r));
    col += inner * swirl * 0.08 * (1.0 - r);
    col *= mix(1.0, 0.3, dim);
    float alpha = (1.0 - smoothstep(0.35, 1.0, r)) * 0.85 * mix(1.0, 0.5, dim);
    gl_FragColor = vec4(col, alpha);
  }
`;

const seaVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** A soft luminous haze far below the islands — gives the void a floor. */
function CloudSea({ dim }: { dim: Dim }) {
  const uniforms = useMemo(
    () => ({
      inner: { value: new Color('#2c3f86') },
      outer: { value: new Color('#141a45') },
      time: { value: 0 },
      dim: { value: dim.current },
    }),
    [dim],
  );
  const material = useRef<ShaderMaterial>(null);
  useFrame((_, delta) => {
    const u = material.current?.uniforms;
    if (!u) return;
    u.time!.value += delta;
    u.dim!.value = dim.current;
  });
  return (
    <mesh position={[0, -18, 2]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[200, 200]} />
      <shaderMaterial
        ref={material}
        transparent
        depthWrite={false}
        uniforms={uniforms}
        vertexShader={seaVertex}
        fragmentShader={seaFragment}
      />
    </mesh>
  );
}

/** Distant drifting islets that add depth without competing with the cluster. */
function DistantIslets() {
  const group = useRef<Group>(null);
  const islets = useMemo(() => {
    const rnd = seededRandom('islets');
    return Array.from({ length: 14 }, () => {
      const a = rnd() * Math.PI * 2;
      const r = 38 + rnd() * 30;
      return {
        position: [Math.cos(a) * r, -6 + rnd() * 16, Math.sin(a) * r] as [number, number, number],
        scale: 0.6 + rnd() * 1.8,
        rot: rnd() * Math.PI,
      };
    });
  }, []);
  useFrame((_, delta) => {
    if (group.current) group.current.rotation.y += delta * 0.004;
  });
  return (
    <group ref={group}>
      {islets.map((i, k) => (
        <group key={k} position={i.position} scale={i.scale} rotation={[0, i.rot, 0]}>
          <mesh rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[1, 1.8, 6]} />
            <meshStandardMaterial color={palette.rockDark} flatShading roughness={1} />
          </mesh>
          <mesh position={[0, 0.95, 0]}>
            <cylinderGeometry args={[1, 1, 0.12, 6]} />
            <meshStandardMaterial color={palette.slate} flatShading />
          </mesh>
        </group>
      ))}
    </group>
  );
}

type Dim = MutableRefObject<number>;

const FOG = new Color('#161b47');
const FOG_DARK = new Color('#05071a');
/** How much of their normal intensity the scene lights keep while the universe is dark. */
const DARK_LIGHT = 0.18;

/**
 * 0 for the usual blue universe, 1 while it waits in darkness for the first
 * cluster; eased so the light comes back gradually.
 */
function useDim(): Dim {
  const awaiting = useAwaitingCluster();
  const dim = useRef(awaiting ? 1 : 0);  useFrame((_, delta) => {
    const goal = awaiting ? 1 : 0;
    // Darkening is quick; the dawn after the cluster is born takes a couple of seconds.
    dim.current += (goal - dim.current) * Math.min(1, delta * (awaiting ? 3 : 1.2));
  });
  return dim;
}

export function Atmosphere({ showIslets }: { showIslets: boolean }) {
  const dim = useDim();
  const fog = useRef<Fog>(null);
  const lights = useRef<Light[]>([]);
  const light = (l: Light | null) => {
    if (l && !lights.current.includes(l)) {
      l.userData.baseIntensity = l.intensity;
      lights.current.push(l);
    }
  };

  useFrame(({ scene }) => {
    const d = dim.current;
    fog.current?.color.lerpColors(FOG, FOG_DARK, d);
    const k = 1 - d * (1 - DARK_LIGHT);
    for (const l of lights.current) l.intensity = (l.userData.baseIntensity as number) * k;
    scene.environmentIntensity = k;
  });

  return (
    <>
      <Sky dim={dim} />
      <CloudSea dim={dim} />
      <fog ref={fog} attach="fog" args={['#161b47', 45, 120]} />

      <hemisphereLight ref={light} args={['#b3b9ff', '#1a1f55', 1.0]} />
      <ambientLight ref={light} intensity={0.18} />
      <directionalLight
        ref={light}
        position={[14, 26, 12]}
        intensity={2.1}
        color="#fff1df"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-26}
        shadow-camera-right={26}
        shadow-camera-top={26}
        shadow-camera-bottom={-26}
        shadow-camera-near={1}
        shadow-camera-far={80}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
      />
      <directionalLight ref={light} position={[-18, 8, -16]} intensity={0.9} color={palette.cyan} />
      <pointLight ref={light} position={[0, -9, 4]} intensity={90} distance={60} decay={1} color={palette.lavender} />
      <pointLight ref={light} position={[0, -6, 16]} intensity={40} distance={40} decay={1} color={palette.teal} />

      {/* Local studio environment for soft reflections — no network fetch. */}
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={1.6} color="#b8c8ff" position={[0, 6, -8]} scale={[12, 4, 1]} />
        <Lightformer form="rect" intensity={1.0} color={palette.teal} position={[-8, 2, 4]} scale={[4, 6, 1]} rotation-y={Math.PI / 2} />
        <Lightformer form="ring" intensity={1.4} color={palette.warm} position={[8, 4, 6]} scale={3} />
      </Environment>

      <Sparkles count={160} scale={[60, 22, 50]} position={[0, 4, 2]} size={2.2} speed={0.25} opacity={0.55} color={palette.lilac} />
      <Sparkles count={60} scale={[40, 10, 36]} position={[0, -4, 2]} size={3.5} speed={0.15} opacity={0.4} color={palette.teal} />
      {showIslets && <DistantIslets />}
    </>
  );
}
