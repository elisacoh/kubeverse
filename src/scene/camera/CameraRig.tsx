import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Plane, Raycaster, Vector2, Vector3, type PerspectiveCamera } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { selectInspectorOpen, useAppStore } from '../../state/useAppStore';
import { computeGoal } from './cameraGoals';

/** Approximate on-screen width of the inspector panel, including its margin. */
const INSPECTOR_WIDTH = 396;
/** Width/height ratio the cluster overview is framed for. */
const OVERVIEW_ASPECT = 1.6;

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

interface Flight {
  fromPos: Vector3;
  fromTarget: Vector3;
  toPos: Vector3;
  toTarget: Vector3;
  duration: number;
  t: number;
}

/**
 * Orbit/pan/zoom controls plus an interruptible camera flight toward the goal
 * derived from the current view. Any user drag cancels the flight.
 */
export function CameraRig() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const controls = useRef<OrbitControlsImpl>(null);
  const flight = useRef<Flight | null>(null);
  const viewOffset = useRef(0);
  const panelOpen = useAppStore(selectInspectorOpen);

  const cluster = useAppStore((s) => s.cluster);
  const view = useAppStore((s) => s.view);
  const selection = useAppStore((s) => s.selection);
  const transition = useAppStore((s) => s.transition);
  const nonce = useAppStore((s) => s.cameraNonce);

  // Container selection inside the anatomy view should not move the camera.
  const cameraSelection = view.kind !== 'pod' && selection?.kind === 'pod' ? selection : null;
  const goal = useMemo(
    () => computeGoal(cluster, view, cameraSelection, transition),
    [cluster, view, cameraSelection?.uid, transition, nonce],
  );
  // The Playground's canvas sits between docked panels, often narrower than the overview was framed for: pull back to fit.
  const playground = useAppStore((s) => s.mode === 'playground');
  const aspect = size.width / Math.max(size.height, 1);
  const fit = playground && view.kind === 'cluster' && !view.focus ? Math.round(Math.min(Math.max(1, OVERVIEW_ASPECT / aspect), 2.2) * 20) / 20 : 1;

  // The cluster changes on every control-loop pass; only a new destination (or a new request) should move the camera.
  const lastFlight = useRef<{ key: string; view: unknown; selection: unknown; transition: unknown; nonce: number } | null>(null);
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const key = JSON.stringify([goal.position, goal.target, goal.pan, fit]);
    const last = lastFlight.current;
    lastFlight.current = { key, view, selection: cameraSelection?.uid, transition, nonce };
    if (
      last &&
      last.key === key &&
      last.view === view &&
      last.selection === cameraSelection?.uid &&
      last.transition === transition &&
      last.nonce === nonce
    ) {
      return;
    }
    if (goal.from) {
      camera.position.set(...goal.from.position);
      c.target.set(...goal.from.target);
      c.update();
    }
    const toTarget = new Vector3(...goal.target);
    flight.current = {
      fromPos: camera.position.clone(),
      fromTarget: c.target.clone(),
      toPos: goal.pan ? toTarget.clone().add(camera.position.clone().sub(c.target)) : new Vector3(...goal.position).sub(toTarget).multiplyScalar(fit).add(toTarget),
      toTarget,
      duration: goal.duration,
      t: 0,
    };
  }, [goal, camera, fit]);

  const pivotRequest = useAppStore((s) => s.pivotRequest);
  useEffect(() => {
    const c = controls.current;
    if (!c || !pivotRequest) return;
    const ray = new Raycaster();
    ray.setFromCamera(new Vector2(...pivotRequest.ndc), camera);
    const hit = ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -c.target.y), new Vector3());
    if (!hit) return;
    // Keep the pivot inside the universe even when the pointer grazes the horizon.
    const reach = useAppStore.getState().view.kind === 'pod' ? 12 : 45;
    if (Math.hypot(hit.x, hit.z) > reach) hit.setLength(reach).setY(c.target.y);
    const shift = hit.clone().sub(c.target);
    flight.current = {
      fromPos: camera.position.clone(),
      fromTarget: c.target.clone(),
      toPos: camera.position.clone().add(shift),
      toTarget: hit,
      duration: 0.9,
      t: 0,
    };
  }, [pivotRequest, camera]);

  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const cancel = () => {
      // Never abort the scripted dive into a Pod.
      if (!useAppStore.getState().transition) flight.current = null;
    };
    c.addEventListener('start', cancel);
    return () => c.removeEventListener('start', cancel);
  }, []);

  useFrame((_, delta) => {
    // Shift the projection so the focus sits in the area not covered by the inspector panel.
    const panelPx = Math.min(INSPECTOR_WIDTH, size.width * 0.6);
    const targetOffset = panelOpen ? panelPx / 2 : 0;
    viewOffset.current += (targetOffset - viewOffset.current) * Math.min(1, delta * 5);
    if (targetOffset === 0 && Math.abs(viewOffset.current) < 0.5) viewOffset.current = 0;
    const cam = camera as PerspectiveCamera;
    if (viewOffset.current !== 0) {
      cam.setViewOffset(size.width, size.height, viewOffset.current, 0, size.width, size.height);
    } else if (cam.view?.enabled) {
      cam.clearViewOffset();
    }

    const f = flight.current;
    const c = controls.current;
    if (!f || !c) return;
    f.t = Math.min(1, f.t + delta / f.duration);
    const e = easeInOutCubic(f.t);
    camera.position.lerpVectors(f.fromPos, f.toPos, e);
    c.target.lerpVectors(f.fromTarget, f.toTarget, e);
    c.update();
    if (f.t >= 1) flight.current = null;
  });

  const inside = view.kind === 'pod';

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={0.6}
      zoomSpeed={0.8}
      zoomToCursor
      panSpeed={0.8}
      screenSpacePanning
      minDistance={inside ? 4 : 2.5}
      maxDistance={inside ? 26 : 62}
      maxPolarAngle={inside ? Math.PI * 0.62 : Math.PI * 0.47}
    />
  );
}
