import { useMemo, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3, type Object3D, type PerspectiveCamera } from 'three';
import { sampleKeys, type CameraKey, type Vec3 } from './tracks';

interface Props {
  keys: readonly CameraKey[];
  /** Sequence time in seconds. */
  time: MutableRefObject<number>;
  /** Frames of reference for keys whose space is not 'world', e.g. a moving creature or island. */
  anchors: Record<string, () => Object3D | null>;
}

const v = new Vector3();
const toWorld = (p: Vec3, anchor: Object3D | null | undefined): Vec3 => {
  if (!anchor) return p;
  v.set(...p);
  anchor.localToWorld(v);
  return [v.x, v.y, v.z];
};

/** Drives the default camera along keyframes; anchored keys follow their object as it moves. */
export function CameraTrack({ keys, time, anchors }: Props) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const world = useMemo(() => keys.map((k) => ({ ...k })), [keys]);
  const target = useMemo(() => new Vector3(), []);

  useFrame(() => {
    const resolved: Record<string, Object3D | null> = {};
    for (const [name, get] of Object.entries(anchors)) {
      const a = get();
      a?.updateWorldMatrix(true, false);
      resolved[name] = a;
    }
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]!;
      const w = world[i]!;
      const frame = k.space === 'world' ? null : resolved[k.space];
      w.position = toWorld(k.position, frame);
      w.target = toWorld(k.target, frame);
    }
    const s = sampleKeys(world, time.current);
    camera.position.set(...s.position);
    camera.lookAt(target.set(...s.target));
    if (Math.abs(camera.fov - s.fov) > 1e-4) {
      camera.fov = s.fov;
      camera.updateProjectionMatrix();
    }
    // A positive priority would take over rendering from R3F.
  }, -1);

  return null;
}
