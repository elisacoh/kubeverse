import { useRef, type ComponentProps, type RefObject } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * DOM layer for in-world labels, mounted next to the canvas.
 * drei's <Html> otherwise targets a node that changes once R3F connects its
 * events, which remounts every label root and can leave labels empty.
 */
export const labelLayer: RefObject<HTMLDivElement | null> = { current: null };

type Props = ComponentProps<typeof Html> & {
  /** Fade the label while a solid object stands between it and the camera. */
  behind?: boolean;
};

export function WorldLabel({ zIndexRange = [20, 0], behind = false, children, ...props }: Props) {
  const anchor = useRef<THREE.Group>(null);
  const box = useRef<HTMLDivElement>(null);
  const next = useRef(0);

  useFrame(({ camera, scene, clock }) => {
    if (!behind || !anchor.current || !box.current) return;
    const scale = THREE.MathUtils.clamp(FULL_SIZE_AT / camera.position.distanceTo(anchor.current.getWorldPosition(at)), MIN_SCALE, 1);
    box.current.style.setProperty('--label-scale', scale.toFixed(3));
    if (clock.elapsedTime < next.current) return;
    next.current = clock.elapsedTime + 0.15;
    const hidden = isHidden(anchor.current, camera, scene);
    if (box.current.dataset.behind !== String(hidden)) box.current.dataset.behind = String(hidden);
  });

  if (!behind) return <Html {...props} zIndexRange={zIndexRange} portal={labelLayer as RefObject<HTMLElement>}>{children}</Html>;
  return (
    <group ref={anchor} position={props.position}>
      <Html {...props} position={undefined} zIndexRange={zIndexRange} portal={labelLayer as RefObject<HTMLElement>}>
        <div ref={box} className="kv-behind">
          {children}
        </div>
      </Html>
    </group>
  );
}

/** Camera distance up to which a nameplate keeps its full size; farther away it shrinks like the objects, down to MIN_SCALE. */
const FULL_SIZE_AT = 10;
const MIN_SCALE = 0.3;

const ray = new THREE.Raycaster();
const at = new THREE.Vector3();
const dir = new THREE.Vector3();

/** Plain opaque meshes only: lines, points and fat lines are never in the way, and some cannot be raycast without extra setup. */
const solid = (o: THREE.Object3D): o is THREE.Mesh => {
  const mesh = o as THREE.Mesh;
  if (!mesh.isMesh || (mesh as { isInstancedMesh?: boolean }).isInstancedMesh || (o as { isLineSegments2?: boolean }).isLineSegments2) return false;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return materials.some((m) => m.visible && (!m.transparent || m.opacity > 0.5) && m.side !== THREE.BackSide);
};

const blockers: THREE.Mesh[] = [];

/** True when a visible, opaque mesh sits between the camera and the label's anchor. */
function isHidden(anchor: THREE.Object3D, camera: THREE.Camera, scene: THREE.Scene) {
  anchor.getWorldPosition(at);
  const origin = camera.getWorldPosition(new THREE.Vector3());
  const distance = origin.distanceTo(at);
  ray.set(origin, dir.subVectors(at, origin).normalize());
  ray.far = distance - 0.3;
  blockers.length = 0;
  scene.traverseVisible((o) => {
    if (solid(o)) blockers.push(o);
  });
  try {
    return ray.intersectObjects(blockers, false).length > 0;
  } catch {
    return false;
  }
}
