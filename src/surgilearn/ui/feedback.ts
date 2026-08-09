import { REGION_INFO, type RegionId } from '../cases';
import type { BadgeDef } from '../store';
import { element } from './panel';

/**
 * Transient feedback: the anatomical label that appears once a region has been
 * held long enough to count, and the badge flash.
 *
 * The label is withheld until the dwell completes on purpose — naming the
 * vessel on hover would hand the student the answer they are being asked for.
 */
export class RegionLabel {
  private readonly el = element('div', 'sl-region-label');
  private readonly title = element('b');
  private readonly blurb = element('p');
  private timer: number | undefined;

  constructor(container: HTMLElement) {
    this.el.append(this.title, this.blurb);
    this.el.hidden = true;
    container.append(this.el);
  }

  show(region: RegionId, verdict: 'correct' | 'off-target'): void {
    const info = REGION_INFO[region];
    this.title.textContent = info.name;
    this.blurb.textContent = info.blurb;
    this.el.classList.toggle('off-target', verdict === 'off-target');
    this.el.hidden = false;
    // Restart the entrance animation even if the label is already up.
    this.el.classList.remove('in');
    void this.el.offsetWidth;
    this.el.classList.add('in');

    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.hide(), 5000);
  }

  hide(): void {
    window.clearTimeout(this.timer);
    this.el.hidden = true;
    this.el.classList.remove('in');
  }

  dispose(): void {
    window.clearTimeout(this.timer);
    this.el.remove();
  }
}

/**
 * Full-screen badge flash. Queued rather than overwritten so finishing a case
 * that unlocks three badges at once shows all three.
 */
export class BadgeFlash {
  private readonly el = element('div', 'sl-badge-flash');
  private readonly glyph = element('span', 'sl-badge-glyph');
  private readonly name = element('b', 'sl-badge-name');
  private readonly blurb = element('p', 'sl-badge-blurb');
  private readonly queue: BadgeDef[] = [];
  private running = false;

  constructor(container: HTMLElement) {
    const card = element('div', 'sl-badge-card');
    card.append(this.glyph, element('div', 'sl-badge-kicker', 'BADGE UNLOCKED'), this.name, this.blurb);
    this.el.append(card);
    this.el.hidden = true;
    container.append(this.el);
  }

  enqueue(badges: BadgeDef[]): void {
    this.queue.push(...badges);
    if (!this.running) void this.drain();
  }

  private async drain(): Promise<void> {
    this.running = true;
    while (this.queue.length > 0) {
      const badge = this.queue.shift()!;
      this.glyph.textContent = badge.glyph;
      this.name.textContent = badge.name;
      this.blurb.textContent = badge.blurb;
      this.el.hidden = false;
      this.el.classList.add('in');
      await wait(2000);
      this.el.classList.remove('in');
      await wait(280);
      this.el.hidden = true;
    }
    this.running = false;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
