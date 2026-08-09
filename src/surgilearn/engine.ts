import type { CoronaryCase, Objective, RegionId, Severity } from './cases';
import type { HoverSample } from './hoverProbe';

/**
 * Scoring rules. Deliberately blunt and visible: the student can see exactly
 * what each second and each wrong grade costs, which is what makes the score a
 * teaching signal rather than a black box.
 */
export const SCORING = {
  start: 100,
  /** Points lost per completed 10 s. */
  timePenalty: 2,
  timeStepMs: 10_000,
  /** Points lost per incorrect severity grade. */
  wrongClassification: 10,
  /** Seconds under which the run counts as fully fast for the radar chart. */
  parSeconds: 45,
} as const;

export interface ObjectiveState {
  id: string;
  kind: Objective['kind'];
  label: string;
  done: boolean;
  /** 0..1 progress, for objectives that accumulate (view hold, hover dwell). */
  progress: number;
}

export interface Metrics {
  speed: number;
  accuracy: number;
  identification: number;
  classification: number;
}

export interface CaseResult {
  caseId: string;
  caseTitle: string;
  brief: string;
  teaching: string;
  score: number;
  timeMs: number;
  classification: Severity | null;
  correctAnswer: Severity;
  correct: boolean;
  wrongClassifications: number;
  offTargetIdentifications: number;
  objectives: Array<{ label: string; done: boolean }>;
  metrics: Metrics;
  at: number;
}

export interface EngineSnapshot {
  caseId: string;
  title: string;
  brief: string;
  objectives: ObjectiveState[];
  elapsedMs: number;
  score: number;
  classification: Severity | null;
  wrongClassifications: number;
  complete: boolean;
  /** Live orientation error against the current view objective, in degrees. */
  viewErrorDeg: number | null;
  /** Region under the cursor right now, for the label popup. */
  hovered: RegionId | null;
  hoverProgress: number;
}

export interface EngineContext {
  /** Live specimen yaw/pitch in radians. */
  yaw: number;
  pitch: number;
  hover: HoverSample;
}

export interface EngineEvents {
  onObjective?: (objective: ObjectiveState) => void;
  /** Fired when a dwell lands on a region the mission did not ask for. */
  onOffTarget?: (region: RegionId) => void;
  onComplete?: (result: CaseResult) => void;
}

/**
 * The challenge state machine.
 *
 * Runs only while CHALLENGE mode is active; explore mode never constructs one,
 * so there is no scoring state to leak between the two modes.
 */
export class ChallengeEngine {
  private def: CoronaryCase;
  private states: ObjectiveState[];
  private holdMs = new Map<string, number>();

  private elapsedMs = 0;
  private classification: Severity | null = null;
  private wrong = 0;
  private offTarget = 0;
  private finished = false;
  private viewErrorDeg: number | null = null;

  constructor(def: CoronaryCase, private readonly events: EngineEvents = {}) {
    this.def = def;
    this.states = def.objectives.map((objective) => ({
      id: objective.id,
      kind: objective.kind,
      label: objective.label,
      done: false,
      progress: 0,
    }));
  }

  get caseDef(): CoronaryCase {
    return this.def;
  }

  get complete(): boolean {
    return this.finished;
  }

  get score(): number {
    const timeLost =
      Math.floor(this.elapsedMs / SCORING.timeStepMs) * SCORING.timePenalty;
    const gradeLost = this.wrong * SCORING.wrongClassification;
    return clamp(SCORING.start - timeLost - gradeLost, 0, 100);
  }

  /** @param deltaMs milliseconds since the previous frame */
  update(deltaMs: number, ctx: EngineContext): EngineSnapshot {
    if (!this.finished) {
      this.elapsedMs += deltaMs;
      this.tickView(deltaMs, ctx);
      this.tickHover(ctx);
      this.checkCompletion();
    }
    return this.snapshot(ctx);
  }

  /** Answer the severity objective. Wrong answers cost points but stay open. */
  classify(answer: Severity): boolean {
    if (this.finished) return false;
    const state = this.states.find((s) => s.kind === 'classify');
    if (!state || state.done) return false;

    this.classification = answer;
    if (answer === this.def.answer) {
      state.done = true;
      state.progress = 1;
      this.events.onObjective?.(state);
      this.checkCompletion();
      return true;
    }

    this.wrong++;
    return false;
  }

  private tickView(deltaMs: number, ctx: EngineContext): void {
    this.viewErrorDeg = null;
    for (const objective of this.def.objectives) {
      if (objective.kind !== 'view') continue;
      const state = this.byId(objective.id);
      if (!state) continue;

      const yawErr = angleDelta(rad2deg(ctx.yaw), objective.yawDeg);
      const pitchErr = angleDelta(rad2deg(ctx.pitch), objective.pitchDeg);
      const error = Math.hypot(yawErr, pitchErr);
      if (!state.done) this.viewErrorDeg = error;

      if (state.done) continue;

      if (error <= objective.toleranceDeg) {
        const held = (this.holdMs.get(objective.id) ?? 0) + deltaMs;
        this.holdMs.set(objective.id, held);
        state.progress = Math.min(1, held / objective.holdMs);
        if (held >= objective.holdMs) {
          state.done = true;
          state.progress = 1;
          this.events.onObjective?.(state);
        }
      } else {
        this.holdMs.set(objective.id, 0);
        state.progress = 0;
      }
    }
  }

  private tickHover(ctx: EngineContext): void {
    for (const objective of this.def.objectives) {
      if (objective.kind !== 'identify') continue;
      const state = this.byId(objective.id);
      if (!state || state.done) continue;
      state.progress = ctx.hover.region === objective.region ? ctx.hover.progress : 0;
    }

    const confirmed = ctx.hover.confirmed;
    if (!confirmed) return;

    const pending = this.def.objectives.find(
      (o): o is Extract<Objective, { kind: 'identify' }> =>
        o.kind === 'identify' && o.region === confirmed && !this.byId(o.id)?.done,
    );
    if (pending) {
      const state = this.byId(pending.id)!;
      state.done = true;
      state.progress = 1;
      this.events.onObjective?.(state);
      return;
    }

    // Already-completed regions are free to revisit; anything the mission never
    // asked about is a misidentification and costs accuracy on the radar.
    const wasAsked = this.def.objectives.some(
      (o) => o.kind === 'identify' && o.region === confirmed,
    );
    if (!wasAsked) {
      this.offTarget++;
      this.events.onOffTarget?.(confirmed);
    }
  }

  private checkCompletion(): void {
    if (this.finished || !this.states.every((s) => s.done)) return;
    this.finished = true;
    this.events.onComplete?.(this.result());
  }

  private result(): CaseResult {
    const seconds = this.elapsedMs / 1000;
    const score = this.score;
    return {
      caseId: this.def.id,
      caseTitle: this.def.title,
      brief: this.def.brief,
      teaching: this.def.teaching,
      score,
      timeMs: Math.round(this.elapsedMs),
      classification: this.classification,
      correctAnswer: this.def.answer,
      correct: this.classification === this.def.answer,
      wrongClassifications: this.wrong,
      offTargetIdentifications: this.offTarget,
      objectives: this.states.map((s) => ({ label: s.label, done: s.done })),
      metrics: {
        speed: clamp(100 - Math.max(0, seconds - SCORING.parSeconds) * 1.5, 0, 100),
        accuracy: score,
        identification: clamp(100 - this.offTarget * 12, 0, 100),
        classification: clamp(100 - this.wrong * 25, 0, 100),
      },
      at: Date.now(),
    };
  }

  private snapshot(ctx: EngineContext): EngineSnapshot {
    return {
      caseId: this.def.id,
      title: this.def.title,
      brief: this.def.brief,
      objectives: this.states.map((s) => ({ ...s })),
      elapsedMs: this.elapsedMs,
      score: this.score,
      classification: this.classification,
      wrongClassifications: this.wrong,
      complete: this.finished,
      viewErrorDeg: this.viewErrorDeg,
      hovered: ctx.hover.region,
      hoverProgress: ctx.hover.progress,
    };
  }

  private byId(id: string): ObjectiveState | undefined {
    return this.states.find((s) => s.id === id);
  }
}

function rad2deg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Shortest signed difference between two angles in degrees. */
function angleDelta(a: number, b: number): number {
  let d = ((a - b) % 360 + 540) % 360 - 180;
  if (Object.is(d, -180)) d = 180;
  return d;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
