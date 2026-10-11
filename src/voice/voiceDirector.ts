import * as THREE from 'three';
import type { InteractionController } from '../controller/interactionController';
import type { GestureMapper } from '../gesture/gestureMapper';
import type { SegmentHighlighter } from '../render/segmentHighlight';
import type { HeartInterior } from '../render/heartInterior';
import { BLOOD_ROUTE, insideFocus, type SegmentDef } from '../segments';
import type { CaptionCard } from '../ui/captionCard';
import type { ModeId, VoicePanel } from '../ui/voicePanel';
import type { AtlasLabels } from '../ui/atlasLabels';
import type { Intent, Match, MatchContext } from './commandMatcher';
import type { Narrator } from './narrator';

export interface DirectorDeps {
  controller: InteractionController;
  mapper: GestureMapper;
  panel: VoicePanel;
  caption: CaptionCard;
  narrator: Narrator;
  labels: AtlasLabels;
  parts(): SegmentDef[];
  highlighter(): SegmentHighlighter | null;
  interior(): HeartInterior | null;
  zoomForDistance(distance: number): number;
  switchOrgan(id: string): void;
  activeOrganId(): string;
}

const QUIZ_LENGTH = 5;
const PENDING_MS = 9000;

/**
 * Everything a voice command can do, and the two guided experiences built on
 * top: a tour that follows one drop of blood through the heart, and a spoken
 * quiz. Taps on chips, labels and mode buttons come through here too, so every
 * input path behaves identically.
 *
 * The rule throughout: the app answers. Every command is acknowledged on screen
 * and, unless muted, out loud — a part is named and described as the camera
 * arrives, a vague word gets a question back, and a quiz answer gets a verdict.
 */
export class VoiceDirector {
  focusedId: string | null = null;
  xray = false;
  atlas = false;
  flow = false;
  spinning = false;
  /** Heartbeat speed: 1 real time, 0.3 slow motion, 0 stopped. */
  beatRate = 1;

  private pending: { ids: string[]; until: number } | null = null;
  private lastSpoken = '';
  private mode: 'free' | 'tour' | 'quiz' = 'free';
  // Bumped whenever a tour or quiz is interrupted, so a stale step that was
  // still awaiting narration knows not to carry on.
  private run = 0;
  private tourIndex = 0;
  private quiz: { order: string[]; index: number; marks: Array<boolean | null>; answered: boolean } | null = null;

  constructor(private readonly deps: DirectorDeps) {}

  /** What the next words should be matched against, if a question is open. */
  context(): MatchContext {
    if (this.pending && performance.now() < this.pending.until) return { pending: this.pending.ids };
    this.pending = null;
    return {};
  }

  /** Entry point for every recognised, typed or injected command. */
  handle(match: Match, heard: string): void {
    const { command } = match;
    this.deps.caption.setHeard(heard, true);
    this.deps.panel.setHeard(heard);

    if (command.kind === 'organ') {
      this.endModes();
      if (command.id === this.deps.activeOrganId()) this.reset(heard);
      else this.deps.switchOrgan(command.id);
      return;
    }
    if (command.kind === 'clarify') {
      this.ask(command.ids, command.word);
      return;
    }
    if (command.kind === 'target') {
      this.pending = null;
      if (this.mode === 'quiz' && this.quiz && !this.quiz.answered) {
        void this.answer(command.id);
        return;
      }
      if (this.mode === 'tour') this.endModes();
      if (command.inside) this.setXray(true);
      this.focus(command.id, { heard, speak: command.describe ? 'full' : 'short' });
      return;
    }
    this.intent(command.intent, heard);
  }

  /** Tapped chips and labels: the same as saying the part's name. */
  pick(id: string): void {
    if (id === 'reset') {
      this.endModes();
      this.reset();
      return;
    }
    const part = this.part(id);
    if (!part) return;
    this.handle({ command: { kind: 'target', id }, phrase: part.label, confident: true }, '');
  }

  /** Mode buttons in the panel. */
  toggleMode(mode: ModeId): void {
    if (mode === 'xray') this.setXray(!this.xray, true);
    else if (mode === 'atlas') this.setAtlas(!this.atlas, true);
    else if (mode === 'flow') this.setFlow(!this.flow, true);
    else if (mode === 'tour') this.mode === 'tour' ? this.endModes(true) : void this.startTour();
    else if (mode === 'quiz') this.mode === 'quiz' ? this.endModes(true) : void this.startQuiz();
  }

  /** Called when a new specimen loads: everything resets to the plain view. */
  onSpecimenChanged(): void {
    this.endModes();
    this.focusedId = null;
    this.pending = null;
    // Every specimen opens plain and solid; modes are asked for each time.
    this.xray = false;
    this.atlas = false;
    this.flow = false;
    this.spinning = false;
    this.deps.labels.setParts(this.deps.parts());
    this.deps.labels.setVisible(this.atlas && this.deps.parts().length > 0);
    this.syncModes();
  }

  // --- Focus -------------------------------------------------------------

  focus(id: string, options: { heard?: string; speak?: 'short' | 'full' | 'none'; quiet?: boolean } = {}): void {
    const part = this.part(id);
    if (!part) return;
    if (part.needsXray) this.setXray(true);
    this.focusedId = id;

    this.deps.highlighter()?.select(id);
    this.deps.interior()?.select(part.interior ?? null);

    const inside = this.xray ? insideFocus(part) : null;
    this.deps.controller.focusOn(
      new THREE.Vector3(...(inside?.anchor ?? part.anchor)),
      new THREE.Vector3(...part.view),
      this.deps.zoomForDistance(inside?.distance ?? part.distance),
    );
    this.deps.mapper.holdForVoice();
    this.deps.panel.setActive(id);
    this.deps.panel.setFocus(options.quiet ? '?' : part.label, options.heard);
    this.deps.caption.setKicker(options.quiet ? 'QUIZ' : part.group === 'inside' ? 'INSIDE · SCHEMATIC' : part.label.toUpperCase());
    this.deps.caption.setChips([]);

    if (options.speak === 'full') void this.say(part.blurb);
    else if (options.speak === 'short') void this.say(firstSentence(part.blurb));
  }

  reset(heard?: string): void {
    this.focusedId = null;
    this.deps.highlighter()?.select(null);
    this.deps.interior()?.select(null);
    this.deps.controller.reset();
    this.deps.mapper.holdForVoice();
    this.deps.panel.setActive(null);
    this.deps.panel.setFocus(null);
    this.deps.panel.setHeard(heard ?? '');
    this.deps.caption.setChips([]);
  }

  // --- Modes -------------------------------------------------------------

  setXray(on: boolean, announce = false): void {
    if (this.deps.parts().length === 0) on = false;
    this.xray = on;
    this.deps.highlighter()?.setXray(on);
    if (announce) void this.say(on ? 'X-ray on. The inside is a schematic, built to fit this model.' : 'X-ray off.');
    this.syncModes();
  }

  setAtlas(on: boolean, announce = false): void {
    this.atlas = on;
    this.deps.highlighter()?.setAtlas(on);
    this.deps.labels.setVisible(on && this.deps.parts().length > 0);
    if (announce) void this.say(on ? 'Labels on. Tap any name, or say it.' : 'Labels off.');
    this.syncModes();
  }

  setFlow(on: boolean, announce = false): void {
    this.flow = on;
    this.deps.interior()?.setFlow(on);
    // Blood is inside the heart, so seeing it needs the glass shell.
    if (on && !this.xray) this.setXray(true);
    if (announce) void this.say(on ? 'Blood flow on. Blue is oxygen-poor, red is oxygen-rich.' : 'Blood flow off.');
    this.syncModes();
  }

  private syncModes(): void {
    this.deps.panel.setModes({
      xray: this.xray,
      atlas: this.atlas,
      flow: this.flow,
      tour: this.mode === 'tour',
      quiz: this.mode === 'quiz',
    });
  }

  // --- Intents -----------------------------------------------------------

  private intent(intent: Intent, heard: string): void {
    const c = this.deps.controller;
    switch (intent) {
      case 'reset':
        this.endModes();
        this.reset(heard);
        return;
      case 'xray-on':
        return this.setXray(true, true);
      case 'xray-off':
        if (this.flow) this.setFlow(false);
        return this.setXray(false, true);
      case 'atlas-on':
        return this.setAtlas(true, true);
      case 'atlas-off':
        return this.setAtlas(false, true);
      case 'flow-on':
        return this.setFlow(true, true);
      case 'flow-off':
        return this.setFlow(false, true);
      case 'tour':
        void this.startTour();
        return;
      case 'quiz':
        void this.startQuiz();
        return;
      case 'next':
        if (this.mode === 'tour') void this.tourStep(this.tourIndex + 1);
        else if (this.mode === 'quiz') void this.revealAndContinue();
        else this.stepFocus(1);
        return;
      case 'previous':
        if (this.mode === 'tour') void this.tourStep(Math.max(0, this.tourIndex - 1));
        else this.stepFocus(-1);
        return;
      case 'stop':
        if (this.mode !== 'free') this.endModes(true);
        else this.deps.narrator.cancel();
        this.spinning = false;
        return;
      case 'repeat':
        if (this.lastSpoken) void this.say(this.lastSpoken);
        return;
      case 'describe':
      case 'dont-know':
        if (this.mode === 'quiz') {
          void this.revealAndContinue();
          return;
        }
        if (this.focusedId) void this.say(this.part(this.focusedId)!.blurb);
        else void this.say('Nothing is selected yet. Say the name of a part, like the left ventricle, or say help.');
        return;
      case 'help':
        this.help();
        return;
      case 'view-front':
        return this.view([0, 0, 1]);
      case 'view-back':
        return this.view([0, 0, -1]);
      case 'view-left':
        return this.view([1, 0, 0]);
      case 'view-right':
        return this.view([-1, 0, 0]);
      case 'view-top':
        return this.view([0, 1, 0.0001]);
      case 'view-bottom':
        return this.view([0, -1, 0.0001]);
      case 'rotate-left':
        c.rotateBy(-Math.PI / 4, 0);
        break;
      case 'rotate-right':
        c.rotateBy(Math.PI / 4, 0);
        break;
      case 'rotate-up':
        c.rotateBy(0, -Math.PI / 6);
        break;
      case 'rotate-down':
        c.rotateBy(0, Math.PI / 6);
        break;
      case 'spin':
        this.spinning = true;
        break;
      case 'spin-stop':
        this.spinning = false;
        break;
      case 'zoom-in':
        c.setZoom(c.zoom + 0.2);
        break;
      case 'zoom-out':
        c.setZoom(c.zoom - 0.2);
        break;
      case 'mute':
        this.deps.narrator.setMuted(true);
        this.deps.caption.setSentence('Voice muted. Captions stay on.');
        this.deps.caption.setSentence(null);
        return;
      case 'unmute':
        this.deps.narrator.setMuted(false);
        void this.say('Voice on.');
        return;
      case 'slow':
        this.beatRate = 0.3;
        void this.say('Slow motion. Watch the valves.');
        return;
      case 'normal-speed':
        this.beatRate = 1;
        void this.say('Normal speed, seventy-two beats a minute.');
        return;
      case 'pause-beat':
        this.beatRate = 0;
        void this.say('Heart paused.');
        return;
      case 'resume-beat':
        this.beatRate = 1;
        void this.say('Beating again.');
        return;
    }
    this.deps.mapper.holdForVoice();
  }

  private view(direction: [number, number, number]): void {
    this.deps.controller.focusOn(new THREE.Vector3(), new THREE.Vector3(...direction), 0);
    this.deps.mapper.holdForVoice();
  }

  /** "next"/"previous" outside a tour step through the parts in panel order. */
  private stepFocus(step: number): void {
    const parts = this.deps.parts();
    if (parts.length === 0) return;
    const at = this.focusedId ? parts.findIndex((p) => p.id === this.focusedId) : -1;
    const next = parts[(at + step + parts.length) % parts.length]!;
    this.focus(next.id, { speak: 'short' });
  }

  private help(): void {
    const parts = this.deps.parts();
    if (parts.length === 0) {
      void this.say('Say show heart, show lungs or show coronary. You can also say turn around, zoom in, or reset.');
      return;
    }
    this.deps.caption.setKicker('TRY SAYING');
    this.deps.caption.setChips(
      ['Left ventricle', 'Mitral valve', 'X-ray', 'Labels', 'Blood flow', 'Follow the blood', 'Quiz me', 'Turn around', 'Slow motion'].map(
        (label) => ({ id: `say:${label}`, label }),
      ),
    );
    void this.say(
      'Name any part, like the left ventricle or the mitral valve. Say x-ray to see inside, labels for the full atlas, ' +
        'follow the blood for a guided tour, or quiz me to test yourself.',
    );
  }

  /** Asks which of several parts was meant; the next words are matched against them. */
  private ask(ids: string[], word: string): void {
    const parts = ids.map((id) => this.part(id)).filter((p): p is SegmentDef => Boolean(p));
    if (parts.length === 0) return;
    this.pending = { ids: parts.map((p) => p.id), until: performance.now() + PENDING_MS };
    const names = parts.map((p) => p.label.toLowerCase());
    const list = names.length === 2 ? `${names[0]} or ${names[1]}` : `${names.slice(0, -1).join(', ')}, or ${names.at(-1)}`;
    this.deps.caption.setKicker(`“${word.toUpperCase()}” — WHICH ONE?`);
    this.deps.caption.setChips(parts.map((p) => ({ id: p.id, label: p.label })));
    void this.say(`Which one: the ${list}?`);
  }

  // --- Tour: follow the blood --------------------------------------------

  async startTour(): Promise<void> {
    if (this.deps.parts().length === 0) {
      void this.say('The tour needs the heart. Say show heart first.');
      return;
    }
    this.endModes();
    this.mode = 'tour';
    this.setXray(true);
    this.setFlow(true);
    this.syncModes();
    this.deps.caption.setKicker('FOLLOW THE BLOOD');
    await this.tourStep(0);
  }

  private async tourStep(index: number): Promise<void> {
    if (this.mode !== 'tour') return;
    if (index >= BLOOD_ROUTE.length) {
      this.endModes();
      this.reset();
      void this.say('Tour complete. Say quiz me to test yourself.');
      return;
    }
    const run = ++this.run;
    this.tourIndex = index;
    const stop = BLOOD_ROUTE[index]!;
    const part = this.part(stop.id);
    this.deps.caption.setProgress({ index, total: BLOOD_ROUTE.length });
    if (part) this.focus(part.id, { speak: 'none' });
    this.deps.caption.setKicker(`FOLLOW THE BLOOD · ${part?.label.toUpperCase() ?? ''}`);
    await this.say(stop.line);
    // Give the camera time to arrive and the eye time to look.
    await wait(900);
    if (run === this.run && this.mode === 'tour') await this.tourStep(index + 1);
  }

  // --- Quiz ----------------------------------------------------------------

  async startQuiz(): Promise<void> {
    const parts = this.deps.parts();
    if (parts.length === 0) {
      void this.say('The quiz needs the heart. Say show heart first.');
      return;
    }
    this.endModes();
    // Name tags would give every answer away.
    this.setAtlas(false);
    this.mode = 'quiz';
    this.syncModes();
    const order = shuffle(parts.map((p) => p.id)).slice(0, QUIZ_LENGTH);
    this.quiz = { order, index: 0, marks: order.map(() => null), answered: false };
    this.deps.caption.setKicker('QUIZ');
    await this.say(`Quiz time. ${QUIZ_LENGTH} questions. Name the part that lights up.`);
    await this.askQuestion();
  }

  private async askQuestion(): Promise<void> {
    const quiz = this.quiz;
    if (!quiz || this.mode !== 'quiz') return;
    if (quiz.index >= quiz.order.length) {
      const score = quiz.marks.filter(Boolean).length;
      this.endModes();
      this.reset();
      const verdict = score === quiz.order.length ? 'Perfect score!' : score >= 3 ? 'Well done.' : 'Keep exploring and try again.';
      this.deps.caption.setKicker(`SCORE ${score} / ${quiz.order.length}`);
      void this.say(`You scored ${score} out of ${quiz.order.length}. ${verdict}`);
      return;
    }
    quiz.answered = false;
    const id = quiz.order[quiz.index]!;
    const part = this.part(id)!;
    // Inside parts need the glass shell; surface parts read best without it.
    this.setXray(Boolean(part.needsXray));
    this.focus(id, { speak: 'none', quiet: true });
    this.deps.caption.setKicker(`QUIZ · QUESTION ${quiz.index + 1} OF ${quiz.order.length}`);
    this.deps.caption.setProgress({ index: quiz.index, total: quiz.order.length, marks: quiz.marks });
    this.deps.caption.setChips(this.choices(id).map((p) => ({ id: p.id, label: p.label })));
    await this.say(quiz.index === 0 ? 'What is the glowing part called?' : 'And this one?');
  }

  /** Four options, for anyone answering by tap: the answer and three near neighbours. */
  private choices(answer: string): SegmentDef[] {
    const parts = this.deps.parts();
    const target = this.part(answer)!;
    const sameGroup = shuffle(parts.filter((p) => p.id !== answer && p.group === target.group));
    const others = shuffle(parts.filter((p) => p.id !== answer && p.group !== target.group));
    return shuffle([target, ...[...sameGroup, ...others].slice(0, 3)]);
  }

  private async answer(id: string): Promise<void> {
    const quiz = this.quiz;
    if (!quiz || quiz.answered) return;
    quiz.answered = true;
    const run = ++this.run;
    const correctId = quiz.order[quiz.index]!;
    const correct = this.part(correctId)!;
    const right = id === correctId;
    quiz.marks[quiz.index] = right;
    this.deps.caption.setProgress({ index: quiz.index, total: quiz.order.length, marks: quiz.marks });
    this.deps.caption.setChips([]);
    this.deps.panel.setFocus(correct.label);
    await this.say(right ? `Correct! ${firstSentence(correct.blurb)}` : `Not quite. That is the ${correct.label.toLowerCase()}.`);
    await wait(700);
    if (run !== this.run || this.mode !== 'quiz') return;
    quiz.index++;
    await this.askQuestion();
  }

  private async revealAndContinue(): Promise<void> {
    const quiz = this.quiz;
    if (!quiz || quiz.answered) return;
    quiz.answered = true;
    const run = ++this.run;
    const correct = this.part(quiz.order[quiz.index]!)!;
    quiz.marks[quiz.index] = false;
    this.deps.caption.setProgress({ index: quiz.index, total: quiz.order.length, marks: quiz.marks });
    this.deps.caption.setChips([]);
    this.deps.panel.setFocus(correct.label);
    await this.say(`That is the ${correct.label.toLowerCase()}.`);
    await wait(600);
    if (run !== this.run || this.mode !== 'quiz') return;
    quiz.index++;
    await this.askQuestion();
  }

  /** Leaves a tour or quiz. */
  endModes(announce = false): void {
    const was = this.mode;
    this.run++;
    this.mode = 'free';
    this.quiz = null;
    this.deps.caption.setProgress(null);
    this.deps.caption.setChips([]);
    // A quiz question hides the part's name; put it back.
    if (was === 'quiz' && this.focusedId) this.deps.panel.setFocus(this.part(this.focusedId)?.label ?? null);
    this.syncModes();
    if (announce && was !== 'free') void this.say(was === 'tour' ? 'Tour ended.' : 'Quiz ended.');
  }

  // --- Speech --------------------------------------------------------------

  private say(text: string): Promise<void> {
    this.lastSpoken = text;
    return this.deps.narrator.say(text);
  }

  private part(id: string): SegmentDef | undefined {
    return this.deps.parts().find((p) => p.id === id);
  }
}

function firstSentence(text: string): string {
  return text.match(/^[^.!?]+[.!?]/)?.[0] ?? text;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
