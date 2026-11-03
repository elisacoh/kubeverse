import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, SRGBColorSpace, type Group } from 'three';
import { CONTROL_PLANE_POSITION, PLATFORM_TOP, type Vec3 } from '../scene/layout';
import { seededRandom } from '../scene/random';

/** On the island's front edge, clear of the components and their static Pods, turned to face the approach. */
const SPOT: Vec3 = [2.6, PLATFORM_TOP, 3.5];
const FACING = 0.42;
/** Small beside the Pods: a roadside sign, not a billboard. */
const SIZE = 0.42;

const WOOD = '#8a5a34';
const WOOD_DARK = '#5e3a1f';
const POST = '#6b4425';

/** Paints a weathered plank with carved lettering, like a town's welcome sign. */
function paintPlank(text: string, width: number, height: number, fontSize: number, seed: string) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const rnd = seededRandom(seed);

  const base = ctx.createLinearGradient(0, 0, 0, height);
  base.addColorStop(0, '#9a6a3f');
  base.addColorStop(0.5, WOOD);
  base.addColorStop(1, '#73482a');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);

  // Grain: long wavering strokes, a little darker or lighter than the wood.
  for (let i = 0; i < 70; i++) {
    const y = rnd() * height;
    const amp = 2 + rnd() * 5;
    const freq = 0.004 + rnd() * 0.01;
    const phase = rnd() * 10;
    ctx.strokeStyle = rnd() > 0.5 ? 'rgba(60,34,16,0.22)' : 'rgba(190,140,90,0.16)';
    ctx.lineWidth = 1 + rnd() * 2.5;
    ctx.beginPath();
    for (let x = 0; x <= width; x += 16) ctx.lineTo(x, y + Math.sin(x * freq + phase) * amp);
    ctx.stroke();
  }
  // Knots.
  for (let i = 0; i < 3; i++) {
    const x = rnd() * width;
    const y = rnd() * height;
    for (let r = 4; r < 22; r += 4) {
      ctx.strokeStyle = `rgba(70,40,18,${0.35 - r * 0.012})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.8, r * 0.7, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  // Plank seams and a darker frame.
  ctx.strokeStyle = 'rgba(45,25,10,0.55)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2 + 3);
  ctx.stroke();
  ctx.lineWidth = height * 0.07;
  ctx.strokeStyle = WOOD_DARK;
  ctx.strokeRect(0, 0, width, height);
  // Nails in the corners.
  const inset = height * 0.14;
  for (const [x, y] of [[inset, inset], [width - inset, inset], [inset, height - inset], [width - inset, height - inset]]) {
    ctx.fillStyle = '#2b2b30';
    ctx.beginPath();
    ctx.arc(x!, y!, height * 0.03, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.arc(x! - 2, y! - 2, height * 0.012, 0, Math.PI * 2);
    ctx.fill();
  }

  // Carved lettering: a light lower edge under dark, slightly sunken letters.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const spaced = ctx as CanvasRenderingContext2D & { letterSpacing: string };
  const setFont = (size: number) => {
    ctx.font = `bold ${size}px Georgia, 'Times New Roman', serif`;
    spaced.letterSpacing = `${size * 0.08}px`;
  };
  setFont(fontSize);
  // Shrink to sit inside the frame, whatever the fallback font's width.
  const room = width * 0.82;
  const measured = ctx.measureText(text).width;
  if (measured > room) {
    fontSize *= room / measured;
    setFont(fontSize);
  }
  const cx = width / 2;
  const cy = height / 2 + fontSize * 0.05;
  ctx.fillStyle = 'rgba(225,180,125,0.55)';
  ctx.fillText(text, cx + 2, cy + 3);
  ctx.fillStyle = '#3a2210';
  ctx.fillText(text, cx, cy);
  ctx.fillStyle = 'rgba(20,10,4,0.35)';
  ctx.fillText(text, cx - 1, cy - 1);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** Cinematic-only: a little wooden "town entrance" sign on the control plane island. */
export function TownSign() {
  const group = useRef<Group>(null);
  const main = useMemo(() => paintPlank('CONTROL PLANE', 1024, 300, 118, 'sign-main'), []);
  const sub = useMemo(() => paintPlank('kube-system', 640, 170, 82, 'sign-sub'), []);
  const [x, y, z] = CONTROL_PLANE_POSITION;

  // Floats with the island it stands on.
  useFrame(({ clock }) => {
    if (group.current) group.current.position.y = y + Math.sin(clock.elapsedTime * 0.5) * 0.1 + SPOT[1];
  });

  // Box faces in order +x, -x, +y, -y, +z, -z: plain wood on the edges, the painted plank front and back.
  const edges = [0, 1, 2, 3].map((i) => (
    <meshStandardMaterial key={i} attach={`material-${i}`} color={WOOD_DARK} roughness={0.9} />
  ));
  return (
    <group ref={group} position={[x + SPOT[0], y + SPOT[1], z + SPOT[2]]} rotation={[0, FACING, 0]} scale={SIZE} raycast={() => null}>
      {[-1, 1].map((side) => (
        <group key={side} position={[side * 1.05, 0, 0]} rotation={[0, 0, side * -0.03]}>
          <mesh position={[0, 0.95, 0]} castShadow>
            <cylinderGeometry args={[0.065, 0.08, 1.9, 7]} />
            <meshStandardMaterial color={POST} roughness={0.95} flatShading />
          </mesh>
          <mesh position={[0, 1.96, 0]}>
            <coneGeometry args={[0.075, 0.14, 7]} />
            <meshStandardMaterial color={POST} roughness={0.95} flatShading />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 1.48, 0.04]} rotation={[0, 0, 0.025]} castShadow>
        <boxGeometry args={[2.5, 0.73, 0.08]} />
        {edges}
        <meshStandardMaterial attach="material-4" map={main} roughness={0.85} />
        <meshStandardMaterial attach="material-5" map={main} roughness={0.85} />
      </mesh>
      {/* The smaller plank hangs from the big one on two short ropes. */}
      {[-0.42, 0.42].map((dx) => (
        <mesh key={dx} position={[dx, 1.0, 0.04]}>
          <cylinderGeometry args={[0.012, 0.012, 0.24, 5]} />
          <meshStandardMaterial color="#c9b38a" roughness={1} />
        </mesh>
      ))}
      <mesh position={[0, 0.76, 0.04]} rotation={[0, 0, -0.04]} castShadow>
        <boxGeometry args={[1.25, 0.33, 0.06]} />
        {edges}
        <meshStandardMaterial attach="material-4" map={sub} roughness={0.85} />
        <meshStandardMaterial attach="material-5" map={sub} roughness={0.85} />
      </mesh>
    </group>
  );
}
