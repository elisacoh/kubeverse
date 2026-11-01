import { Frustum, Matrix4, Sphere, Vector3, type Camera, type Object3D } from 'three';

/** hidden: outside the view, skip animation · far: simplified · near: full detail. */
export type Lod = 'hidden' | 'far' | 'near';

/** Beyond this camera distance, small details (glitches, indicators) are not worth animating. */
export const FAR_DISTANCE = 20;

const frustum = new Frustum();
const viewProjection = new Matrix4();
const sphere = new Sphere(new Vector3(), 1);
let frustumStamp = -1;

/**
 * Level of detail for an animated object, from the camera of the current frame.
 * The frustum is rebuilt once per frame (keyed on the frame's clock), and no
 * memory is allocated: many creatures can call this every frame.
 */
export function lodOf(camera: Camera, frameTime: number, object: Object3D, radius = 1): Lod {
  if (frustumStamp !== frameTime) {
    frustumStamp = frameTime;
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjection);
  }
  object.getWorldPosition(sphere.center);
  sphere.radius = radius;
  if (!frustum.intersectsSphere(sphere)) return 'hidden';
  return sphere.center.distanceTo(camera.position) > FAR_DISTANCE ? 'far' : 'near';
}
