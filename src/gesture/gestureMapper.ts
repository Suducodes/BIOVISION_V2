import type { InteractionController } from '../controller/interactionController';
import type { GestureMode, GestureSignals } from './types';

export interface MapperConfig {
  /** Half-width of the world region the hand's X sweep maps onto. */
  positionRangeX: number;
  /** Half-height of the world region the hand's Y sweep maps onto. */
  positionRangeY: number;
  /** Screen-fraction of hand travel → radians of rotation. */
  rotateGain: number;
  /** Thumb-index aperture (normalised) mapped to zoom = 0 (fully out). */
  apertureMin: number;
  /** Thumb-index aperture mapped to zoom = 1 (fully inside). */
  apertureMax: number;
}

const DEFAULTS: MapperConfig = {
  // Gentle: a hand sweep across the frame moves the specimen roughly one radius
  // each way, so it feels controlled rather than darting.
  positionRangeX: 2.6,
  positionRangeY: 2.0,
  // Higher so a single two-hand sweep can carry the specimen through a full
  // turn — enough to inspect all 360° without re-gripping.
  rotateGain: 5.5,
  apertureMin: 0.03,
  apertureMax: 0.3,
};

/**
 * Bridges smoothed {@link GestureSignals} to the {@link InteractionController}.
 *
 *  - GRAB   maps the hand's on-screen position *absolutely* onto the specimen's
 *           position — hand in the centre puts the specimen in the centre, no
 *           matter where the hand entered — and maps the thumb-index aperture
 *           straight onto zoom (together = out, spread = inside).
 *  - ROTATE spins by the primary hand's frame-to-frame movement while position
 *           and zoom hold.
 *
 * Dropping from two hands back to one returns the specimen to its original
 * upright orientation, so a rotation is a temporary inspection that springs
 * back. The webcam is mirrored, so horizontal motion is negated to feel
 * natural.
 */
export class GestureMapper {
  private readonly cfg: MapperConfig;
  private prevMode: GestureMode = 'IDLE';
  private lastPrimary?: { x: number; y: number };

  constructor(
    private readonly controller: InteractionController,
    config?: Partial<MapperConfig>,
  ) {
    this.cfg = { ...DEFAULTS, ...config };
  }

  /** Live-tune the mapping from the settings panel. */
  configure(partial: Partial<MapperConfig>): void {
    Object.assign(this.cfg, partial);
  }

  apply(signals: GestureSignals): void {
    if (signals.mode !== this.prevMode) {
      // Leaving rotation (second hand withdrawn) springs the specimen back to
      // its original orientation.
      if (this.prevMode === 'ROTATE') this.controller.resetRotation();
      // Seed the rotation delta reference on entry so the first frame is still.
      this.lastPrimary = signals.primary ? { ...signals.primary } : undefined;
      this.prevMode = signals.mode;
    }

    switch (signals.mode) {
      case 'GRAB':
        this.applyGrab(signals);
        break;
      case 'ROTATE':
        this.applyRotate(signals);
        break;
      case 'IDLE':
        break;
    }
  }

  private applyGrab(signals: GestureSignals): void {
    if (signals.primary) {
      // Absolute mapping: centre-of-frame → centre-of-screen. Mirror X; screen-y
      // grows downward so Y is negated too.
      const x = -(signals.primary.x - 0.5) * this.cfg.positionRangeX;
      const y = -(signals.primary.y - 0.5) * this.cfg.positionRangeY;
      this.controller.setPosition(x, y);
    }

    if (signals.pinchDistance != null) {
      const { apertureMin, apertureMax } = this.cfg;
      const t = (signals.pinchDistance - apertureMin) / (apertureMax - apertureMin);
      this.controller.setZoom(clamp(t, 0, 1));
    }
  }

  private applyRotate(signals: GestureSignals): void {
    if (!signals.primary) return;
    if (this.lastPrimary) {
      const dx = signals.primary.x - this.lastPrimary.x;
      const dy = signals.primary.y - this.lastPrimary.y;
      // Horizontal hand motion yaws; vertical motion pitches.
      this.controller.rotateBy(-dx * this.cfg.rotateGain, dy * this.cfg.rotateGain);
    }
    this.lastPrimary = { ...signals.primary };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
