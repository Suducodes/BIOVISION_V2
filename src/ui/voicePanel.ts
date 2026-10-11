import type { VoiceState } from '../voice/voiceNavigator';

export interface VoicePanelHandlers {
  onToggleListening(): void;
  /** A segment chip was tapped, or the reset chip (`'reset'`). */
  onChip(id: string): void;
}

const STATE_TEXT: Record<VoiceState, string> = {
  off: 'OFF',
  starting: 'STARTING',
  listening: 'LISTENING',
  error: 'ERROR',
};

const IDLE_PROMPT = 'Say a segment name, or tap one below.';

/**
 * The voice panel and the focus label.
 *
 * It only draws state: it never decides what a command means. The chips double
 * as the fallback — everything that can be said can also be tapped — so a noisy
 * room, a blocked microphone or an offline machine costs the presenter nothing.
 */
export class VoicePanel {
  private readonly panel = el('voice');
  private readonly head = el('voice-head');
  private readonly toggle = el('voice-toggle') as HTMLButtonElement;
  private readonly stateText = el('voice-state');
  private readonly heard = el('voice-heard');
  private readonly chips = el('voice-chips');
  private readonly note = el('voice-note');

  private readonly focusLabel = el('focus-label');
  private readonly focusName = el('focus-name');
  private readonly focusHeard = el('focus-heard');

  constructor(
    private readonly handlers: VoicePanelHandlers,
    supported: boolean,
  ) {
    this.head.addEventListener('click', () => {
      const collapsed = this.panel.classList.toggle('collapsed');
      this.head.setAttribute('aria-expanded', String(!collapsed));
    });
    this.toggle.addEventListener('click', () => this.handlers.onToggleListening());

    if (!supported) {
      this.toggle.disabled = true;
      this.toggle.textContent = 'VOICE UNAVAILABLE';
      this.note.textContent =
        'This browser has no speech recognition. Open the app in Chrome or Edge, or tap a segment below instead.';
    }
    this.setState('off');
    this.setHeard('');
  }

  /** Rebuilds the chips for whichever specimen is loaded. */
  setSegments(segments: Array<{ id: string; label: string }>): void {
    this.chips.replaceChildren();
    if (segments.length === 0) {
      const none = document.createElement('p');
      none.className = 'voice-note';
      none.style.gridColumn = '1 / -1';
      none.textContent = 'This specimen has no named segments yet. You can still say "show heart", "show lungs" or "show coronary".';
      this.chips.append(none);
      return;
    }
    for (const segment of segments) {
      this.chips.append(this.chip(segment.id, segment.label));
    }
    const reset = this.chip('reset', 'RESET VIEW');
    reset.classList.add('wide');
    this.chips.append(reset);
  }

  /** Marks the focused chip; `null` clears it. */
  setActive(id: string | null): void {
    for (const chip of this.chips.querySelectorAll<HTMLElement>('.voice-chip')) {
      chip.classList.toggle('active', chip.dataset.id === id);
    }
  }

  setState(state: VoiceState, detail?: string): void {
    this.panel.dataset.state = state;
    this.stateText.textContent = STATE_TEXT[state];
    this.toggle.textContent = state === 'listening' || state === 'starting' ? 'STOP LISTENING' : 'START LISTENING';
    if (state === 'error' && detail) this.setHeard(detail);
    if (state === 'off') this.setHeard('');
    // The recogniser is the whole point of opening this panel, so show it.
    if (state === 'starting') this.expand();
  }

  setHeard(text: string): void {
    this.heard.textContent = text || IDLE_PROMPT;
    this.heard.classList.toggle('idle', !text);
  }

  /** Shows which segment is in focus and what was said to get there. */
  setFocus(label: string | null, heard?: string): void {
    if (label === null) {
      this.focusLabel.classList.add('hidden');
      return;
    }
    this.focusName.textContent = label;
    this.focusHeard.textContent = heard ? `heard “${heard}”` : '';
    this.focusLabel.classList.remove('hidden');
  }

  expand(): void {
    this.panel.classList.remove('collapsed');
    this.head.setAttribute('aria-expanded', 'true');
  }

  private chip(id: string, label: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'voice-chip';
    button.dataset.id = id;
    button.textContent = label;
    button.addEventListener('click', () => this.handlers.onChip(id));
    return button;
  }
}

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`voice panel element #${id} missing`);
  return node;
}
