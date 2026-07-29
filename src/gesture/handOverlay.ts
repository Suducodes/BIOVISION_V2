import type { GestureMode, HandLandmarks } from './types';

/** MediaPipe hand connection topology (pairs of landmark indices). */
const CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], // thumb
  [0, 5], [5, 6], [6, 7], [7, 8], // index
  [5, 9], [9, 10], [10, 11], [11, 12], // middle
  [9, 13], [13, 14], [14, 15], [15, 16], // ring
  [13, 17], [17, 18], [18, 19], [19, 20], // pinky
  [0, 17], // palm base
];

const MODE_COLOR: Record<GestureMode, string> = {
  IDLE: '#6d84a6',
  GRAB: '#33e1ff',
  ROTATE: '#c77dff',
};

/**
 * Renders the live camera feed with the skeletal hand overlay into the
 * bottom-right panel — the tracking window from the paper's Fig. 1. Beyond
 * looking the part, it is the primary tool for confirming the model is actually
 * locking onto the hand while tuning gesture thresholds.
 */
export class HandOverlay {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly video: HTMLVideoElement,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable for hand overlay');
    this.ctx = ctx;
  }

  draw(hands: HandLandmarks[], mode: GestureMode): void {
    const { width: w, height: h } = this.canvas;
    const ctx = this.ctx;

    // Mirror so the feed reads like a mirror, matching how the user moves.
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    if (this.video.readyState >= 2) {
      ctx.drawImage(this.video, 0, 0, w, h);
    } else {
      ctx.fillStyle = '#04070f';
      ctx.fillRect(0, 0, w, h);
    }

    const colour = MODE_COLOR[mode];
    for (const hand of hands) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = 2;
      for (const [a, b] of CONNECTIONS) {
        const p = hand[a]!;
        const q = hand[b]!;
        ctx.beginPath();
        ctx.moveTo(p.x * w, p.y * h);
        ctx.lineTo(q.x * w, q.y * h);
        ctx.stroke();
      }
      ctx.fillStyle = colour;
      for (const p of hand) {
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    // Mode badge, drawn unmirrored so the text is readable.
    ctx.fillStyle = colour;
    ctx.font = '600 11px "JetBrains Mono", monospace';
    ctx.textBaseline = 'top';
    ctx.fillText(mode, 8, 8);
  }
}
