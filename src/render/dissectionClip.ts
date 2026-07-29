import * as THREE from 'three';

const NOTHING_CLIPPED = 1e6;

/**
 * Couples a camera-facing clipping plane to the specimen's zoom level, so that
 * spreading the pinch (zooming in past a threshold) cuts away the near face and
 * reveals the interior — the "virtual dissection" of the paper, driven directly
 * by the zoom gesture rather than a separate control.
 *
 * The cut depth is expressed relative to the *scaled* radius, so the exposed
 * cross-section tracks the specimen as it grows under zoom instead of drifting.
 */
export class DissectionClip {
  // Normal points back toward the camera (+z); fragments with z greater than
  // the plane constant are removed, peeling away the near hemisphere.
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 0, -1), NOTHING_CLIPPED);

  constructor(
    materials: THREE.Material[],
    private readonly radius: number,
    /** Zoom at which the scalpel first bites. */
    private readonly startScale = 1.7,
  ) {
    for (const material of materials) {
      material.clippingPlanes = [this.plane];
      material.clipShadows = true;
    }
  }

  /** Call each frame with the live zoom. Returns 0..1 dissection depth. */
  update(scale: number, maxScale: number): number {
    if (scale <= this.startScale) {
      this.plane.constant = NOTHING_CLIPPED;
      return 0;
    }
    const t = clamp((scale - this.startScale) / (maxScale - this.startScale), 0, 1);
    const scaledRadius = this.radius * scale;
    // Sweep the plane from the front surface (nothing removed) to just past the
    // midline (interior fully exposed — the cardiac septum on a heart).
    this.plane.constant = THREE.MathUtils.lerp(scaledRadius, -0.35 * scaledRadius, t);
    return t;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
