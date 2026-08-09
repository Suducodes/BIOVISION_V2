import type { CaseResult, Metrics } from './engine';

/**
 * Local progress store.
 *
 * Everything the learner produces stays in their own browser. That is not a
 * shortcut — the zero-footprint claim behind this platform includes "no account,
 * no server, no record of a student's mistakes leaving the machine they made
 * them on", which is what makes it deployable in a teaching lab without an
 * ethics review or an IT procurement cycle.
 */

const STORAGE_KEY = 'surgilearn.progress.v1';
const LEADERBOARD_SIZE = 5;

export interface Attempt {
  caseId: string;
  caseTitle: string;
  player: string;
  score: number;
  timeMs: number;
  correct: boolean;
  classification: string | null;
  metrics: Metrics;
  at: number;
}

export interface BadgeDef {
  id: string;
  name: string;
  glyph: string;
  blurb: string;
  earned: (result: CaseResult, history: Attempt[]) => boolean;
}

export const BADGES: BadgeDef[] = [
  {
    id: 'first-case',
    name: 'FIRST CASE',
    glyph: '✚',
    blurb: 'Completed your first coronary challenge.',
    earned: (_result, history) => history.length === 1,
  },
  {
    id: 'perfect-score',
    name: 'PERFECT SCORE',
    glyph: '◎',
    blurb: 'Finished a case on 100/100 — no time penalty, no misgrade.',
    earned: (result) => result.score >= 100,
  },
  {
    id: 'speed-surgeon',
    name: 'SPEED SURGEON',
    glyph: '⏱',
    blurb: 'Completed a case in under 60 seconds.',
    earned: (result) => result.timeMs < 60_000,
  },
  {
    id: 'anomaly-hunter',
    name: 'ANOMALY HUNTER',
    glyph: '⌖',
    blurb: 'Worked up the anomalous RCA origin in Case 3.',
    earned: (result) => result.caseId === 'coronary-3',
  },
];

export type Competency = 'NOVICE' | 'INTERMEDIATE' | 'PROFICIENT';

interface Persisted {
  player: string;
  attempts: Attempt[];
  badges: string[];
}

const EMPTY: Persisted = { player: '', attempts: [], badges: [] };

export class ProgressStore {
  private data: Persisted;

  constructor() {
    this.data = load();
  }

  get player(): string {
    return this.data.player;
  }

  setPlayer(name: string): void {
    this.data.player = name.trim().slice(0, 24);
    this.save();
  }

  get attempts(): Attempt[] {
    return this.data.attempts;
  }

  get badges(): BadgeDef[] {
    return BADGES.filter((b) => this.data.badges.includes(b.id));
  }

  /**
   * Records a completed case and returns any badges unlocked by it, so the UI
   * can flash them without having to diff the badge list itself.
   */
  record(result: CaseResult): BadgeDef[] {
    const attempt: Attempt = {
      caseId: result.caseId,
      caseTitle: result.caseTitle,
      player: this.data.player || 'GUEST',
      score: result.score,
      timeMs: result.timeMs,
      correct: result.correct,
      classification: result.classification,
      metrics: result.metrics,
      at: result.at,
    };
    this.data.attempts.push(attempt);

    const unlocked = BADGES.filter(
      (badge) => !this.data.badges.includes(badge.id) && badge.earned(result, this.data.attempts),
    );
    for (const badge of unlocked) this.data.badges.push(badge.id);

    this.save();
    return unlocked;
  }

  /** Best attempt per case, which is what competency and the radar are built on. */
  bestPerCase(): Map<string, Attempt> {
    const best = new Map<string, Attempt>();
    for (const attempt of this.data.attempts) {
      const current = best.get(attempt.caseId);
      if (!current || attempt.score > current.score) best.set(attempt.caseId, attempt);
    }
    return best;
  }

  /** Top scores for one case, ties broken by the faster run. */
  leaderboard(caseId: string): Attempt[] {
    return this.data.attempts
      .filter((a) => a.caseId === caseId)
      .sort((a, b) => b.score - a.score || a.timeMs - b.timeMs)
      .slice(0, LEADERBOARD_SIZE);
  }

  /** Mean of the four competency axes across each case's best run. */
  averageMetrics(): Metrics | null {
    const best = [...this.bestPerCase().values()];
    if (best.length === 0) return null;
    const sum = best.reduce<Metrics>(
      (acc, a) => ({
        speed: acc.speed + a.metrics.speed,
        accuracy: acc.accuracy + a.metrics.accuracy,
        identification: acc.identification + a.metrics.identification,
        classification: acc.classification + a.metrics.classification,
      }),
      { speed: 0, accuracy: 0, identification: 0, classification: 0 },
    );
    return {
      speed: sum.speed / best.length,
      accuracy: sum.accuracy / best.length,
      identification: sum.identification / best.length,
      classification: sum.classification / best.length,
    };
  }

  averageScore(): number | null {
    const best = [...this.bestPerCase().values()];
    if (best.length === 0) return null;
    return best.reduce((total, a) => total + a.score, 0) / best.length;
  }

  competency(): Competency {
    const average = this.averageScore();
    if (average === null || average < 60) return 'NOVICE';
    return average < 80 ? 'INTERMEDIATE' : 'PROFICIENT';
  }

  reset(): void {
    this.data = { ...EMPTY, player: this.data.player, attempts: [], badges: [] };
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      /* private mode or quota — progress simply won't persist this session */
    }
  }
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      player: typeof parsed.player === 'string' ? parsed.player : '',
      attempts: Array.isArray(parsed.attempts) ? parsed.attempts : [],
      badges: Array.isArray(parsed.badges) ? parsed.badges : [],
    };
  } catch {
    return { ...EMPTY };
  }
}
