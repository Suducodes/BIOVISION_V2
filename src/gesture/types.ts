/** A single hand landmark in normalised image coordinates (0..1), z relative. */
export interface Landmark {
  x: number;
  y: number;
  z: number;
}

/** MediaPipe returns 21 landmarks per hand in a fixed topology. */
export type HandLandmarks = Landmark[];

/**
 * Landmark indices, named for readability. The full 21-point set is kept here
 * (not just the handful the gesture pipeline reads) so the ghost-hand renderer
 * and the gesture pipeline share one source of truth for MediaPipe's topology.
 */
export const LM = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

/** Output of one tracking frame, consumed by the classifier. */
export interface TrackingFrame {
  hands: HandLandmarks[];
  /** Wall-clock time the frame was captured. */
  timestamp: number;
  /** How long MediaPipe inference took, in ms — feeds the latency HUD. */
  inferenceMs: number;
}

/**
 * High-level interaction state derived from the raw landmarks.
 *
 * The interaction model is deliberately novel and pose-free:
 *  - GRAB   — one hand: the specimen is "stuck" to the hand and follows it,
 *             while the thumb-index aperture zooms at the same time (fingers
 *             together = zoom out, spread = zoom in / dive inside).
 *  - ROTATE — a second hand appears: the specimen locks in place and the first
 *             hand's motion spins it about that fixed point.
 */
export type GestureMode = 'IDLE' | 'GRAB' | 'ROTATE';

/** Normalised, smoothed signals the mapper turns into model transforms. */
export interface GestureSignals {
  mode: GestureMode;
  /** Centroid of the primary (first) hand, in normalised coords. */
  primary?: { x: number; y: number };
  /** Thumb-index aperture of the primary hand — drives zoom directly. */
  pinchDistance?: number;
  /**
   * Index fingertip of the primary hand. Read-only as far as the manipulation
   * pipeline is concerned — the SurgiLearn layer uses it as a touchless cursor
   * for anatomical identification, which is why pointing at a vessel never
   * disturbs move/rotate/zoom.
   */
  indexTip?: { x: number; y: number };
  handCount: number;
}
