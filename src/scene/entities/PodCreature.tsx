import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  MeshStandardMaterial,
  type Group,
  type Mesh,
  type MeshBasicMaterial,
  type MeshPhysicalMaterial,
} from 'three';
import type { Pod } from '../../domain/types';
import { podCondition } from '../../domain/selectors';
import {
  DEMO_LOOP,
  createFrame,
  createLiveCrashLoop,
  crashLoopingContainer,
  followCrashLoop,
  observeCrashLoop,
  simulateCrashLoop,
  type CrashLoopFrame,
} from '../../domain/crashLoop';
import { lodOf } from '../lod';
import { useAppStore } from '../../state/useAppStore';
import { conditionColor, namespaceColorOf, palette } from '../palette';
import { useHoverHandlers, useIsHovered } from '../interaction';
import type { Vec3 } from '../layout';
import { WorldLabel } from '../WorldLabel';
import { OriginTrait, StaticBasePlate } from './OriginTrait';
import { LearningBeacon } from './LearningBeacon';
import { useLearningHighlight } from '../useLearningHighlight';
import { useFirstAppearance } from '../appearance';
import { creaturePoses } from '../creaturePose';

interface Props {
  pod: Pod;
  position: Vec3;
  accent: string;
  /** Rotation around Y so creatures face outward / toward the camera. */
  facing?: number;
  scale?: number;
}

const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0;
  return h;
};

export function PodCreature(props: Props) {
  return props.pod.awaitingKubelet ? <AssignedPod {...props} /> : <PodCreatureBody {...props} />;
}

/**
 * A Pod bound to this Node that its kubelet has not acted on yet: only a
 * translucent silhouette. No container exists, so there is no creature.
 */
function AssignedPod({ pod, position, facing = 0 }: Props) {
  const uid = pod.metadata.uid;
  const selected = useAppStore((s) => s.selection?.kind === 'pod' && s.selection.uid === uid);
  const selectPod = useAppStore((s) => s.selectPod);
  const hovered = useIsHovered(uid);
  const hover = useHoverHandlers(uid);
  const highlighted = useLearningHighlight({ kind: 'pod', podId: uid });
  const shell = useRef<Group>(null);
  const ring = useRef<Mesh>(null);

  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime;
    if (shell.current) shell.current.position.y = 0.44 + Math.sin(t * 1.2) * 0.03;
    if (ring.current) ring.current.rotation.z += delta * 0.6;
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    selectPod(uid);
  };

  return (
    <group position={position} rotation={[0, facing, 0]}>
      {highlighted && <LearningBeacon radius={0.7} height={1.8} />}
      <group {...hover} onClick={onClick}>
        <mesh ref={ring} position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.5, selected ? 0.6 : 0.55, 6, 1]} />
          <meshBasicMaterial color={selected ? palette.cyan : palette.lavender} transparent opacity={0.8} />
        </mesh>
        <group ref={shell} position={[0, 0.44, 0]}>
          <mesh scale={[1, 0.93, 0.95]}>
            <sphereGeometry args={[0.4, 20, 14]} />
            <meshBasicMaterial color={palette.cyan} wireframe transparent opacity={hovered ? 0.55 : 0.35} />
          </mesh>
          <mesh scale={[1, 0.93, 0.95]}>
            <sphereGeometry args={[0.4, 32, 20]} />
            <meshBasicMaterial color={palette.cyan} transparent opacity={0.07} depthWrite={false} />
          </mesh>
        </group>
      </group>
      <WorldLabel position={[0, 1.15, 0]} center style={{ pointerEvents: 'none' }}>
        <div className="kv-label">
          <span className="kv-label-dot" style={{ background: conditionColor.warning }} />
          {pod.metadata.name}
          <span className="opacity-70"> · bound, waiting for the kubelet</span>
        </div>
      </WorldLabel>
    </group>
  );
}

function PodCreatureBody({ pod, position, accent, facing = 0, scale = 1 }: Props) {
  const uid = pod.metadata.uid;
  const selected = useAppStore((s) => s.selection?.kind === 'pod' && s.selection.uid === uid);
  const selectPod = useAppStore((s) => s.selectPod);
  const exploreInside = useAppStore((s) => s.exploreInside);
  const hovered = useIsHovered(uid);
  const hover = useHoverHandlers(uid);
  const closeUp = useAppStore((s) => s.view.kind === 'node' && s.view.closeUp === uid);

  const condition = podCondition(pod);
  // Pending is not distress: the Pod is simply not running yet.
  const pending = pod.phase === 'Pending';
  // CrashLoopBackOff has its own animation; the generic distress shiver is for everything else.
  const loopIndex = useMemo(() => {
    const c = crashLoopingContainer(pod);
    return c ? pod.containers.indexOf(c) : -1;
  }, [pod]);
  const crashLooping = loopIndex >= 0;
  const distressed = !pending && !crashLooping && (condition === 'warning' || condition === 'failed');
  const highlighted = useLearningHighlight({ kind: 'pod', podId: uid });
  const firstAppearance = useFirstAppearance(uid);
  const arrives = useAppStore((s) => s.presentation.animateEntries) && firstAppearance;
  const bodyColor = namespaceColorOf(pod.metadata.namespace);
  const footColor = useMemo(() => new Color(bodyColor).multiplyScalar(0.6).getStyle(), [bodyColor]);
  const eyeColor = distressed ? conditionColor[condition] : EYE_COLOR;

  // Demo data simulates the loop; live data is only followed, never embellished.
  const source = useAppStore((s) => s.cluster.source);
  const simulated = source === 'demo' && crashLooping;
  const tracksLoop = simulated || source === 'live';
  const observation = useMemo(() => observeCrashLoop(pod), [pod]);

  const seed = useMemo(() => hash(uid), [uid]);
  const phase = (seed % 1000) / 159;
  const slump = seed % 2 === 0 ? 1 : -1;

  const placement = useRef<Group>(null);
  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
  const eyes = useRef<Group>(null);
  const xEyes = useRef<Group>(null);
  const smile = useRef<Mesh>(null);
  const frown = useRef<Mesh>(null);
  const ring = useRef<Mesh>(null);
  const auraMesh = useRef<Mesh>(null);
  const aura = useRef<MeshStandardMaterial>(null);
  const spinner = useRef<Mesh>(null);
  const bodyMat = useRef<MeshPhysicalMaterial>(null);
  const bellyMats = useRef<(MeshStandardMaterial | null)[]>([]);
  const retry = useRef<Group>(null);
  const retryMat = useRef<MeshBasicMaterial>(null);
  const bead = useRef<Mesh>(null);
  const beadMat = useRef<MeshBasicMaterial>(null);
  const status = useRef<HTMLSpanElement>(null);

  // One material for both eyes, the X eyes and the mouth, so a frame can dim them all at once.
  const faceMat = useMemo(
    () => new MeshStandardMaterial({ color: eyeColor, emissive: eyeColor, emissiveIntensity: 1.6 }),
    [eyeColor],
  );
  useEffect(() => () => faceMat.dispose(), [faceMat]);
  const baseBody = useMemo(() => new Color(bodyColor), [bodyColor]);

  const loop = useRef({ frame: createFrame(), live: createLiveCrashLoop(), start: -1 });

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const pose = creaturePoses.get(uid);
    if (pose) pose.anchor = placement.current;
    if (root.current) {
      const target = (hovered ? 1.12 : 1) * scale;
      const s = root.current.scale.x + (target - root.current.scale.x) * Math.min(1, delta * 10);
      root.current.scale.setScalar(s);
    }

    // The loop's clock keeps running offscreen, so a creature never falls out of step with its data.
    const L = loop.current;
    let frame: CrashLoopFrame | null = null;
    if (simulated) {
      if (L.start < 0) L.start = t - (seed % 50) / 10;
      frame = simulateCrashLoop(t - L.start, observation.restarts, DEMO_LOOP, L.frame);
    } else if (tracksLoop) {
      frame = followCrashLoop(L.live, observation, t, L.frame);
    }

    const lod = root.current ? lodOf(state.camera, t, root.current) : 'near';
    if (lod === 'hidden') return;
    const near = lod === 'near';

    // Pose: collapse (0 upright … 1 slumped; negative overshoots upwards), glitch, lost glow.
    let collapse = 0;
    let glitch = 0;
    let dim = 0;
    let crossed = false;
    let open = 1;
    let retryAmount = 0;
    let retryProgress = 0;
    let flash = 0;
    let auraOpacity = 0;
    if (frame) {
      const p = frame.progress;
      switch (frame.phase) {
        case 'crashing':
          glitch = p < 0.55 ? 1 : Math.max(0, 1 - (p - 0.55) / 0.2);
          collapse = smoothstep(0.45, 1, p);
          dim = smoothstep(0.35, 0.95, p);
          crossed = p < 0.5 ? Math.sin(t * 38) > 0.3 : true;
          auraOpacity = 0.2 * (1 - p);
          break;
        case 'backoff':
          collapse = 1;
          dim = 1;
          crossed = true;
          retryAmount = 1;
          retryProgress = p;
          break;
        case 'restarting':
          collapse = 1 - easeOutBack(p);
          dim = 1 - smoothstep(0, 0.7, p);
          crossed = p < 0.2;
          open = Math.max(0.1, smoothstep(0.15, 0.55, p));
          retryAmount = 1 - p;
          retryProgress = 1;
          flash = 1 - p;
          break;
        case 'running':
          break;
      }
      if (!near) glitch = 0;
    }
    const down = Math.max(0, collapse);
    const calm = 1 - down;

    if (spinner.current) spinner.current.rotation.z -= delta * 4;
    if (body.current) {
      const bob = distressed
        ? Math.sin(t * 14 + phase) * 0.008
        : Math.sin(t * (pending ? 0.9 : 2) + phase) * (pending ? 0.015 : 0.035);
      const hop = selected ? Math.max(0, Math.sin(t * 4)) * 0.06 : 0;
      const breathe = down * Math.sin(t * 1.3 + phase) * 0.006;
      const sleep = pose?.droop ?? 0;
      const sleepBreath = sleep * (Math.sin(t * 1.1) * 0.012 - 0.03);
      body.current.position.set(
        glitch * Math.sin(t * 71 + phase) * 0.025,
        0.44 + (bob * (1 - sleep) + hop) * calm - 0.055 * down - Math.min(0, collapse) * 0.08 + breathe + sleepBreath,
        glitch * Math.cos(t * 67 + phase) * 0.015,
      );
      body.current.rotation.set(
        down * 0.1 + sleep * 0.22,
        pose?.gaze ?? Math.sin(t * 0.45 + phase) * 0.35 * (1 - down * 0.7),
        (distressed ? Math.sin(t * 9 + phase) * 0.03 : 0) + collapse * 0.2 * slump + glitch * Math.sin(t * 47 + phase) * 0.09,
      );
      const squash = (1 + Math.sin(t * 4 + phase) * 0.015) * (1 - 0.09 * collapse);
      const wide = (1 / (1 + Math.sin(t * 4 + phase) * 0.015)) * (1 + 0.05 * collapse);
      body.current.scale.set(wide, squash, wide);
    }
    if (eyes.current) {
      const cycle = (t + phase * 3) % 4.2;
      const blink = cycle < 0.12 ? 0.15 : 1;
      eyes.current.visible = !crossed;
      eyes.current.scale.y = pose
        ? Math.max(0.06, pose.eyes)
        : (distressed ? 0.35 : pending ? 0.2 : blink) * open;
    }
    if (pose) {
      const wave = Math.sin(t * 2.2) * 0.5 + 0.5;
      for (const m of bellyMats.current) if (m) m.emissiveIntensity = 2 + pose.glow * (wave * 2.4 - 0.8);
      if (bodyMat.current) {
        bodyMat.current.emissive.copy(baseBody);
        bodyMat.current.emissiveIntensity = pose.glow * (0.06 + wave * 0.22);
      }
    }
    if (tracksLoop) {
      if (xEyes.current) xEyes.current.visible = crossed;
      if (smile.current) smile.current.visible = !crossed && !distressed;
      if (frown.current) frown.current.visible = crossed || distressed;
      const flicker = glitch > 0 && Math.sin(t * 31) < 0 ? 0.35 : 1;
      faceMat.emissiveIntensity = (1.6 * (1 - 0.75 * dim) + flash * 1.4) * flicker;
      if (bodyMat.current) bodyMat.current.color.copy(baseBody).lerp(FADED, 0.4 * dim);
      for (const m of bellyMats.current) if (m) m.emissiveIntensity = 2 * (1 - 0.85 * dim) * flicker + flash * 1.5;
      const loopLight = bellyMats.current[loopIndex];
      if (simulated && frame && loopLight) {
        const c = LIGHT_COLOR[frame.phase];
        loopLight.color.copy(c);
        loopLight.emissive.copy(c);
      }
      if (auraMesh.current && crashLooping) auraMesh.current.visible = auraOpacity > 0.01;
      if (aura.current && crashLooping) aura.current.opacity = auraOpacity;
      if (retry.current) {
        const shown = near && retryAmount > 0.01;
        retry.current.visible = shown;
        if (shown) {
          retry.current.scale.setScalar(1 + flash * 0.4);
          retry.current.rotation.z = -t * 0.6;
          if (retryMat.current) {
            retryMat.current.opacity = 0.28 * retryAmount + flash * 0.4;
            retryMat.current.color.copy(RETRY_COLOR).lerp(WAKE_COLOR, flash);
          }
          if (bead.current) {
            const a = Math.PI / 2 - retryProgress * Math.PI * 2 + t * 0.6;
            bead.current.position.set(Math.cos(a) * RETRY_RADIUS, Math.sin(a) * RETRY_RADIUS, 0);
          }
          if (beadMat.current) {
            beadMat.current.opacity = retryAmount;
            beadMat.current.color.copy(RETRY_COLOR).lerp(WAKE_COLOR, flash);
          }
        }
      }
      if (status.current) {
        const text = frame ? loopLabel(frame) : '';
        if (text !== status.current.textContent) status.current.textContent = text;
      }
    }
    if (ring.current) ring.current.rotation.z += delta * 0.8;
    if (aura.current && !crashLooping) aura.current.opacity = 0.1 + (Math.sin(t * 3) * 0.5 + 0.5) * 0.12;
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    selectPod(uid);
  };
  const onDoubleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    exploreInside(uid);
  };

  const containers = pod.containers;
  const lightSpacing = 0.075;

  return (
    <group ref={placement} position={position} rotation={[0, facing, 0]}>
      {highlighted && <LearningBeacon radius={0.7} height={1.8} />}
      <Arrival active={arrives}>
      <group ref={root} scale={scale} {...hover} onClick={onClick} onDoubleClick={onDoubleClick}>
        {pod.origin === 'static' && <StaticBasePlate />}
        {(selected || hovered) && (
          <mesh ref={ring} position={[0, 0.035, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.46, selected ? 0.56 : 0.5, 6, 1]} />
            <meshBasicMaterial color={selected ? palette.cyan : palette.lilac} transparent opacity={selected ? 0.9 : 0.5} />
          </mesh>
        )}

        {/* feet */}
        {[-0.15, 0.15].map((x) => (
          <mesh key={x} position={[x, 0.08, 0.04]} castShadow>
            <sphereGeometry args={[0.09, 16, 12]} />
            <meshStandardMaterial color={footColor} roughness={0.5} />
          </mesh>
        ))}

        <group ref={body} position={[0, 0.44, 0]}>
          <mesh castShadow receiveShadow scale={[1, 0.93, 0.95]}>
            <sphereGeometry args={[0.4, 48, 32]} />
            <meshPhysicalMaterial
              ref={bodyMat}
              color={bodyColor}
              roughness={0.32}
              clearcoat={1}
              clearcoatRoughness={0.2}
              sheen={0.5}
              sheenColor={palette.lilac}
            />
          </mesh>

          {/* side fins */}
          {[-1, 1].map((side) => (
            <mesh key={side} position={[side * 0.37, 0.1, -0.02]} rotation={[0, 0, side * -0.5]} scale={[0.45, 1, 0.55]}>
              <sphereGeometry args={[0.11, 16, 12]} />
              <meshStandardMaterial color={palette.lilac} roughness={0.4} />
            </mesh>
          ))}

          {/* visor */}
          <mesh position={[0, 0.05, 0.25]} scale={[1.2, 0.78, 0.6]}>
            <sphereGeometry args={[0.25, 32, 24]} />
            <meshPhysicalMaterial color={palette.ink} roughness={0.12} metalness={0.3} clearcoat={1} />
          </mesh>

          <group ref={eyes} position={[0, 0.07, 0.395]}>
            {[-0.085, 0.085].map((x) => (
              <mesh key={x} position={[x, 0, 0]} material={faceMat}>
                <capsuleGeometry args={[0.028, 0.045, 4, 12]} />
              </mesh>
            ))}
          </group>

          {/* X_X: the container has crashed */}
          {tracksLoop && (
            <group ref={xEyes} position={[0, 0.07, 0.395]} visible={false}>
              {[-0.085, 0.085].map((x) =>
                [1, -1].map((d) => (
                  <mesh key={`${x}${d}`} position={[x, 0, 0]} rotation={[0, 0, (d * Math.PI) / 4]} material={faceMat}>
                    <boxGeometry args={[0.075, 0.018, 0.012]} />
                  </mesh>
                )),
              )}
            </group>
          )}

          {/* mouth: smile, or a small frown when distressed */}
          {(tracksLoop || !distressed) && (
            <mesh ref={smile} position={[0, -0.02, 0.4]} rotation={[0, 0, Math.PI]} material={faceMat}>
              <torusGeometry args={[0.03, 0.007, 6, 16, Math.PI]} />
            </mesh>
          )}
          {(tracksLoop || distressed) && (
            <mesh ref={frown} position={[0, -0.045, 0.4]} material={faceMat} visible={distressed}>
              <torusGeometry args={[0.03, 0.007, 6, 16, Math.PI]} />
            </mesh>
          )}

          {/* belly lights: one per container */}
          {containers.map((c, i) => {
            const x = (i - (containers.length - 1) / 2) * lightSpacing;
            const col =
              c.status.state === 'running'
                ? conditionColor.ok
                : c.status.state === 'waiting'
                  ? conditionColor.warning
                  : conditionColor.done;
            return (
              <mesh key={c.name} position={[x, -0.2, 0.335]}>
                <sphereGeometry args={[0.024, 12, 12]} />
                <meshStandardMaterial
                  ref={(m) => {
                    bellyMats.current[i] = m;
                  }}
                  color={col}
                  emissive={col}
                  emissiveIntensity={2}
                />
              </mesh>
            );
          })}

          <OriginTrait origin={pod.origin} accent={accent} phase={phase} name={pod.metadata.name} uid={uid} />

          {(distressed || crashLooping) && (
            <mesh ref={auraMesh} scale={1.35} visible={!crashLooping} raycast={() => null}>
              <sphereGeometry args={[0.4, 24, 16]} />
              <meshStandardMaterial
                ref={aura}
                color={crashLooping ? conditionColor.failed : conditionColor[condition]}
                emissive={crashLooping ? conditionColor.failed : conditionColor[condition]}
                emissiveIntensity={1}
                transparent
                opacity={0.15}
                depthWrite={false}
              />
            </mesh>
          )}
        </group>

        {(hovered || selected || closeUp) && (
          <WorldLabel position={[0, 1.25, 0]} center style={{ pointerEvents: 'none' }}>
            <div className="kv-label">
              <span className="kv-label-dot" style={{ background: conditionColor[condition] }} />
              {pod.metadata.name}
              {closeUp && !crashLooping && <span className="opacity-70"> · {pod.phase}</span>}
              {tracksLoop && <span ref={status} className="ml-1 opacity-70 empty:hidden" />}
            </div>
          </WorldLabel>
        )}

        {/* Retry indicator: the bead travels round as the back-off elapses. */}
        {tracksLoop && (
          <group ref={retry} position={[0, 1.1, 0]} rotation={[-Math.PI / 2.6, 0, 0]} visible={false}>
            <mesh raycast={() => null}>
              <torusGeometry args={[RETRY_RADIUS, 0.008, 6, 40]} />
              <meshBasicMaterial ref={retryMat} color={RETRY_COLOR} transparent opacity={0.3} depthWrite={false} />
            </mesh>
            <mesh ref={bead} raycast={() => null}>
              <sphereGeometry args={[0.028, 10, 10]} />
              <meshBasicMaterial ref={beadMat} color={RETRY_COLOR} transparent depthWrite={false} />
            </mesh>
          </group>
        )}

        {pending && (
          <mesh ref={spinner} position={[0, 1.02, 0]}>
            <torusGeometry args={[0.13, 0.018, 6, 24, Math.PI * 1.4]} />
            <meshStandardMaterial color={conditionColor.warning} emissive={conditionColor.warning} emissiveIntensity={1.6} />
          </mesh>
        )}
      </group>
      </Arrival>
    </group>
  );
}

const ARRIVAL_S = 1.1;
const easeOutBack = (t: number) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);
const smoothstep = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

const EYE_COLOR = '#d4fbff';
const FADED = new Color('#6b7090');
const RETRY_COLOR = new Color(conditionColor.warning);
const WAKE_COLOR = new Color(palette.teal);
const RETRY_RADIUS = 0.17;
/** The crash-looping container's belly light, per simulated phase. */
const LIGHT_COLOR: Record<CrashLoopFrame['phase'], Color> = {
  running: new Color(conditionColor.ok),
  restarting: new Color(conditionColor.ok),
  crashing: new Color(conditionColor.failed),
  backoff: new Color(conditionColor.warning),
};

const loopLabel = (f: CrashLoopFrame): string => {
  const restarts = `${f.restarts} restart${f.restarts === 1 ? '' : 's'}`;
  switch (f.phase) {
    case 'crashing':
      return `· crashed · ${restarts}`;
    case 'backoff':
      return f.remaining === null
        ? `· CrashLoopBackOff · ${restarts}`
        : `· back-off, retry in ${Math.ceil(f.remaining)}s · ${restarts}`;
    case 'restarting':
      return `· restarting · ${restarts}`;
    case 'running':
      return `· running · ${restarts}`;
  }
};

/** A Pod materialising on its Node: a brief column of light, then the creature pops in. */
function Arrival({ active, children }: { active: boolean; children: ReactNode }) {
  const body = useRef<Group>(null);
  const beam = useRef<Mesh>(null);
  const beamMat = useRef<MeshBasicMaterial>(null);
  const t = useRef(active ? 0 : 2);

  useFrame((_, delta) => {
    if (t.current >= 2) return;
    t.current = Math.min(2, t.current + delta / ARRIVAL_S);
    const pop = Math.min(1, Math.max(0, (t.current - 0.35) / 0.65));
    if (body.current) body.current.scale.setScalar(Math.max(0.001, easeOutBack(pop)));
    if (beam.current) beam.current.scale.set(1, Math.min(1, t.current * 3), 1);
    if (beamMat.current) beamMat.current.opacity = t.current < 1 ? 0.35 : Math.max(0, 0.35 * (2 - t.current) - 0.05);
  });

  return (
    <>
      <group ref={body} scale={active ? 0.001 : 1}>
        {children}
      </group>
      {active && (
        <mesh ref={beam} position={[0, 1.6, 0]} raycast={() => null}>
          <cylinderGeometry args={[0.28, 0.5, 3.2, 24, 1, true]} />
          <meshBasicMaterial
            ref={beamMat}
            color={palette.cyan}
            transparent
            opacity={0}
            depthWrite={false}
            blending={AdditiveBlending}
            side={DoubleSide}
          />
        </mesh>
      )}
    </>
  );
}
