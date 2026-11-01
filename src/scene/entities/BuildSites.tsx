import { useMemo, useRef, useState } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import { AdditiveBlending, type Group, type MeshStandardMaterial } from 'three';
import { canPerform } from '../../learning/engine';
import { buildSandboxCluster, nextWorkerName } from '../../learning/sandbox';
import { useLearningStore } from '../../learning/useLearningStore';
import { CONTROL_PLANE_POSITION, PLATFORM_TOP, WORKER_RADIUS, nodeLayouts, type Vec3 } from '../layout';
import { palette } from '../palette';
import { WorldLabel } from '../WorldLabel';
import { useLearningHighlight } from '../useLearningHighlight';
import { LearningBeacon } from './LearningBeacon';
import { SeedSpotlight } from './SeedSpotlight';

/**
 * In-world elements that let the learner build their cluster. Which ones
 * appear is decided by the lesson (via the engine), never by this component.
 */
export function BuildSites() {
  const lesson = useLearningStore((s) => s.lesson);
  const session = useLearningStore((s) => s.session);
  const perform = useLearningStore((s) => s.perform);

  const slot = useMemo(() => {
    if (!lesson || !session || !canPerform(lesson, session, 'add-worker-node')) return null;
    const name = nextWorkerName(session.world);
    const future = buildSandboxCluster({ ...session.world, workers: [...session.world.workers, name] });
    return nodeLayouts(future).get(name)?.position ?? null;
  }, [lesson, session]);

  if (!lesson || !session) return null;
  const canOpen = canPerform(lesson, session, 'open-container');
  const canWrap = canPerform(lesson, session, 'create-pod');
  return (
    <>
      {canPerform(lesson, session, 'initialize-cluster') && (
        <ClusterSeed position={CONTROL_PLANE_POSITION} onActivate={() => perform('initialize-cluster')} />
      )}
      {slot && <NodeSlot key={slot.join(',')} position={slot} onActivate={() => perform('add-worker-node')} />}
      {(canOpen || canWrap) && (
        <AppCrate
          position={APP_CRATE_POSITION}
          opened={session.world.containerOpened}
          onActivate={() => perform(canOpen ? 'open-container' : 'create-pod')}
        />
      )}
    </>
  );
}

/** Between the two worker Nodes of a small cluster, in front of the control plane. */
const APP_CRATE_POSITION: Vec3 = [0, 1.2, 8.5];

function usePointer(onActivate: () => void) {
  const [hovered, setHovered] = useState(false);
  const handlers = {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      setHovered(true);
      document.body.style.cursor = 'pointer';
    },
    onPointerOut: () => {
      setHovered(false);
      document.body.style.cursor = '';
    },
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      document.body.style.cursor = '';
      onActivate();
    },
  };
  return { hovered, handlers };
}

/** A floating crystal: the seed of a cluster. */
function ClusterSeed({ position, onActivate }: { position: Vec3; onActivate: () => void }) {
  const { hovered, handlers } = usePointer(onActivate);
  const highlighted = useLearningHighlight({ kind: 'build-site', action: 'initialize-cluster' });
  const crystal = useRef<Group>(null);
  const rings = useRef<Group>(null);
  const core = useRef<MeshStandardMaterial>(null);

  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime;
    if (crystal.current) {
      crystal.current.rotation.y += delta * 0.6;
      crystal.current.position.y = 1.6 + Math.sin(t * 1.4) * 0.15;
      const s = crystal.current.scale.x + ((hovered ? 1.15 : 1) - crystal.current.scale.x) * Math.min(1, delta * 8);
      crystal.current.scale.setScalar(s);
    }
    if (rings.current) {
      rings.current.rotation.y -= delta * 0.35;
      rings.current.rotation.x = Math.sin(t * 0.4) * 0.25;
    }
    if (core.current) core.current.emissiveIntensity = (hovered ? 0.9 : 0.45) + Math.sin(t * 2.2) * 0.15;
  });

  return (
    <group position={position}>
      <group {...handlers}>
        <group ref={crystal} position={[0, 1.6, 0]}>
          <mesh castShadow>
            <octahedronGeometry args={[0.75, 0]} />
            <meshStandardMaterial
              ref={core}
              color={palette.cyan}
              emissive={palette.teal}
              emissiveIntensity={0.45}
              roughness={0.25}
              metalness={0.2}
              flatShading
            />
          </mesh>
          <mesh scale={1.9}>
            <sphereGeometry args={[0.75, 24, 16]} />
            <meshBasicMaterial color={palette.cyan} transparent opacity={0.08} depthWrite={false} blending={AdditiveBlending} />
          </mesh>
        </group>
        {/* Invisible, generous hit area. */}
        <mesh position={[0, 1.6, 0]} visible={false}>
          <sphereGeometry args={[1.6, 12, 8]} />
          <meshBasicMaterial />
        </mesh>
      </group>
      <group ref={rings} position={[0, 1.6, 0]}>
        {[1.4, 1.9].map((r, i) => (
          <mesh key={r} rotation={[Math.PI / 2 + i * 0.5, 0, 0]} raycast={() => null}>
            <torusGeometry args={[r, 0.015, 8, 96]} />
            <meshBasicMaterial color={i ? palette.lavender : palette.cyan} transparent opacity={0.6} />
          </mesh>
        ))}
      </group>
      <SeedSpotlight y={1.6} />
      {highlighted && <LearningBeacon radius={1.9} height={3.4} y={-0.2} />}
      <WorldLabel position={[0, -0.2, 0]} center>
        <button
          type="button"
          className={`kv-nameplate ${hovered ? 'is-active' : ''}`}
          style={{ ['--accent' as string]: palette.cyan }}
          onClick={onActivate}
        >
          <span className="kv-nameplate-kind">Start here</span>
          Initialize cluster
        </button>
      </WorldLabel>
    </group>
  );
}

/** Image layers, bottom to top, shown when the container is opened. */
const CRATE_LAYERS = [
  { label: 'libraries', color: palette.slate },
  { label: 'Node.js runtime', color: palette.lavender },
  { label: 'app code · server.js', color: palette.teal },
] as const;

const CRATE = 1.5;

/**
 * The learner's application, packed as a container: a translucent crate.
 * Opened, it fans out into its image layers with the app process glowing on top.
 */
function AppCrate({ position, opened, onActivate }: { position: Vec3; opened: boolean; onActivate: () => void }) {
  const { hovered, handlers } = usePointer(onActivate);
  const highlighted = useLearningHighlight({ kind: 'build-site', action: opened ? 'create-pod' : 'open-container' });
  const root = useRef<Group>(null);
  const layers = useRef<(Group | null)[]>([]);
  const core = useRef<Group>(null);
  const shell = useRef<MeshStandardMaterial>(null);
  const spread = useRef(opened ? 1 : 0);

  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime;
    spread.current += ((opened ? 1 : 0) - spread.current) * Math.min(1, delta * 3);
    const s = spread.current;
    if (root.current) {
      root.current.position.y = Math.sin(t * 1.3) * 0.12;
      root.current.rotation.y = opened ? Math.sin(t * 0.4) * 0.3 : root.current.rotation.y + delta * 0.4;
      const goal = (opened ? 1.35 : 1) * (hovered ? 1.08 : 1);
      const k = root.current.scale.x + (goal - root.current.scale.x) * Math.min(1, delta * 6);
      root.current.scale.setScalar(k);
    }
    layers.current.forEach((g, i) => {
      if (g) g.position.y = (i - 1) * (0.4 + s * 0.42) + s * 0.5;
    });
    if (core.current) {
      core.current.position.y = 0.95 + s * 1.25;
      core.current.rotation.y = t * 1.2;
      core.current.scale.setScalar(1 + Math.sin(t * 3) * 0.08);
    }
    if (shell.current) shell.current.opacity = 0.32 * (1 - s) + 0.05;
  });

  return (
    <group position={position}>
      <group ref={root} {...handlers}>
        <RoundedBox args={[CRATE, CRATE * 1.15, CRATE]} radius={0.18} smoothness={4} position={[0, 0.2, 0]}>
          <meshStandardMaterial
            ref={shell}
            color={palette.cyan}
            emissive={palette.teal}
            emissiveIntensity={hovered ? 0.5 : 0.25}
            transparent
            opacity={0.37}
            depthWrite={false}
          />
        </RoundedBox>
        {CRATE_LAYERS.map((l, i) => (
          <group
            key={l.label}
            ref={(g) => {
              layers.current[i] = g;
            }}
          >
            <RoundedBox args={[CRATE * 0.8, 0.3, CRATE * 0.8]} radius={0.07} smoothness={3}>
              <meshStandardMaterial color={l.color} emissive={l.color} emissiveIntensity={0.35} roughness={0.4} />
            </RoundedBox>
            {opened && (
              <WorldLabel position={[CRATE * 0.55, 0, 0]} style={{ pointerEvents: 'none' }}>
                <div className="kv-tag whitespace-nowrap">
                  <span className="kv-tag-role">layer</span>
                  {l.label}
                </div>
              </WorldLabel>
            )}
          </group>
        ))}
        <group ref={core}>
          <mesh>
            <icosahedronGeometry args={[0.2, 1]} />
            <meshStandardMaterial color={palette.teal} emissive={palette.teal} emissiveIntensity={2} flatShading />
          </mesh>
          {opened && (
            <WorldLabel position={[0, 0.45, 0]} center style={{ pointerEvents: 'none' }}>
              <div className="kv-tag is-net whitespace-nowrap">
                <span className="kv-tag-role">process</span>node server.js
              </div>
            </WorldLabel>
          )}
        </group>
        <mesh position={[0, 0.4, 0]} visible={false}>
          <boxGeometry args={[2.2, 3.4, 2.2]} />
          <meshBasicMaterial />
        </mesh>
      </group>
      {highlighted && <LearningBeacon radius={1.5} height={3.6} y={-1.3} />}
      <WorldLabel position={[0, opened ? -2.1 : -1.35, 0]} center>
        <button
          type="button"
          className={`kv-nameplate ${hovered ? 'is-active' : ''}`}
          style={{ ['--accent' as string]: palette.teal }}
          onClick={onActivate}
        >
          <span className="kv-nameplate-kind">Container · hello-web:1.0</span>
          {opened ? '+ Wrap it in a Pod' : 'Open the container'}
        </button>
      </WorldLabel>
    </group>
  );
}

/** A faint, empty platform where the next worker Node will appear. */
function NodeSlot({ position, onActivate }: { position: Vec3; onActivate: () => void }) {
  const { hovered, handlers } = usePointer(onActivate);
  const highlighted = useLearningHighlight({ kind: 'build-site', action: 'add-worker-node' });
  const dashes = useRef<Group>(null);
  const plus = useRef<Group>(null);
  const R = WORKER_RADIUS;

  useFrame(({ clock }, delta) => {
    if (dashes.current) dashes.current.rotation.y += delta * 0.15;
    if (plus.current) {
      plus.current.position.y = PLATFORM_TOP + 1.2 + Math.sin(clock.elapsedTime * 1.6) * 0.12;
      plus.current.rotation.y += delta * 0.8;
    }
  });

  const opacity = hovered ? 0.22 : 0.1;
  const DASHES = 36;

  return (
    <group position={position}>
      <group {...handlers}>
        <mesh position={[0, PLATFORM_TOP - 0.25, 0]}>
          <cylinderGeometry args={[R, R * 0.94, 0.5, 64]} />
          <meshBasicMaterial color={palette.cyan} transparent opacity={opacity} depthWrite={false} />
        </mesh>
      </group>
      <group ref={dashes} position={[0, PLATFORM_TOP + 0.02, 0]}>
        {Array.from({ length: DASHES }, (_, i) => {
          const a = (i / DASHES) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.cos(a) * R, 0, Math.sin(a) * R]} rotation={[0, -a, 0]} raycast={() => null}>
              <boxGeometry args={[0.05, 0.05, 0.42]} />
              <meshBasicMaterial color={palette.cyan} transparent opacity={hovered ? 0.95 : 0.55} />
            </mesh>
          );
        })}
      </group>
      <group ref={plus} position={[0, PLATFORM_TOP + 1.2, 0]}>
        {[0, Math.PI / 2].map((r) => (
          <mesh key={r} rotation={[0, 0, r]} raycast={() => null}>
            <boxGeometry args={[0.9, 0.18, 0.18]} />
            <meshStandardMaterial color={palette.cyan} emissive={palette.cyan} emissiveIntensity={hovered ? 2.4 : 1.3} />
          </mesh>
        ))}
      </group>
      {highlighted && <LearningBeacon radius={R + 0.35} height={3} y={PLATFORM_TOP} />}
      <WorldLabel position={[0, PLATFORM_TOP + 2.3, 0]} center>
        <button
          type="button"
          className={`kv-nameplate ${hovered ? 'is-active' : ''}`}
          style={{ ['--accent' as string]: palette.cyan }}
          onClick={onActivate}
        >
          <span className="kv-nameplate-kind">Empty slot</span>+ Add worker Node
        </button>
      </WorldLabel>
    </group>
  );
}
