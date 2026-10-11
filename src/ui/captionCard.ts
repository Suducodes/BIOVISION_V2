/**
 * The caption card at the bottom of the screen: what the app is saying, what it
 * heard, and — when it asks a question — the answers as buttons.
 *
 * Everything spoken is also written here, so narration works with the sound
 * off, in a noisy hall, or for someone who cannot hear it. Every question can
 * be answered by tapping as well as by speaking.
 */
export interface CaptionChip {
  id: string;
  label: string;
}

export class CaptionCard {
  private readonly card = el('caption');
  private readonly kicker = el('caption-kicker');
  private readonly text = el('caption-text');
  private readonly heard = el('caption-heard');
  private readonly chips = el('caption-chips');
  private readonly progress = el('caption-progress');
  private hideTimer: number | undefined;
  private sticky = false;

  constructor(private readonly onChip: (id: string) => void) {}

  /** Shows a sentence being spoken; `null` lets the card fade once it is idle. */
  setSentence(sentence: string | null): void {
    window.clearTimeout(this.hideTimer);
    if (sentence) {
      this.text.textContent = sentence;
      this.text.classList.remove('idle');
      this.show();
    } else if (!this.sticky) {
      this.hideTimer = window.setTimeout(() => this.hide(), 4500);
    }
  }

  /** Small heading above the caption: the mode or part in play. */
  setKicker(text: string): void {
    this.kicker.textContent = text;
  }

  /** The live transcript, shown under the caption while the user speaks. */
  setHeard(text: string, final: boolean): void {
    this.heard.textContent = text ? `“${text}”` : '';
    this.heard.classList.toggle('final', final);
    if (text) this.show();
  }

  setChips(chips: CaptionChip[]): void {
    this.chips.replaceChildren(
      ...chips.map((chip) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'caption-chip';
        button.textContent = chip.label;
        button.addEventListener('click', () => this.onChip(chip.id));
        return button;
      }),
    );
  }

  /**
   * Tour and quiz progress as a row of dots; `null` removes it. A sticky card
   * stays up between sentences, which a tour or quiz needs.
   */
  setProgress(progress: { index: number; total: number; marks?: Array<boolean | null> } | null): void {
    this.sticky = progress !== null;
    this.card.classList.toggle('sticky', this.sticky);
    if (!progress) {
      this.progress.replaceChildren();
      return;
    }
    const dots: HTMLElement[] = [];
    for (let i = 0; i < progress.total; i++) {
      const dot = document.createElement('i');
      const mark = progress.marks?.[i];
      dot.className = i === progress.index ? 'now' : i < progress.index ? 'done' : '';
      if (mark === true) dot.classList.add('right');
      if (mark === false) dot.classList.add('wrong');
      dots.push(dot);
    }
    this.progress.replaceChildren(...dots);
    this.show();
  }

  show(): void {
    window.clearTimeout(this.hideTimer);
    this.card.classList.remove('hidden');
  }

  hide(): void {
    this.card.classList.add('hidden');
  }
}

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`caption element #${id} missing`);
  return node;
}
