import * as THREE from 'three';

/**
 * Casts a normalised-image-space MediaPipe landmark into a world-space point
 * a given distance from the camera, offset in depth by the landmark's own
 * relative z. Shared by every feature that places tracked hand geometry in
 * the 3D scene (the ghost hand, the psychomotor trace challenge) so they
 * agree on the same mirror convention and depth handling.
 *
 * Depth is deliberately modest and clamped: a single webcam gives MediaPipe's
 * z only *relative* to the wrist, not true metric depth, so this is a
 * stylised depth cue, not measurement-grade AR. See GhostHand for the fuller
 * writeup of why a naive camera-distance-scaled offset reads as spikes.
 */
const DEPTH_UNITS = 0.32;
const MAX_DEPTH_Z = 0.35;

const scratchNdc = new THREE.Vector3();
const scratchDir = new THREE.Vector3();

export function unprojectLandmark(
  landmark: { x: number; y: number; z: number },
  camera: THREE.Camera,
  hoverDistance: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  // Mirrored webcam feed, screen-space y flip — same convention as
  // hoverProbe.setGestureTip and every other gesture consumer in this app.
  const ndcX = 1 - 2 * landmark.x;
  const ndcY = 1 - 2 * landmark.y;

  scratchNdc.set(ndcX, ndcY, 0.5).unproject(camera);
  scratchDir.copy(scratchNdc).sub(camera.position).normalize();

  const z = Math.min(MAX_DEPTH_Z, Math.max(-MAX_DEPTH_Z, landmark.z));
  const depth = hoverDistance - z * DEPTH_UNITS;
  return out.copy(camera.position).addScaledVector(scratchDir, depth);
}
