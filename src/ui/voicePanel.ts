import type { VoiceState } from '../voice/voiceNavigator';

export type ModeId = 'xray' | 'atlas' | 'flow' | 'tour' | 'quiz';

export interface VoicePanelHandlers {
  onToggleListening(): void;
  /** A part chip was tapped, or the reset chip (`'reset'`). */
  onChip(id: string): void;
  onMode(mode: ModeId): void;
  /** A command was typed instead of spoken. */
  onTyped(text: string): void;
  /** The recogniser's language (accent) was changed. */
  onLanguage(lang: string): void;
}

const LANG_KEY = 'biovision.voiceLang';

const STATE_TEXT: Record<VoiceState, string> = {
  off: 'OFF',
  starting: 'STARTING',
  listening: 'LISTENING',
  error: 'ERROR',
};

const GROUPS: Array<{ id: string; title: string }> = [
  { id: 'chamber', title: 'CHAMBERS & SURFACE' },
  { id: 'vessel', title: 'GREAT VESSELS' },
  { id: 'inside', title: 'INSIDE · SCHEMATIC' },
];

const IDLE_PROMPT = 'Say a part, or try “x-ray”, “follow the blood”, “quiz me”.';

/**
 * The voice panel and the focus label.
 *
 * It only draws state: it never decides what a command means. The chips and
 * the type-in box double as the fallback — everything that can be said can
 * also be tapped or typed — so a noisy room, a blocked microphone, an offline
 * machine or a user who cannot speak costs nothing.
 */
export class VoicePanel {
  private readonly panel = el('voice');
  private readonly head = el('voice-head');
  private readonly toggle = el('voice-toggle') as HTMLButtonElement;
  private readonly stateText = el('voice-state');
  private readonly heard = el('voice-heard');
  private readonly modes = el('voice-modes');
  private readonly chips = el('voice-chips');
  private readonly note = el('voice-note');
  private readonly typed = el('voice-typed') as HTMLInputElement;

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
    for (const button of this.modes.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
      button.addEventListener('click', () => this.handlers.onMode(button.dataset.mode as ModeId));
    }
    const lang = el('voice-lang') as HTMLSelectElement;
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved && [...lang.options].some((o) => o.value === saved)) lang.value = saved;
    } catch {
      // Storage blocked: the default is fine.
    }
    lang.addEventListener('change', () => {
      try {
        localStorage.setItem(LANG_KEY, lang.value);
      } catch {
        // Not remembered, but still applied.
      }
      this.handlers.onLanguage(lang.value);
    });
    el('voice-typed-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const text = this.typed.value.trim();
      if (!text) return;
      this.handlers.onTyped(text);
      this.typed.value = '';
    });

    if (!supported) {
      this.toggle.disabled = true;
      this.toggle.textContent = 'MIC UNAVAILABLE';
      this.note.textContent =
        'This browser has no speech recognition. Open the app in Chrome or Edge — or type a command above, or tap a part.';
    }
    this.setState('off');
    this.setHeard('');
  }

  /** The language chosen in the panel (remembered between visits). */
  get language(): string {
    return (el('voice-lang') as HTMLSelectElement).value;
  }

  /** Rebuilds the chips for whichever specimen is loaded. */
  setSegments(segments: Array<{ id: string; label: string; group: string }>): void {
    this.chips.replaceChildren();
    this.modes.classList.toggle('hidden', segments.length === 0);
    if (segments.length === 0) {
      const none = document.createElement('p');
      none.className = 'voice-note';
      none.textContent =
        'This specimen has no named parts yet. You can still say “show heart”, “show lungs” or “show coronary”, or “turn around”.';
      this.chips.append(none);
      return;
    }
    for (const group of GROUPS) {
      const members = segments.filter((s) => s.group === group.id);
      if (members.length === 0) continue;
      const title = document.createElement('h3');
      title.className = 'voice-group';
      title.textContent = group.title;
      this.chips.append(title);
      for (const segment of members) this.chips.append(this.chip(segment.id, segment.label));
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

  /** Lights the mode buttons that are on. */
  setModes(on: Partial<Record<ModeId, boolean>>): void {
    for (const button of this.modes.querySelectorAll<HTMLElement>('[data-mode]')) {
      const value = on[button.dataset.mode as ModeId];
      if (value !== undefined) button.classList.toggle('on', value);
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

  /** Shows which part is in focus and what was said to get there. */
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
