import { matchCommand, type Intent, type Match, type MatchContext, type Vocabulary } from './commandMatcher';

export type VoiceState = 'off' | 'starting' | 'listening' | 'error';

export interface VoiceHandlers {
  /** The vocabulary is read fresh on every transcript, so it can follow the loaded organ. */
  vocabulary(): Vocabulary;
  /** Any open question the next words should answer. */
  context(): MatchContext;
  /**
   * True while the app is talking. The microphone hears the app's own voice,
   * and narration is full of part names, so only a short list of interrupting
   * commands is accepted then.
   */
  isSpeaking(): boolean;
  onCommand(match: Match, heard: string): void;
  /** Live transcript, interim words included, for on-screen feedback. */
  onHeard(text: string, final: boolean): void;
  onState(state: VoiceState, detail?: string): void;
}

const RESTART_DELAY_MS = 250;
// The same command fired again this soon is the recogniser re-delivering the
// same words (it does, as an utterance goes from interim to final), not a
// second request.
const DUPLICATE_WINDOW_MS = 1500;
// A partial match ("superior") waits this long for the words that might
// complete it ("…vena cava", or "…view") before it is acted on.
const SETTLE_MS = 650;

/** Commands that may cut in while the app is speaking. */
const BARGE_IN = new Set<Intent>(['stop', 'next', 'previous', 'mute', 'dont-know']);

/**
 * Continuous speech recognition feeding the command matcher.
 *
 * This uses the browser's own recogniser, which in Chrome and Safari streams
 * audio to the vendor's servers. That is the one place the app is not
 * client-side-only, so it is opt-in, off by default and labelled in the UI.
 * A whole phrase ("left ventricle") is acted on from the interim result —
 * waiting for the speaker to stop adds a visible lag to every command — while
 * a lone word that might be the start of something longer waits a moment.
 */
export class VoiceNavigator {
  private recognition: SpeechRecognitionLike | null = null;
  private wanted = false;
  private lastFired = { key: '', at: 0 };
  private restartTimer: number | undefined;
  private settleTimer: number | undefined;

  static isSupported(): boolean {
    return Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition);
  }

  constructor(private readonly handlers: VoiceHandlers) {}

  get listening(): boolean {
    return this.wanted;
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
  }

  stop(): void {
    this.wanted = false;
    window.clearTimeout(this.restartTimer);
    window.clearTimeout(this.settleTimer);
    this.recognition?.abort();
    this.recognition = null;
    this.handlers.onState('off');
  }

  /**
   * Runs one transcript through exactly the path a recognised utterance takes.
   * Used by the on-screen tester and for exercising voice without a microphone.
   */
  inject(text: string, final = true): Match | null {
    return this.consider([text], final);
  }

  private open(Ctor: new () => SpeechRecognitionLike): void {
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 3;
    // English as spoken in India; recognition of the accent is noticeably
    // better than with the generic US model, and the vocabulary is plain English.
    rec.lang = 'en-IN';

    rec.onstart = () => this.handlers.onState('listening');

    rec.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]!;
        const alternatives: string[] = [];
        for (let a = 0; a < result.length; a++) alternatives.push(result[a]!.transcript);
        this.handlers.onHeard((alternatives[0] ?? '').trim(), result.isFinal);
        this.consider(alternatives, result.isFinal);
      }
    };

    rec.onerror = (event) => {
      // Silence and a deliberate abort are normal; everything else means the
      // recogniser can't carry on, and restarting would only loop.
      if (event.error === 'no-speech' || event.error === 'aborted') return;
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
      // start() throws if a session is already running; that session is the
      // one we want, so there is nothing to do.
    }
  }

  /**
   * Tries each alternative the recogniser offers — the right words are often
   * its second guess — and acts on the first that means something.
   */
  private consider(alternatives: string[], final: boolean): Match | null {
    const vocabulary = this.handlers.vocabulary();
    const context = this.handlers.context();
    let tentative: { match: Match; text: string } | null = null;
    for (const text of alternatives) {
      const match = matchCommand(text, vocabulary, context);
      if (!match) continue;
      if (this.handlers.isSpeaking() && !(match.command.kind === 'intent' && BARGE_IN.has(match.command.intent))) continue;
      if (match.confident) {
        window.clearTimeout(this.settleTimer);
        this.fire(match, text.trim());
        return match;
      }
      tentative ??= { match, text };
    }
    window.clearTimeout(this.settleTimer);
    if (!tentative) return null;
    if (final) {
      this.fire(tentative.match, tentative.text.trim());
    } else {
      const { match, text } = tentative;
      this.settleTimer = window.setTimeout(() => this.fire(match, text.trim()), SETTLE_MS);
    }
    return tentative.match;
  }

  private fire(match: Match, heard: string): void {
    const key = JSON.stringify(match.command);
    const now = performance.now();
    if (key === this.lastFired.key && now - this.lastFired.at < DUPLICATE_WINDOW_MS) return;
    this.lastFired = { key, at: now };
    this.handlers.onCommand(match, heard);
  }
}
