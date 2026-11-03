import { Suspense, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { Group } from 'three';
import { useAppStore } from '../state/useAppStore';
import { Atmosphere } from '../scene/Atmosphere';
import { ClusterWorld } from '../scene/ClusterWorld';
import { labelLayer } from '../scene/WorldLabel';
import { nodeLayouts, type Vec3 } from '../scene/layout';
import { creaturePoses, restingPose } from '../scene/creaturePose';
import { CrystalControlPlane } from '../scene/cinematicStyle';
import { palette } from '../scene/palette';
import { CameraTrack } from './CameraTrack';
import { ControlPlaneDawn } from './ControlPlaneDawn';
import { ClusterAwakening } from './ClusterAwakening';
import { Universe } from './Universe';
import { TownSign } from './TownSign';
import { CAMERA_KEYS, DURATION, HERO_NODE, HERO_POD, dawnLevel, heroPose, titleLevel } from './awakening';

const params = new URLSearchParams(window.location.search);
const AUTOPLAY = params.has('autoplay');
const CLEAN = params.has('clean');
/** `?t=1.3` holds the sequence at that time, to inspect a single moment. */
const HOLD = params.has('t') ? Number(params.get('t')) : null;

/**
 * Developer-only teaser, opened with `?cinematic`. It renders the regular
 * universe from the demo cluster, without any UI, and plays a scripted
 * camera and creature performance. Space plays and pauses it; R replays it from the start.
 */
export function Cinematic() {
  const [status, setStatus] = useState<Status>('idle');
  const title = useRef<HTMLDivElement>(null);
  return (
    <div className="pointer-events-none fixed inset-0 bg-[#060a18]">
      <div
        ref={(el) => {
          labelLayer.current = el;
        }}
        className="hidden"
      />
      <Canvas shadows="percentage" dpr={[1, 2]} camera={{ fov: 28, near: 0.05, far: 900 }} gl={{ antialias: true }}>
        <color attach="background" args={['#060a18']} />
        <Suspense fallback={null}>
          <Atmosphere showIslets />
          <CrystalControlPlane.Provider value>
            <ClusterWorld />
          </CrystalControlPlane.Provider>
          <Director onStatus={setStatus} title={title} />
        </Suspense>
      </Canvas>
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at center, transparent 55%, rgba(3,5,14,0.65) 100%)' }}
      />
      <div
        ref={title}
        className="absolute inset-x-0 bottom-[11%] py-[6vh] text-center font-display text-[clamp(1.4rem,3.2vw,2.6rem)] font-light text-white/85"
        style={{
          opacity: 0,
          textShadow: '0 0 28px rgba(179,164,255,0.55)',
          background: 'radial-gradient(ellipse 30% 50% at center, rgba(4,6,18,0.7), transparent 75%)',
        }}
      >
        KubeVerse
      </div>
      {status !== 'playing' && !CLEAN && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 font-mono text-xs text-white/40">
          {status === 'paused' ? 'Paused · Space to resume · R to replay' : 'Space to play · R to replay'}
        </div>
      )}
    </div>
  );
}

type Status = 'idle' | 'playing' | 'paused';

/** Owns the sequence clock: frozen on the first frame until played, pausable, restarted from zero on replay. */
function Director({ onStatus, title }: { onStatus: (s: Status) => void; title: RefObject<HTMLDivElement | null> }) {
  const clock = useThree((s) => s.clock);
  const time = useRef(0);
  const started = useRef(false);
  const pose = useRef(restingPose());
  const rig = useRef<Group>(null);
  const nodeAnchor = useRef<Group>(null);
  const cluster = useAppStore((s) => s.cluster);
  const nodePosition = useMemo<Vec3>(() => nodeLayouts(cluster).get(HERO_NODE)?.position ?? [0, 0, 0], [cluster]);

  useEffect(() => {
    const p = pose.current;
    heroPose(0, p);
    creaturePoses.set(HERO_POD, p);
    return () => {
      creaturePoses.delete(HERO_POD);
    };
  }, []);

  useEffect(() => {
    const play = () => {
      // Restarting the shared clock replays every creature's idle motion identically too.
      clock.start();
      started.current = true;
      onStatus('playing');
    };
    // Stopping the shared clock freezes the whole world, not just the script.
    const togglePause = () => {
      if (clock.running) {
        clock.stop();
        onStatus('paused');
      } else {
        clock.running = true;
        clock.oldTime = performance.now();
        onStatus('playing');
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (started.current) togglePause();
        else play();
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        play();
      }
    };
    window.addEventListener('keydown', onKey);
    const auto = AUTOPLAY ? window.setTimeout(play, 1500) : undefined;
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(auto);
    };
  }, [clock, onStatus]);

  useFrame(() => {
    time.current = HOLD ?? (started.current ? Math.min(clock.elapsedTime, DURATION) : 0);
    heroPose(time.current, pose.current);
    const shown = titleLevel(time.current);
    if (title.current) {
      title.current.style.opacity = String(shown);
      title.current.style.letterSpacing = `${0.62 - shown * 0.1}em`;
    }
    const anchor = pose.current.anchor;
    if (anchor && rig.current) {
      anchor.getWorldPosition(rig.current.position);
      anchor.getWorldQuaternion(rig.current.quaternion);
    }
  }, -2);

  return (
    <>
      <group ref={nodeAnchor} position={nodePosition} />
      <CameraTrack
        keys={CAMERA_KEYS}
        time={time}
        anchors={{ hero: () => pose.current.anchor, node: () => nodeAnchor.current }}
      />
      <ControlPlaneDawn time={time} level={dawnLevel} />
      <ClusterAwakening time={time} />
      <TownSign />
      <Universe time={time} />
      {/* Close-up lighting that travels with the hero: a cool rim behind, a soft warm fill in front. */}
      <group ref={rig}>
        <pointLight position={[-0.6, 1.1, -0.7]} intensity={2.2} distance={3} decay={1.5} color={palette.cyan} />
        <pointLight position={[0.5, 0.8, 1.2]} intensity={0.9} distance={3} decay={1.5} color={palette.warm} />
      </group>
    </>
  );
}
