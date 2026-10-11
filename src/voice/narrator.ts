/**
 * Speaks to the user, sentence by sentence, through the browser's own
 * text-to-speech, and reports each sentence as it starts so it can be captioned.
 *
 * Voices marked `localService` synthesise on the device, so narration keeps
 * working offline; they are preferred over network voices. Sentences are queued
 * one utterance each because Chrome silently cuts off a long utterance after
 * about fifteen seconds.
 */
export interface NarratorHandlers {
  /** A sentence has started; `null` when everything queued has been said. */
  onSentence(text: string | null): void;
}

// After speech ends the room still echoes it for a moment; the microphone
// should ignore that tail.
const ECHO_TAIL_MS = 450;

export class Narrator {
  private voice: SpeechSynthesisVoice | null = null;
  private muted = false;
  private queue: string[] = [];
  private active = false;
  private quietUntil = 0;
  private generation = 0;
  private finished: (() => void) | null = null;

  static isSupported(): boolean {
    return 'speechSynthesis' in window;
  }

  constructor(private readonly handlers: NarratorHandlers) {
    if (!Narrator.isSupported()) return;
    const pick = () => {
      const voices = speechSynthesis.getVoices();
      const english = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
      const rank = (v: SpeechSynthesisVoice) =>
        (v.localService ? 4 : 0) +
        (v.lang.toLowerCase() === 'en-in' ? 3 : v.lang.toLowerCase() === 'en-gb' ? 2 : 1) +
        (/natural|neural|online/i.test(v.name) ? 1 : 0);
      this.voice = english.sort((a, b) => rank(b) - rank(a))[0] ?? null;
    };
    pick();
    speechSynthesis.addEventListener('voiceschanged', pick);
  }

  /** True while speaking, and for a moment after, while the room still echoes. */
  get speaking(): boolean {
    // Muted captions make no sound, so there is nothing for the microphone to
    // mishear.
    if (this.muted) return false;
    return this.active || performance.now() < this.quietUntil;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.cancel();
  }

  /**
   * Says `text`, replacing anything still being said. The returned promise
   * settles when it has all been spoken, or when it is interrupted — so a tour
   * can simply await each stop. Captions are shown even when muted.
   */
  say(text: string): Promise<void> {
    this.cancel();
    const generation = ++this.generation;
    this.queue = text.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
    return new Promise((resolve) => {
      this.finished = resolve;
      this.next(generation);
    });
  }

  /** Stops speaking and drops the queue. */
  cancel(): void {
    this.generation++;
    this.queue = [];
    if (Narrator.isSupported()) speechSynthesis.cancel();
    if (this.active) this.quietUntil = performance.now() + ECHO_TAIL_MS;
    this.active = false;
    const done = this.finished;
    this.finished = null;
    done?.();
  }

  private next(generation: number): void {
    if (generation !== this.generation) return;
    const sentence = this.queue.shift();
    if (sentence === undefined) {
      this.active = false;
      this.quietUntil = performance.now() + ECHO_TAIL_MS;
      this.handlers.onSentence(null);
      const done = this.finished;
      this.finished = null;
      done?.();
      return;
    }
    this.active = true;
    this.handlers.onSentence(sentence);

    if (this.muted || !Narrator.isSupported()) {
      // Silent: hold each caption about as long as it would take to say.
      window.setTimeout(() => this.next(generation), 900 + sentence.length * 55);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(sentence);
    if (this.voice) utterance.voice = this.voice;
    utterance.lang = this.voice?.lang ?? 'en-IN';
    utterance.rate = 1.02;
    // Move on exactly once, whichever comes first: the end of the sentence, an
    // error, or a generous timeout. Some engines (no voices installed, a
    // backgrounded tab) never report the end, and that must not stall a tour.
    let moved = false;
    const advance = () => {
      if (moved) return;
      moved = true;
      window.clearTimeout(fallback);
      this.next(generation);
    };
    const fallback = window.setTimeout(advance, 2500 + sentence.length * 110);
    utterance.onend = advance;
    utterance.onerror = advance;
    speechSynthesis.speak(utterance);
  }
}
