import { matchCommand, type Match, type Vocabulary } from './commandMatcher';

export type VoiceState = 'off' | 'starting' | 'listening' | 'error';

export interface VoiceHandlers {
  /** The vocabulary is read fresh on every transcript, so it can follow the loaded organ. */
  vocabulary(): Vocabulary;
  onCommand(match: Match, heard: string): void;
  /** Live transcript, interim words included, for on-screen feedback. */
  onHeard(text: string): void;
  onState(state: VoiceState, detail?: string): void;
}

const RESTART_DELAY_MS = 250;
// The same command fired again this soon is the recogniser re-delivering the
// same words (it does, as an utterance goes from interim to final), not a
// second request.
const DUPLICATE_WINDOW_MS = 1500;

/**
 * Continuous speech recognition feeding the command matcher.
 *
 * This uses the browser's own recogniser, which in Chrome and Safari streams
 * audio to the vendor's servers. That is the one place the app is not
 * client-side-only, so it is opt-in, off by default and labelled in the UI.
 * Interim results are acted on, not just final ones: waiting for the speaker
 * to stop talking adds a visible lag to every command.
 */
export class VoiceNavigator {
  private recognition: SpeechRecognitionLike | null = null;
  private wanted = false;
  private lastFired = { key: '', at: 0 };
  private restartTimer: number | undefined;

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
    this.recognition?.abort();
    this.recognition = null;
    this.handlers.onState('off');
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
        const first = result[0]?.transcript ?? '';
        this.handlers.onHeard(first.trim());

        // Try each alternative the recogniser offers: the right words are often
        // its second guess.
        for (let a = 0; a < result.length; a++) {
          const text = result[a]!.transcript;
          const match = matchCommand(text, this.handlers.vocabulary());
          if (match && this.accept(match)) {
            this.handlers.onCommand(match, text.trim());
            break;
          }
        }
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

  private accept(match: Match): boolean {
    const key = JSON.stringify(match.command);
    const now = performance.now();
    if (key === this.lastFired.key && now - this.lastFired.at < DUPLICATE_WINDOW_MS) return false;
    this.lastFired = { key, at: now };
    return true;
  }
}
