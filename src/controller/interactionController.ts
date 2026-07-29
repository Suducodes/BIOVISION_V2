import * as THREE from 'three';

/**
 * Owns the specimen's transform state: position and rotation of the model, plus
 * a normalised zoom scalar that the render loop turns into a camera dolly.
 *
 * Input sources write *targets* here at whatever rate they run; `update()`
 * interpolates the live values toward those targets once per rendered frame.
 * That split is what lets ~30 fps gesture inference drive a 60 Hz render without
 * the motion looking stepped. Smoothing is intentionally light so the specimen
 * tracks the hand closely rather than feeling like it lags behind on elastic.
 */
export class InteractionController {
  private readonly targetPosition = new THREE.Vector3(0, 0, 0);
  private readonly targetRotation = new THREE.Euler(0, 0, 0, 'YXZ');
  /** 0 = framed from outside, 1 = camera driven deep inside the specimen. */
  private targetZoom = 0;
  private liveZoom = 0;

  // Moderate damping: smooth enough to absorb tracking jitter and feel calm
  // (not twitchy), while still following the hand closely. Adjustable at runtime
  // from the settings panel — higher is snappier, lower is smoother/floatier.
  private positionLerp = 0.22;
  private rotationLerp = 0.2;
  private zoomLerp = 0.2;

  // Translation bounds keep the specimen inside the frustum and clear of the UI.
  private readonly maxX = 1.8;
  private readonly maxY = 1.2;

  constructor(private readonly pivot: THREE.Group) {}

  /**
   * Absolute world position of the specimen. The hand's on-screen location maps
   * straight onto this, so wherever the hand sits in the camera frame is where
   * the specimen sits on screen — independent of where the hand started.
   */
  setPosition(x: number, y: number): void {
    this.targetPosition.x = clamp(x, -this.maxX, this.maxX);
    this.targetPosition.y = clamp(y, -this.maxY, this.maxY);
  }

  /** Radians to add about each axis (rotation happens in place). */
  rotateBy(deltaYaw: number, deltaPitch: number): void {
    this.targetRotation.y += deltaYaw;
    this.targetRotation.x = clamp(
      this.targetRotation.x + deltaPitch,
      -Math.PI / 2,
      Math.PI / 2,
    );
  }

  /** Ease the specimen back to its original upright orientation. */
  resetRotation(): void {
    this.targetRotation.set(0, 0, 0);
  }

  /**
   * Sets the smoothing factor for all manipulation (0..1). Higher tracks the
   * hand more tightly (snappier); lower feels smoother and floatier. Zoom is
   * kept a touch gentler so the dive inside never feels abrupt.
   */
  setSmoothing(value: number): void {
    const v = clamp(value, 0.05, 0.6);
    this.positionLerp = v;
    this.rotationLerp = v;
    this.zoomLerp = v * 0.9;
  }

  /** Absolute zoom in [0,1]; pinch aperture maps straight onto this. */
  setZoom(value: number): void {
    this.targetZoom = clamp(value, 0, 1);
  }

  /** Live, smoothed zoom — the render loop maps this to camera distance. */
  get zoom(): number {
    return this.liveZoom;
  }

  /** Live rotation, read by the context-aware label system in Phase 4. */
  get rotation(): THREE.Euler {
    return this.pivot.rotation;
  }

  reset(): void {
    this.targetPosition.set(0, 0, 0);
    this.targetRotation.set(0, 0, 0);
    this.targetZoom = 0;
  }

  /** @param delta seconds since the previous frame */
  update(delta: number): void {
    // Frame-rate-independent damping: on a slow frame we take a proportionally
    // larger step, so the feel is identical at 30 and 144 Hz.
    const posAlpha = damp(this.positionLerp, delta);
    const rotAlpha = damp(this.rotationLerp, delta);
    const zoomAlpha = damp(this.zoomLerp, delta);

    this.pivot.position.lerp(this.targetPosition, posAlpha);

    const r = this.pivot.rotation;
    r.x += (this.targetRotation.x - r.x) * rotAlpha;
    r.y += (this.targetRotation.y - r.y) * rotAlpha;
    r.z += (this.targetRotation.z - r.z) * rotAlpha;

    this.liveZoom += (this.targetZoom - this.liveZoom) * zoomAlpha;
  }
}

function damp(lerp: number, delta: number): number {
  return 1 - Math.pow(1 - lerp, delta * 60);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
