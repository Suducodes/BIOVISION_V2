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
  // Set by a voice command. While set, the hand's *absolute* position and
  // aperture are ignored, because they would otherwise overwrite the view the
  // voice command just asked for on the very next frame. `anchor` is the hand
  // as it was when the hold began; the hold lifts once the hand moves away
  // from it, which is how someone says "I'm driving again".
  private voiceHold: { anchor?: { x: number; y: number; aperture: number } } | null = null;

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

  /**
   * Called when a voice command has set the view. Holds that view until the
   * hand deliberately moves, or a second hand starts a rotation.
   */
  holdForVoice(): void {
    this.voiceHold = {};
  }

  apply(signals: GestureSignals): void {
    if (signals.mode !== this.prevMode) {
      // Leaving rotation (second hand withdrawn) springs the specimen back to
      // its original orientation.
      if (this.prevMode === 'ROTATE') this.controller.resetRotation();
      // Bringing in a second hand is an unmistakable request to take over.
      if (signals.mode === 'ROTATE') this.voiceHold = null;
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

  /** True while a voice-set view is still being protected from the hand. */
  private holding(signals: GestureSignals): boolean {
    const hold = this.voiceHold;
    if (!hold) return false;
    const here = signals.primary;
    const aperture = signals.pinchDistance;
    if (!here || aperture == null) return true;

    // First sample after the command: remember where the hand was, and hold.
    if (!hold.anchor) {
      hold.anchor = { x: here.x, y: here.y, aperture };
      return true;
    }
    // About a twentieth of the camera frame, or a sixth of the zoom range:
    // clearly deliberate, comfortably above tracking jitter.
    const moved = Math.hypot(here.x - hold.anchor.x, here.y - hold.anchor.y) > 0.05;
    const pinched = Math.abs(aperture - hold.anchor.aperture) > 0.045;
    if (moved || pinched) {
      this.voiceHold = null;
      return false;
    }
    return true;
  }

  private applyGrab(signals: GestureSignals): void {
    if (this.holding(signals)) return;
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
