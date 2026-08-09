import {
  LM,
  type GestureMode,
  type GestureSignals,
  type HandLandmarks,
} from './types';

export interface ClassifierConfig {
  /** EMA weight for landmark smoothing. Higher = snappier but jitterier. */
  emaAlpha: number;
  /** Consecutive confirming frames before a mode change commits. */
  confirmFrames: number;
}

const DEFAULTS: ClassifierConfig = {
  // Weighted toward the latest raw sample: less lag between hand and specimen,
  // at the cost of a little more jitter (the render-side damping absorbs it).
  emaAlpha: 0.7,
  confirmFrames: 2,
};

/**
 * Turns raw MediaPipe landmarks into a stable, smoothed {@link GestureSignals}
 * stream implementing the two-hand interaction model.
 *
 * Hand *count* selects the interaction: one hand manipulates (grab-to-move, or
 * pinch-to-zoom by pose), a second hand switches the first into a rotator while
 * the specimen holds position. Two mechanisms borrowed from the earlier DICOM
 * prototype keep the signal usable: an exponential moving average on every
 * landmark to kill per-frame jitter, and an N-frame confirmation gate so a
 * single misread frame cannot flip modes.
 *
 * The "primary" hand — the one that was there first — is tracked across frames
 * by proximity so that when a second hand joins, the *original* hand keeps
 * driving, exactly as the interaction describes.
 */
export class GestureClassifier {
  private readonly cfg: ClassifierConfig;
  private smoothed: HandLandmarks[] = [];

  private mode: GestureMode = 'IDLE';
  private pendingMode: GestureMode = 'IDLE';
  private pendingCount = 0;

  private primaryPalm?: { x: number; y: number };

  constructor(config?: Partial<ClassifierConfig>) {
    this.cfg = { ...DEFAULTS, ...config };
  }

  classify(rawHands: HandLandmarks[]): GestureSignals {
    this.applyEma(rawHands);
    const hands = this.smoothed;
    const handCount = hands.length;

    if (handCount === 0) {
      // No hand at all: drop straight to IDLE rather than draining the confirm
      // gate, and forget which hand was primary so the next hand to appear
      // becomes the new anchor.
      this.mode = 'IDLE';
      this.pendingMode = 'IDLE';
      this.pendingCount = 0;
      this.primaryPalm = undefined;
      return { mode: 'IDLE', handCount: 0 };
    }

    // Identify the primary hand and keep its centroid current every frame,
    // independent of the committed mode, so rotation/translation deltas stay
    // smooth across a mode change.
    const primaryIndex = this.pickPrimary(hands);
    const primaryHand = hands[primaryIndex]!;
    const primary = palmCentroid(primaryHand);
    this.primaryPalm = primary;

    const pinchDistance = dist(primaryHand[LM.THUMB_TIP]!, primaryHand[LM.INDEX_TIP]!);

    // Hand count alone selects the interaction — no pose to strike. One hand
    // both carries and zooms the specimen; a second hand switches to rotation.
    const desired: GestureMode = handCount >= 2 ? 'ROTATE' : 'GRAB';
    this.commit(desired);

    const tip = primaryHand[LM.INDEX_TIP]!;
    return {
      mode: this.mode,
      primary,
      pinchDistance,
      indexTip: { x: tip.x, y: tip.y },
      handCount,
    };
  }

  /** Smoothing is stateful; reset it when tracking is (re)started. */
  reset(): void {
    this.smoothed = [];
    this.mode = 'IDLE';
    this.pendingMode = 'IDLE';
    this.pendingCount = 0;
    this.primaryPalm = undefined;
  }

  /**
   * The primary hand is whichever visible hand is closest to where the primary
   * hand was last frame; on first sight it is simply the first hand. This makes
   * the "original" hand keep control when a second hand joins, regardless of the
   * order MediaPipe happens to return them in.
   */
  private pickPrimary(hands: HandLandmarks[]): number {
    if (!this.primaryPalm || hands.length === 1) return 0;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < hands.length; i++) {
      const c = palmCentroid(hands[i]!);
      const d = dist(c, this.primaryPalm);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  private applyEma(rawHands: HandLandmarks[]): void {
    // Hand count changed (a hand entered or left): trust the raw frame outright
    // rather than blending across a discontinuity.
    if (rawHands.length !== this.smoothed.length) {
      this.smoothed = rawHands.map((h) => h.map((p) => ({ ...p })));
      return;
    }
    const a = this.cfg.emaAlpha;
    for (let h = 0; h < rawHands.length; h++) {
      for (let i = 0; i < rawHands[h]!.length; i++) {
        const raw = rawHands[h]![i]!;
        const prev = this.smoothed[h]![i]!;
        prev.x = a * raw.x + (1 - a) * prev.x;
        prev.y = a * raw.y + (1 - a) * prev.y;
        prev.z = a * raw.z + (1 - a) * prev.z;
      }
    }
  }

  private commit(desired: GestureMode): void {
    if (desired === this.mode) {
      this.pendingMode = desired;
      this.pendingCount = 0;
      return;
    }
    if (desired !== this.pendingMode) {
      this.pendingMode = desired;
      this.pendingCount = 1;
      return;
    }
    if (++this.pendingCount >= this.cfg.confirmFrames) {
      this.mode = desired;
      this.pendingCount = 0;
    }
  }
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Average of the wrist and the finger MCP knuckles — a stable palm anchor. */
function palmCentroid(hand: HandLandmarks): { x: number; y: number } {
  // Built from the wrist and MCP knuckles only — points that barely move when
  // the fingers pinch — so zooming does not smear the translation anchor.
  const pts = [LM.WRIST, LM.THUMB_MCP, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_PIP, LM.PINKY_PIP];
  let x = 0;
  let y = 0;
  for (const i of pts) {
    x += hand[i]!.x;
    y += hand[i]!.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}
