import * as THREE from 'three';
import type { RegionId } from './cases';
import type { RegionSet } from './regions';

/** Milliseconds the cursor must rest on a region before it counts as identified. */
export const DWELL_MS = 2000;

export interface HoverSample {
  /** Region currently under the cursor, if any. */
  region: RegionId | null;
  /** Dwell progress on that region, 0..1. */
  progress: number;
  /** Set on the single frame a dwell completes. */
  confirmed: RegionId | null;
}

const IDLE: HoverSample = { region: null, progress: 0, confirmed: null };

/**
 * Turns a screen-space cursor into a dwell-gated region identification.
 *
 * The cursor is deliberately *not* a click: the whole interaction model of the
 * platform is touchless, so identifying a vessel means holding the index
 * fingertip over it, exactly as an examiner would ask a student to point. A
 * mouse pointer drives the same path so the challenge is still playable without
 * a camera — the two inputs write to one cursor, and gesture wins while it is
 * live.
 */
export class HoverProbe {
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();

  private pointer: { x: number; y: number } | null = null;
  private gesture: { x: number; y: number } | null = null;
  private gestureSeenAt = 0;

  private active: RegionId | null = null;
  private dwellMs = 0;
  private consumed = false;

  private readonly reticle: HTMLElement;

  constructor(
    private readonly camera: THREE.Camera,
    private readonly container: HTMLElement,
  ) {
    this.reticle = document.createElement('div');
    this.reticle.id = 'sl-reticle';
    this.reticle.innerHTML = '<i></i><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17"/></svg>';
    this.reticle.hidden = true;
    container.append(this.reticle);
  }

  /** Screen pixel coordinates from a pointer event. */
  setPointer(clientX: number, clientY: number): void {
    const rect = this.container.getBoundingClientRect();
    this.pointer = {
      x: ((clientX - rect.left) / rect.width) * 2 - 1,
      y: -((clientY - rect.top) / rect.height) * 2 + 1,
    };
  }

  clearPointer(): void {
    this.pointer = null;
  }

  /**
   * Index-fingertip position in MediaPipe's normalised image coordinates. The
   * webcam feed is mirrored and its y grows downward, matching the mapping the
   * gesture mapper already applies to the specimen.
   */
  setGestureTip(tip: { x: number; y: number } | undefined): void {
    if (!tip) {
      this.gesture = null;
      return;
    }
    this.gesture = { x: 1 - 2 * tip.x, y: 1 - 2 * tip.y };
    this.gestureSeenAt = performance.now();
  }

  /** Current cursor in NDC, gesture taking precedence while it is live. */
  private current(): { x: number; y: number } | null {
    if (this.gesture && performance.now() - this.gestureSeenAt < 600) return this.gesture;
    return this.pointer;
  }

  /**
   * @param deltaMs milliseconds since the previous frame
   * @param regions bound region set, or undefined when nothing is loaded
   */
  update(deltaMs: number, regions: RegionSet | undefined): HoverSample {
    const cursor = regions ? this.current() : null;
    if (!cursor || !regions) {
      this.reticle.hidden = true;
      this.active = null;
      this.dwellMs = 0;
      this.consumed = false;
      return IDLE;
    }

    this.paintReticle(cursor, 0);

    this.ndc.set(cursor.x, cursor.y);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hits = this.raycaster.intersectObjects(regions.targets, false);
    const hit = hits[0]?.object as THREE.Mesh | undefined;
    const region = (hit?.userData.surgilearnRegion as RegionId | undefined) ?? null;

    if (region !== this.active) {
      this.active = region;
      this.dwellMs = 0;
      this.consumed = false;
    } else if (region && !this.consumed) {
      this.dwellMs += deltaMs;
    }

    const progress = region ? Math.min(1, this.dwellMs / DWELL_MS) : 0;
    this.paintReticle(cursor, progress);

    let confirmed: RegionId | null = null;
    if (region && !this.consumed && this.dwellMs >= DWELL_MS) {
      confirmed = region;
      this.consumed = true;
    }

    return { region, progress, confirmed };
  }

  private paintReticle(cursor: { x: number; y: number }, progress: number): void {
    const rect = this.container.getBoundingClientRect();
    this.reticle.hidden = false;
    this.reticle.style.left = `${((cursor.x + 1) / 2) * rect.width}px`;
    this.reticle.style.top = `${((1 - cursor.y) / 2) * rect.height}px`;
    this.reticle.style.setProperty('--progress', String(progress));
    this.reticle.classList.toggle('locking', progress > 0);
  }

  hide(): void {
    this.reticle.hidden = true;
    this.active = null;
    this.dwellMs = 0;
    this.consumed = false;
  }

  dispose(): void {
    this.reticle.remove();
  }
}
