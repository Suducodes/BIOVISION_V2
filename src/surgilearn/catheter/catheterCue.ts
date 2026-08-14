import { element } from '../ui/panel';

/**
 * Hand-placement cue, drawn over the live camera feed during catheter
 * navigation.
 *
 * Without it the control scheme is undiscoverable: nothing on screen says
 * the advance axis reads hand *height*, that it only reads a band in the
 * middle of frame rather than the whole picture, or which end is "forward".
 * The band drawn here is deliberately to scale with the real mapping
 * constants in catheterNav.ts (Y_ADVANCE_LOW/HIGH, X_STEER_LOW/HIGH), so
 * "put your hand in the box" is literally true, not decorative.
 *
 * Goes quiet once the hand is actually in range — a cue that keeps
 * instructing after you've complied is just noise.
 */
export class CatheterCue {
  private readonly root = element('div', 'cath-cue sl-hidden');
  private locked = false;

  constructor(container: HTMLElement) {
    const band = element('div', 'cath-cue-band');
    const top = element('div', 'cath-cue-label top', '▲ ADVANCE');
    const bottom = element('div', 'cath-cue-label bottom', '▼ WITHDRAW');
    const hint = element('div', 'cath-cue-hint', 'RAISE ONE HAND INTO THE BOX');

    this.root.append(band, top, bottom, hint);
    container.append(this.root);
  }

  show(): void {
    this.root.classList.remove('sl-hidden');
  }

  hide(): void {
    this.root.classList.add('sl-hidden');
    this.setLocked(false);
  }

  /** @param inRange true once a tracked hand sits inside the active band */
  setLocked(inRange: boolean): void {
    if (inRange === this.locked) return;
    this.locked = inRange;
    this.root.classList.toggle('locked', inRange);
  }
}
