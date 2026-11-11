import { Suspense, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { AdaptiveDpr } from '@react-three/drei';
import { useAppStore } from '../state/useAppStore';
import { useViewportInsets } from '../state/viewportInsets';
import { Atmosphere } from './Atmosphere';
import { CameraRig } from './camera/CameraRig';
import { ClusterWorld } from './ClusterWorld';
import { PodAnatomy } from './anatomy/PodAnatomy';
import type { Vec3 } from './layout';
import { labelLayer } from './WorldLabel';

/** The first camera flight glides in from here to the cluster overview. */
const INTRO_POSITION: Vec3 = [0, 34, 62];

const toNdc = (e: { clientX: number; clientY: number }, el: Element): [number, number] => {
  const rect = el.getBoundingClientRect();
  return [((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1];
};

/** A right press that moves less than this is a click (centre there); more is a pan drag. */
const CLICK_SLOP_PX = 5;

export function WorldCanvas() {
  const inside = useAppStore((s) => s.view.kind === 'pod');
  const insets = useViewportInsets((s) => s.insets);
  const rightDown = useRef<{ x: number; y: number } | null>(null);

  const onPointerMissed = (e: MouseEvent) => {
    const { view, selection, selectPod, clearSelection, requestPivot } = useAppStore.getState();
    if (e.type === 'dblclick') {
      requestPivot(toNdc(e, e.target as HTMLElement));
      return;
    }
    if (view.kind === 'pod') {
      if (selection?.kind === 'container') selectPod(view.podUid);
    } else if (selection) {
      clearSelection();
    }
  };

  return (
    <div
      className="absolute"
      style={{ top: insets.top, right: insets.right, bottom: insets.bottom, left: insets.left }}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDownCapture={(e) => {
        if (e.button === 2) rightDown.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUpCapture={(e) => {
        const down = rightDown.current;
        if (e.button !== 2 || !down) return;
        rightDown.current = null;
        if (Math.hypot(e.clientX - down.x, e.clientY - down.y) <= CLICK_SLOP_PX) useAppStore.getState().requestPivot(toNdc(e, e.currentTarget));
      }}
    >
      <div
        ref={(el) => {
          labelLayer.current = el;
        }}
        className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
      />
      <Canvas
        shadows="percentage"
        dpr={[1, 2]}
        camera={{ position: INTRO_POSITION, fov: 42, near: 0.1, far: 500 }}
        onPointerMissed={onPointerMissed}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
      >
        <color attach="background" args={['#060a18']} />
        <Suspense fallback={null}>
          <Atmosphere showIslets={!inside} />
          {inside ? <PodAnatomy /> : <ClusterWorld />}
        </Suspense>
        <CameraRig />
        <AdaptiveDpr pixelated={false} />
      </Canvas>
    </div>
  );
}
