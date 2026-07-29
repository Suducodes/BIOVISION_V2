/**
 * Live performance readout. The paper reports 60 Hz rendering, ~30 fps hand
 * tracking and sub-50 ms input latency; showing those numbers on screen during
 * a demo is what turns a claim into a demonstration.
 *
 * Each metric also drives a meter bar, normalised against the target the paper
 * quotes so a full bar reads as "meeting spec".
 */
export class Hud {
  private readonly fpsEl = el('hud-fps');
  private readonly trackEl = el('hud-track');
  private readonly latencyEl = el('hud-latency');
  private readonly zoomEl = el('hud-zoom');

  private readonly fpsBar = el('bar-fps');
  private readonly trackBar = el('bar-track');
  private readonly latencyBar = el('bar-latency');
  private readonly zoomBar = el('bar-zoom');

  private frames = 0;
  private trackedFrames = 0;
  private windowStart = performance.now();
  private latencyMs = 0;

  /** Call once per rendered frame. */
  markRender(): void {
    this.frames++;
    this.flushIfDue();
  }

  /** Call once per completed hand-tracking inference. */
  markTracking(inferenceMs: number): void {
    this.trackedFrames++;
    // Exponential moving average keeps the digit legible instead of strobing.
    this.latencyMs = this.latencyMs === 0
      ? inferenceMs
      : 0.15 * inferenceMs + 0.85 * this.latencyMs;
  }

  /** Call each frame with the live zoom depth (0..1). */
  setZoom(fraction: number): void {
    const pct = Math.round(fraction * 100);
    this.zoomEl.textContent = pct.toString();
    this.zoomBar.style.width = `${pct}%`;
  }

  private flushIfDue(): void {
    const now = performance.now();
    const elapsed = now - this.windowStart;
    if (elapsed < 500) return;

    const perSecond = 1000 / elapsed;
    const fps = Math.round(this.frames * perSecond);
    const track = this.trackedFrames > 0 ? Math.round(this.trackedFrames * perSecond) : 0;

    this.fpsEl.textContent = fps.toString();
    this.fpsBar.style.width = `${pctOf(fps, 60)}%`;

    this.trackEl.textContent = track > 0 ? track.toString() : '--';
    this.trackBar.style.width = `${pctOf(track, 30)}%`;

    this.latencyEl.textContent = this.latencyMs > 0 ? this.latencyMs.toFixed(0) : '--';
    // Latency bar is inverted: less is better, full bar at/under 50 ms.
    this.latencyBar.style.width =
      this.latencyMs > 0 ? `${clamp(100 - (this.latencyMs / 50) * 100, 4, 100)}%` : '0%';

    this.frames = 0;
    this.trackedFrames = 0;
    this.windowStart = now;
  }
}

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`HUD element #${id} missing`);
  return node;
}

function pctOf(value: number, target: number): number {
  return clamp((value / target) * 100, 0, 100);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
