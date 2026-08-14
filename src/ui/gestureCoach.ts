import type { GestureMode } from '../gesture/types';
import './gestureCoach.css';

/**
 * Live gesture vocabulary.
 *
 * The gesture guide in the bottom-left ships collapsed, so in practice the
 * only thing on screen telling anyone what their hands can do is the words
 * "GESTURE GUIDE". That is fine for the person who built the interaction
 * model and useless for everyone else — an observer watching someone wave at
 * a laptop cannot tell an intentional gesture from a failed one.
 *
 * This shows the two-gesture vocabulary permanently once tracking is live,
 * and lights the row that is *currently* firing. That second part is what
 * makes it more than a legend: it turns the classifier's internal state into
 * visible feedback, so a dropped hand reads as "tracking lost" rather than
 * "the software is broken".
 *
 * Mirrors the real interaction model rather than inventing a tidier one: a
 * single hand drives move and zoom simultaneously (position plus thumb-index
 * aperture), and a second hand switches to rotate. See gesture/types.ts.
 */
export class GestureCoach {
  private readonly root: HTMLElement;
  private readonly grabRow: HTMLElement;
  private readonly rotateRow: HTMLElement;
  private readonly hint: HTMLElement;
  private mode: GestureMode | null = null;

  /**
   * @param container the panel this mounts inside
   * @param insertAfter mount immediately after this element (must be a direct
   *   child of `container`) rather than at the end — used to place the coach
   *   between the video and any trailing content in that container.
   */
  constructor(container: HTMLElement, insertAfter?: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'gesture-coach';
    this.root.className = 'hidden';

    this.grabRow = row('✋', 'ONE HAND', 'Move the specimen · spread fingers to dive inside');
    this.rotateRow = row('✌', 'TWO HANDS', 'Locks in place and spins');
    this.hint = document.createElement('div');
    this.hint.className = 'gc-hint';
    this.hint.textContent = 'SHOW A HAND TO THE CAMERA';

    this.root.append(this.grabRow, this.rotateRow, this.hint);

    if (insertAfter) insertAfter.insertAdjacentElement('afterend', this.root);
    else container.append(this.root);
  }

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  /** Called every frame; cheap-guarded so the DOM is only touched on change. */
  setMode(mode: GestureMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.grabRow.classList.toggle('active', mode === 'GRAB');
    this.rotateRow.classList.toggle('active', mode === 'ROTATE');
    this.hint.textContent =
      mode === 'IDLE' ? 'SHOW A HAND TO THE CAMERA' : 'TRACKING';
  }
}

function row(glyph: string, title: string, blurb: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'gc-row';

  const key = document.createElement('span');
  key.className = 'gc-key';
  key.textContent = glyph;

  const text = document.createElement('div');
  text.className = 'gc-text';
  const b = document.createElement('b');
  b.textContent = title;
  const small = document.createElement('small');
  small.textContent = blurb;
  text.append(b, small);

  el.append(key, text);
  return el;
}
