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
// How long something said stays in the echo memory. The recogniser can deliver
// the app's own words a second or two after they were spoken.
const ECHO_MEMORY_MS = 3000;

export class Narrator {
  private voice: SpeechSynthesisVoice | null = null;
  private muted = false;
  private queue: string[] = [];
  private active = false;
  private quietUntil = 0;
  private generation = 0;
  private finished: (() => void) | null = null;
  /** Words recently spoken (and about to be), for telling the app's own voice from the user's. */
  private spoken: Array<{ words: Set<string>; until: number }> = [];

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

  /**
   * True when `heard` is most likely the microphone picking up the app's own
   * narration: nearly all of its words were in something said in the last few
   * seconds. Anything else is the user, and may interrupt.
   */
  isEcho(heard: string): boolean {
    if (this.muted) return false;
    const now = performance.now();
    this.spoken = this.spoken.filter((s) => s.until > now || (this.active && s.until === Infinity));
    if (this.spoken.length === 0) return false;
    const words = heard.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
    if (words.length === 0) return false;
    const said = new Set<string>();
    for (const s of this.spoken) for (const w of s.words) said.add(w);
    const inNarration = words.filter((w) => said.has(w)).length;
    return inNarration / words.length >= 0.75;
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
  say(text: string, caption?: string): Promise<void> {
    this.cancel();
    const generation = ++this.generation;
    this.queue = text.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
    // Remember every word about to be said, until a few seconds after it ends.
    this.spoken.push({
      words: new Set(text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2)),
      until: Infinity,
    });
    // A separate caption (e.g. a fuller sentence than the one spoken) is shown
    // for the whole utterance instead of the spoken sentences.
    this.caption = caption ?? null;
    if (this.caption) this.handlers.onSentence(this.caption);
    return new Promise((resolve) => {
      this.finished = resolve;
      this.next(generation);
    });
  }

  /** Stops speaking and drops the queue. */
  cancel(): void {
    this.generation++;
    this.queue = [];
    this.expireSpoken();
    if (Narrator.isSupported()) speechSynthesis.cancel();
    if (this.active) this.quietUntil = performance.now() + ECHO_TAIL_MS;
    this.active = false;
    const done = this.finished;
    this.finished = null;
    done?.();
  }

  private caption: string | null = null;

  /** Words of finished or cancelled speech fade from the echo memory after a few seconds. */
  private expireSpoken(): void {
    const until = performance.now() + ECHO_MEMORY_MS;
    for (const s of this.spoken) if (s.until === Infinity) s.until = until;
  }

  private next(generation: number): void {
    if (generation !== this.generation) return;
    const sentence = this.queue.shift();
    if (sentence === undefined) {
      this.active = false;
      this.quietUntil = performance.now() + ECHO_TAIL_MS;
      this.expireSpoken();
      this.handlers.onSentence(null);
      const done = this.finished;
      this.finished = null;
      done?.();
      return;
    }
    this.active = true;
    if (!this.caption) this.handlers.onSentence(sentence);

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
