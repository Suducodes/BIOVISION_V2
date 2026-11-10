import type { LiveVoice, VoiceMode } from '../voice/voiceNavigator';
import { similarWords, tokenise } from '../voice/commandMatcher';

/**
 * The live voice display, bottom centre: a microphone orb that pulses with
 * your voice, your words appearing as you say them (settled words bright,
 * words still being recognised dimmer), and what the app made of them.
 *
 * It answers the three questions a speaker has, at a glance and from across
 * a room: Is it hearing me? What did it hear? What will it do?
 *  - Waiting for the rest of a name, it says so and shows what could come next
 *    ("left … ventricle · atrium · auricle"), each tappable.
 *  - Understood, the words that matched light up and the result is named.
 * In push-to-talk mode the orb is also the talk button: hold it (or Space).
 */
export interface VoiceHudHandlers {
  /** A suggested continuation was tapped (a part id or `intent:<name>`). */
  onPick(id: string, label: string): void;
  onPress(): void;
  onRelease(): void;
}

const HOLD_HINT = 'Hold SPACE or this button, then speak';

export class VoiceHud {
  private readonly root = el('voice-hud');
  private readonly orb = el('vh-orb');
  private readonly status = el('vh-status');
  private readonly settled = el('vh-settled');
  private readonly tentative = el('vh-tentative');
  private readonly next = el('vh-next');
  private readonly result = el('vh-result');
  private mode: VoiceMode = 'open';
  private on = false;
  private fadeTimer: number | undefined;
  private lastPhase: LiveVoice['phase'] = 'idle';

  constructor(private readonly handlers: VoiceHudHandlers) {
    const down = (e: Event) => {
      if (this.mode !== 'ptt') return;
      e.preventDefault();
      this.handlers.onPress();
    };
    const up = () => {
      if (this.mode === 'ptt') this.handlers.onRelease();
    };
    this.orb.addEventListener('pointerdown', down);
    this.orb.addEventListener('pointerup', up);
    this.orb.addEventListener('pointerleave', up);
    this.orb.addEventListener('pointercancel', up);
  }

  /** Shown while voice is on. */
  setActive(on: boolean): void {
    this.on = on;
    this.root.classList.toggle('hidden', !on);
    document.getElementById('app')?.classList.toggle('voice-live', on);
    if (on) this.update({ phase: this.mode === 'ptt' ? 'closed' : 'idle', settled: '', tentative: '' });
  }

  setMode(mode: VoiceMode): void {
    this.mode = mode;
    this.root.dataset.mode = mode;
    if (this.on) this.update({ phase: mode === 'ptt' ? 'closed' : 'idle', settled: '', tentative: '' });
  }

  /** Mic loudness 0..1, every frame. */
  setLevel(level: number): void {
    this.orb.style.setProperty('--level', level.toFixed(3));
  }

  update(live: LiveVoice): void {
    window.clearTimeout(this.fadeTimer);
    this.lastPhase = live.phase;
    this.root.dataset.phase = live.phase;

    const statusText: Record<LiveVoice['phase'], string> = {
      idle: 'Listening. Say a part, like “left ventricle”',
      ready: 'Speak now…',
      hearing: 'Hearing you…',
      waiting: 'Keep going…',
      acting: 'Got it',
      nomatch: 'Not a command. Try again, or say “help”',
      closed: HOLD_HINT,
    };
    this.status.textContent = statusText[live.phase];

    // Words: the ones that matched a name light up once a command is understood.
    const matchWords = live.matched ? tokenise(live.matched) : [];
    this.settled.replaceChildren(...this.words(live.settled, matchWords, live.phase === 'waiting' && !live.tentative));
    this.tentative.replaceChildren(...this.words(live.tentative, matchWords, live.phase === 'waiting'));

    // What could come next.
    this.next.replaceChildren();
    if (live.phase === 'waiting' && live.next?.length) {
      const seen = new Set<string>();
      for (const c of live.next) {
        const label = c.id.startsWith('intent:') ? c.label : c.label;
        if (seen.has(label) || seen.size >= 4) continue;
        seen.add(label);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'vh-chip';
        b.innerHTML = `<b>${escapeHtml(c.rest)}</b><span>${escapeHtml(label)}</span>`;
        b.addEventListener('click', () => this.handlers.onPick(c.id, label));
        this.next.append(b);
      }
    }

    this.result.textContent = '';
    if (live.phase === 'acting' && live.matched) this.result.textContent = `✓ ${capitalise(live.matched)}`;
    // The caption card sits just above this display, however tall it is now.
    document.documentElement.style.setProperty('--voice-hud-h', `${this.root.offsetHeight}px`);

    // A finished exchange fades back to the resting prompt.
    if (live.phase === 'acting' || live.phase === 'nomatch') {
      this.fadeTimer = window.setTimeout(() => {
        if (this.lastPhase === live.phase) {
          this.update({ phase: this.mode === 'ptt' ? 'closed' : 'idle', settled: '', tentative: '' });
        }
      }, live.phase === 'acting' ? 2600 : 3200);
    }
  }

  /** Names the result of a command (the part's name rather than the words heard). */
  confirm(text: string): void {
    this.result.textContent = `✓ ${text}`;
  }

  /** Words as spans; matched ones highlighted, the last one marked while waiting. */
  private words(text: string, matched: string[], markLast: boolean): HTMLElement[] {
    const parts = text.split(/\s+/).filter(Boolean);
    return parts.map((w, i) => {
      const span = document.createElement('span');
      span.textContent = w + ' ';
      const t = tokenise(w)[0];
      if (t && matched.some((m) => similarWords(t, m))) span.className = 'hit';
      if (markLast && i === parts.length - 1) span.className = 'dangling';
      return span;
    });
  }
}

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`voice hud element #${id} missing`);
  return node;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
