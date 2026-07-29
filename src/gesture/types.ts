/** A single hand landmark in normalised image coordinates (0..1), z relative. */
export interface Landmark {
  x: number;
  y: number;
  z: number;
}

/** MediaPipe returns 21 landmarks per hand in a fixed topology. */
export type HandLandmarks = Landmark[];

/** Landmark indices we rely on, named for readability. */
export const LM = {
  WRIST: 0,
  THUMB_TIP: 4,
  THUMB_IP: 3,
  THUMB_MCP: 2,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_TIP: 12,
  RING_PIP: 14,
  RING_TIP: 16,
  PINKY_PIP: 18,
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
  handCount: number;
}
