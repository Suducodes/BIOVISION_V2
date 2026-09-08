/**
 * The cardiac cycle everything in the app beats on.
 *
 * A real lub-dub envelope rather than a sine: two sharp pulses per cycle
 * (S1 strong, S2 softer) separated by a genuine resting diastole. A smooth
 * sine reads as *breathing*, which is the wrong organ — the double-tap and
 * the pause between beats are what make it recognisable as a heart.
 *
 * A standalone module (rather than inlined where it's used) so anything
 * else that wants to pulse in time — a light, a UI element — reads off the
 * same clock instead of drifting into looking like two different hearts.
 */

export const HEARTBEAT_BPM = 72;
export const HEARTBEAT_CYCLE_S = 60 / HEARTBEAT_BPM;

/** @param t seconds on any monotonically increasing clock
 *  @returns 0..1, peaking at systole */
export function heartbeat(t: number): number {
  const phase = (t % HEARTBEAT_CYCLE_S) / HEARTBEAT_CYCLE_S;
  const s1 = Math.exp(-(((phase - 0.05) * 14) ** 2));
  const s2 = Math.exp(-(((phase - 0.32) * 14) ** 2)) * 0.65;
  return Math.min(1, s1 + s2);
}
