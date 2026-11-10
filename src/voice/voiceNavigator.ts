import {
  continuations,
  matchCommand,
  type Continuation,
  type Match,
  type MatchContext,
  type Vocabulary,
} from './commandMatcher';
import { HINT_PHRASES } from './soundAlikes';

export type VoiceState = 'off' | 'starting' | 'listening' | 'error';
export type VoiceMode = 'open' | 'ptt';

/** What the live voice display shows, updated as words arrive. */
export interface LiveVoice {
  /**
   * idle: listening, nothing said yet · ready: push-to-talk held, nothing said yet ·
   * hearing: words arriving · waiting: a name has begun ("left …") and the next
   * word is awaited · acting: a command was understood · nomatch: words heard,
   * no command in them · closed: push-to-talk released, nothing is taken in.
   */
  phase: 'idle' | 'ready' | 'hearing' | 'waiting' | 'acting' | 'nomatch' | 'closed';
  /** Words that will not change any more (earlier results of the same phrase). */
  settled: string;
  /** Words the recogniser may still revise. */
  tentative: string;
  /** While waiting: the names that would complete what was said. */
  next?: Continuation[];
  /** While acting: the phrase that matched, for highlighting. */
  matched?: string;
}

export interface VoiceHandlers {
  /** The vocabulary is read fresh on every transcript, so it can follow the loaded organ. */
  vocabulary(): Vocabulary;
  /** Any open question the next words should answer. */
  context(): MatchContext;
  /**
   * True when the words are probably the app's own narration heard through the
   * microphone. Those are ignored; anything else may interrupt the narration.
   */
  isEcho(text: string): boolean;
  onCommand(match: Match, heard: string): void;
  /** Live transcript, interim words included, for the panel. */
  onHeard(text: string, final: boolean): void;
  /** Everything the live voice display needs. */
  onLive(live: LiveVoice): void;
  onState(state: VoiceState, detail?: string): void;
}

/** One line of the voice log (see downloadLog). */
export interface VoiceLogEntry {
  t: number;
  type: 'start' | 'end' | 'error' | 'speech-start' | 'speech-end' | 'result' | 'fire' | 'wait' | 'nomatch' | 'echo' | 'gated' | 'press' | 'release';
  [key: string]: unknown;
}

const RESTART_DELAY_MS = 250;
// The same command fired again this soon is the recogniser re-delivering the
// same words (it does, as an utterance goes from interim to final), not a
// second request.
const DUPLICATE_WINDOW_MS = 1500;
// Chrome ends a result at any short pause, so "left ... ventricle" can arrive as
// two results. Words settled less than this long ago are joined with the next
// ones into one phrase.
const JOIN_MS = 2200;
// A name that is complete but could still grow into a different one ("left
// atrial" -> "left atrial appendage") waits this long for more words.
const CONFIRM_MS = 700;
// A name only begun ("left", "superior", "pulmonary") waits this long for the
// next word before the app acts on what it has, or asks.
const WAIT_MS = 1600;
// A lone distinctive word with nothing that could follow it waits only this long.
const SETTLE_MS = 300;
// Push-to-talk: results for speech made while the key was held still arrive
// after release; they are accepted for this long.
const RELEASE_GRACE_MS = 1500;
// ...and the phrase is acted on this soon after release if the recogniser has
// not finished on its own: letting go of the key IS the end of the phrase.
const RELEASE_FLUSH_MS = 650;

/**
 * Speech recognition feeding the command matcher.
 *
 * This uses the browser's own recogniser, which in Chrome and Safari streams
 * audio to the vendor's servers: the one place the app is not client-side-only,
 * so it is opt-in and labelled in the UI.
 *
 * Three things make it feel like it is listening to a sentence, not to words:
 *  - Phrase memory. Chrome cuts a result at any brief pause, so "left" and
 *    "ventricle" can arrive separately. Recent settled words are joined with
 *    the next ones, so they are matched as "left ventricle".
 *  - Waiting for the rest of a name. A word that only begins a name ("left",
 *    "superior", "pulmonary") makes it wait for the next word, and the display
 *    shows what could come next, instead of acting on or asking about the
 *    first word. A complete, unambiguous name acts at once, from the interim
 *    result, without waiting for the speaker to finish.
 *  - Push-to-talk (optional). Words count only while Space, the on-screen
 *    button or the pedal is held; letting go ends the phrase and acts on it
 *    immediately. The recogniser keeps running underneath, so the first word is
 *    never lost to start-up time.
 * The app's own narration, picked up by the microphone, is recognised and
 * ignored, so the user can talk over it instead of waiting for it to finish.
 */
export class VoiceNavigator {
  private recognition: SpeechRecognitionLike | null = null;
  private wanted = false;
  private lastFired = { key: '', at: 0 };
  private restartTimer: number | undefined;
  private pendingTimer: number | undefined;
  private lang = 'en-IN';
  private hints = true;
  private session = 0;

  private mode: VoiceMode = 'open';
  private held = false;
  private gateUntil = 0;
  private firedThisHold = false;
  private flushTimer: number | undefined;

  /** Settled words carried over from earlier results of the same phrase. */
  private prefix = '';
  private prefixAt = 0;
  /**
   * Words of each result already acted on, by session:index. A long result can
   * carry several commands ("left ventricle ... aorta" without a pause); only
   * the words after the consumed ones are new.
   */
  private consumed = new Map<string, number>();
  /** Word count of the latest alternative seen, for marking it consumed. */
  private altWords = 0;
  /** The latest phrase candidates (one per recogniser alternative). */
  private latest: { phrases: string[]; key: string } | null = null;
  private speechStartAt: number | null = null;

  readonly log: VoiceLogEntry[] = [];

  static isSupported(): boolean {
    return Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition);
  }

  constructor(private readonly handlers: VoiceHandlers) {}

  get listening(): boolean {
    return this.wanted;
  }

  get voiceMode(): VoiceMode {
    return this.mode;
  }

  get pressed(): boolean {
    return this.held;
  }

  start(): void {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) {
      this.handlers.onState('error', 'This browser has no speech recognition. Use Chrome or Edge.');
      return;
    }
    this.wanted = true;
    this.handlers.onState('starting');
    this.open(Ctor);
    this.idle();
  }

  stop(): void {
    this.wanted = false;
    window.clearTimeout(this.restartTimer);
    this.clearPending();
    this.recognition?.abort();
    this.recognition = null;
    this.handlers.onState('off');
  }

  /** Switches the recogniser's language (accent model), restarting it if live. */
  setLanguage(lang: string): void {
    this.lang = lang;
    if (this.wanted) this.recognition?.abort(); // onend reopens with the new language
  }

  /** Always listening, or only while a key / button / pedal is held. */
  setMode(mode: VoiceMode): void {
    this.mode = mode;
    this.held = false;
    this.resetPhrase();
    this.idle();
  }

  /** Push-to-talk pressed: start a fresh phrase. Starts listening if it was off. */
  press(): void {
    this.held = true;
    this.firedThisHold = false;
    window.clearTimeout(this.flushTimer);
    this.resetPhrase();
    this.record({ type: 'press' });
    if (!this.wanted) this.start();
    this.emit({ phase: 'ready', settled: '', tentative: '' });
  }

  /** Push-to-talk released: the phrase is over; act on it now. */
  release(): void {
    if (!this.held) return;
    this.held = false;
    this.gateUntil = performance.now() + RELEASE_GRACE_MS;
    this.record({ type: 'release' });
    window.clearTimeout(this.flushTimer);
    this.flushTimer = window.setTimeout(() => this.flush(), RELEASE_FLUSH_MS);
  }

  /**
   * Runs one transcript through exactly the path a recognised utterance takes.
   * Used by the type-in box's tester and for exercising voice without a microphone.
   */
  inject(text: string, final = true): void {
    // Each injected text is its own result, as a pause would make it: phrase
    // memory, echo filtering and waiting all apply exactly as for the microphone.
    this.onResult(`inject:${performance.now()}`, [text], final, true);
  }

  /** The voice log as a JSON string: every result, decision and timing. */
  logJson(): string {
    return JSON.stringify({ userAgent: navigator.userAgent, lang: this.lang, mode: this.mode, entries: this.log }, null, 1);
  }

  // ------------------------------------------------------------ recogniser

  private open(Ctor: new () => SpeechRecognitionLike): void {
    const rec = new Ctor();
    const session = ++this.session;
    rec.continuous = true;
    rec.interimResults = true;
    // More guesses, more chances: the right words are often the third or fourth.
    rec.maxAlternatives = 5;
    rec.lang = this.lang;
    this.addHints(rec);

    rec.onstart = () => {
      this.record({ type: 'start', session });
      this.handlers.onState('listening');
    };
    const anyRec = rec as unknown as { onspeechstart: (() => void) | null; onspeechend: (() => void) | null };
    anyRec.onspeechstart = () => {
      this.speechStartAt = performance.now();
      this.record({ type: 'speech-start' });
    };
    anyRec.onspeechend = () => this.record({ type: 'speech-end' });

    rec.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]!;
        const alternatives: string[] = [];
        const confidences: number[] = [];
        for (let a = 0; a < result.length; a++) {
          alternatives.push(result[a]!.transcript.trim());
          confidences.push(Math.round((result[a]!.confidence ?? 0) * 100) / 100);
        }
        const key = `${session}:${i}`;
        this.record({ type: 'result', key, final: result.isFinal, alternatives, confidences });
        this.onResult(key, alternatives, result.isFinal);
      }
    };

    rec.onerror = (event) => {
      this.record({ type: 'error', error: event.error });
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      if (event.error === 'phrases-not-supported') {
        this.hints = false;
        return;
      }
      this.wanted = false;
      const reasons: Record<string, string> = {
        'not-allowed': 'Microphone access was blocked. Allow it for this site and try again.',
        'service-not-allowed': 'Speech recognition is blocked on this device.',
        'audio-capture': 'No microphone was found.',
        network: 'Speech recognition needs an internet connection.',
      };
      this.handlers.onState('error', reasons[event.error] ?? `Speech recognition failed (${event.error}).`);
    };

    // Browsers end a "continuous" session after a stretch of silence, so
    // listening only stays on if it is reopened.
    rec.onend = () => {
      this.record({ type: 'end', session });
      this.recognition = null;
      if (!this.wanted) return;
      this.restartTimer = window.setTimeout(() => {
        if (this.wanted) this.open(Ctor);
      }, RESTART_DELAY_MS);
    };

    this.recognition = rec;
    try {
      rec.start();
    } catch {
      // start() throws if a session is already running; that one is fine.
    }
  }

  private gateOpen(): boolean {
    return this.mode === 'open' || this.held || performance.now() < this.gateUntil;
  }

  private onResult(key: string, raw: string[], final: boolean, ungated = false): void {
    // Drop the words of this result that an earlier command already used.
    const used = this.consumed.get(key) ?? 0;
    const alternatives = raw.map((a) => a.split(/\s+/).filter(Boolean).slice(used).join(' ')).filter(Boolean);
    if (alternatives.length === 0) return;
    this.altWords = (raw[0] ?? '').split(/\s+/).filter(Boolean).length;
    if (!ungated && !this.gateOpen()) {
      this.record({ type: 'gated', key, text: alternatives[0] });
      return;
    }
    const now = performance.now();
    if (this.prefix && now - this.prefixAt > JOIN_MS) this.prefix = '';
    // The app's own voice: drop it, and do not let it join a phrase.
    const fresh = alternatives.filter((a) => a && !this.handlers.isEcho(a));
    if (fresh.length === 0) {
      this.record({ type: 'echo', key, text: alternatives[0] });
      return;
    }
    const phrases = fresh.map((a) => `${this.prefix} ${a}`.trim());
    this.handlers.onHeard(phrases[0]!, final);
    this.latest = { phrases, key };
    this.evaluate(phrases, final, key, fresh);
    if (final && (this.consumed.get(key) ?? 0) === used) {
      // Nothing new acted on: keep these words; the next result may finish the name.
      this.prefix = phrases[0]!;
      this.prefixAt = now;
    }
  }

  /**
   * Decides what a phrase means and when to act on it. Returns the match it
   * acted on or scheduled, if any.
   */
  private evaluate(phrases: string[], final: boolean, key: string, words: string[], force = false): Match | null {
    const vocabulary = this.handlers.vocabulary();
    const context = this.handlers.context();
    let tentative: { match: Match; text: string; next: Continuation[] } | null = null;
    let begun: { text: string; next: Continuation[] } | null = null;

    for (const text of phrases) {
      const match = matchCommand(text, vocabulary, context);
      const next = continuations(text, vocabulary).filter((c) => !(match?.command.kind === 'target' && c.id === match.command.id));
      if (!match) {
        if (next.length) begun ??= { text, next };
        continue;
      }
      if (match.confident && next.length === 0) {
        this.clearPending();
        this.fire(match, text, key);
        return match;
      }
      tentative ??= { match, text, next };
    }

    this.clearPending();
    const settled = this.prefix;
    const tentativeWords = (words[0] ?? '').trim();
    if (tentative) {
      const { match, text, next } = tentative;
      const delay = force ? 0 : next.length ? (match.confident ? CONFIRM_MS : WAIT_MS) : final ? 0 : SETTLE_MS;
      if (delay === 0) {
        this.fire(match, text, key);
        return match;
      }
      this.emit({ phase: next.length ? 'waiting' : 'hearing', settled, tentative: tentativeWords, next });
      this.record({ type: 'wait', key, text, ms: delay, next: next.map((n) => n.label) });
      this.pendingTimer = window.setTimeout(() => this.fire(match, text, key), delay);
      return match;
    }
    if (begun && force) {
      this.unfinished(begun.text, begun.next, key);
      return null;
    }
    if (begun) {
      this.emit({ phase: 'waiting', settled, tentative: tentativeWords, next: begun.next });
      this.record({ type: 'wait', key, text: begun.text, ms: WAIT_MS, next: begun.next.map((n) => n.label) });
      this.pendingTimer = window.setTimeout(() => this.unfinished(begun!.text, begun!.next, key), WAIT_MS);
      return null;
    }
    if (final || force) {
      this.noMatch(phrases[0] ?? '');
    } else {
      this.emit({ phase: 'hearing', settled, tentative: tentativeWords });
    }
    return null;
  }

  /** Push-to-talk released: whatever was said is the whole phrase. */
  private flush(): void {
    if (this.firedThisHold) return;
    if (this.pendingTimer !== undefined && this.latest) {
      // Something is waiting for more words that will not come: act now.
      this.clearPending();
      this.evaluate(this.latest.phrases, true, this.latest.key, this.latest.phrases, true);
      return;
    }
    if (this.latest) {
      this.evaluate(this.latest.phrases, true, this.latest.key, this.latest.phrases, true);
      return;
    }
    this.emit({ phase: 'closed', settled: '', tentative: '' });
  }

  /**
   * The speaker stopped partway through a name ("superior …"). If only one part
   * starts that way, they meant it; otherwise say it was not understood.
   */
  private unfinished(text: string, next: Continuation[], key: string): void {
    const parts = [...new Set(next.filter((c) => !c.id.startsWith('intent:')).map((c) => c.id))];
    if (parts.length === 1) {
      const only = next.find((c) => c.id === parts[0])!;
      this.fire({ command: { kind: 'target', id: only.id }, phrase: only.label, confident: false }, text, key);
      return;
    }
    this.noMatch(text);
  }

  private noMatch(text: string): void {
    this.record({ type: 'nomatch', text });
    this.emit({ phase: 'nomatch', settled: text, tentative: '' });
  }

  private fire(match: Match, heard: string, key: string): void {
    this.pendingTimer = undefined;
    this.consumed.set(key, this.altWords);
    this.firedThisHold = true;
    this.resetPhrase();
    const id = JSON.stringify(match.command);
    const now = performance.now();
    if (id === this.lastFired.key && now - this.lastFired.at < DUPLICATE_WINDOW_MS) return;
    this.lastFired = { key: id, at: now };
    this.record({
      type: 'fire',
      key,
      heard,
      command: match.command,
      phrase: match.phrase,
      confident: match.confident,
      msSinceSpeechStart: this.speechStartAt !== null ? Math.round(now - this.speechStartAt) : null,
    });
    this.emit({ phase: 'acting', settled: heard, tentative: '', matched: match.phrase });
    this.handlers.onCommand(match, heard);
  }

  private resetPhrase(): void {
    this.prefix = '';
    this.latest = null;
    this.clearPending();
  }

  private clearPending(): void {
    window.clearTimeout(this.pendingTimer);
    this.pendingTimer = undefined;
  }

  private idle(): void {
    if (!this.wanted && !this.held) return;
    this.emit({ phase: this.mode === 'ptt' && !this.held ? 'closed' : 'idle', settled: '', tentative: '' });
  }

  private emit(live: LiveVoice): void {
    this.handlers.onLive(live);
  }

  private record(entry: Omit<VoiceLogEntry, 't'>): void {
    this.log.push({ t: Math.round(performance.now()), ...entry } as VoiceLogEntry);
    if (this.log.length > 4000) this.log.splice(0, 1000);
  }

  /**
   * Tells the recogniser which words to expect, where the browser supports
   * phrase hints (contextual biasing). Feature-detected, harmless where missing.
   */
  private addHints(rec: SpeechRecognitionLike): void {
    const Phrase = (window as unknown as { SpeechRecognitionPhrase?: new (phrase: string, boost?: number) => unknown })
      .SpeechRecognitionPhrase;
    if (!this.hints || !Phrase || !('phrases' in rec)) return;
    try {
      (rec as unknown as { phrases: unknown[] }).phrases = HINT_PHRASES.map((p) => new Phrase(p, 6));
    } catch {
      this.hints = false;
    }
  }
}
