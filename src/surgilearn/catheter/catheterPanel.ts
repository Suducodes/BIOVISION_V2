import { createPanel, element, formatClock, type Panel } from '../ui/panel';
import type { CatheterResult } from './catheterNav';

/**
 * HUD for catheter navigation: live meters while a run is in progress, a
 * scorecard once it finishes. Standalone from the mission panel, same as the
 * challenge it replaced — it runs on top of whatever coronary case happens to
 * be loaded rather than being a step inside EXPLORE/CHALLENGE mode.
 */
export class CatheterPanel {
  private readonly panel: Panel;
  private readonly brief = element('p', 'trace-intro');
  private readonly live = element('div', 'trace-live');
  private readonly progressValue = element('b');
  private readonly wallValue = element('b');
  private readonly timeValue = element('b', undefined, '00:00');
  private readonly startButton = element('button', 'sl-button primary', 'INSERT GUIDEWIRE');
  private readonly finishButton = element('button', 'sl-button', 'FINISH');
  private readonly scorecard = element('div', 'trace-scorecard sl-hidden');
  private readonly scoreValue = element('div', 'trace-score-value');
  private readonly scoreBars = element('div', 'trace-score-bars');
  private readonly retryButton = element('button', 'sl-button primary', 'RETRY →');

  constructor(
    container: HTMLElement,
    handlers: { onStart: () => void; onFinish: () => void },
  ) {
    this.panel = createPanel({
      id: 'trace-panel',
      title: 'CATHETER NAVIGATION',
      glyph: '🧭',
      className: 'sl-trace',
    });

    this.startButton.type = 'button';
    this.startButton.addEventListener('click', handlers.onStart);
    this.finishButton.type = 'button';
    this.finishButton.addEventListener('click', handlers.onFinish);
    this.finishButton.classList.add('sl-hidden');

    const meters = element('div', 'trace-meters');
    meters.append(
      meterCell('PROGRESS', this.progressValue, '%'),
      meterCell('WALL HITS', this.wallValue, ''),
      meterCell('TIME', this.timeValue, ''),
    );
    this.live.append(meters);

    const actions = element('div', 'trace-actions');
    actions.append(this.startButton, this.finishButton);

    this.scoreBars.append(
      scoreBar('accuracy-bar', 'CENTRED'),
      scoreBar('smoothness-bar', 'SMOOTHNESS'),
      scoreBar('speed-bar', 'SPEED'),
    );
    this.retryButton.type = 'button';
    this.retryButton.addEventListener('click', handlers.onStart);
    this.scorecard.append(
      element('div', 'trace-score-label', 'TECHNICAL SKILL SCORE'),
      this.scoreValue,
      this.scoreBars,
      element(
        'div',
        'trace-score-caption',
        '≈ OSATS-style technical-skill proxy — how centred the wire stayed, how smooth the steering was, and time to cross the lesion',
      ),
      this.retryButton,
    );

    this.panel.body.append(this.brief, this.live, actions, this.scorecard);
    container.append(this.panel.el);
  }

  /** Sets the mission brief text before a run starts — which vessel, what
   *  the target is — so the operator knows what they're about to do. */
  setMission(text: string): void {
    this.brief.textContent = text;
  }

  showLive(): void {
    this.scorecard.classList.add('sl-hidden');
    this.live.classList.remove('sl-hidden');
    this.startButton.classList.add('sl-hidden');
    this.finishButton.classList.remove('sl-hidden');
    this.panel.setCollapsed(false);
  }

  renderLive(progressPct: number, wallContacts: number, timeMs: number): void {
    this.progressValue.textContent = String(Math.round(progressPct));
    this.wallValue.textContent = String(wallContacts);
    this.timeValue.textContent = formatClock(timeMs);
  }

  showResult(result: CatheterResult): void {
    this.live.classList.add('sl-hidden');
    this.finishButton.classList.add('sl-hidden');
    this.startButton.classList.remove('sl-hidden');
    this.startButton.textContent = 'RUN AGAIN →';
    this.scorecard.classList.remove('sl-hidden');

    this.scoreValue.textContent = String(result.score);
    this.scoreValue.className = `trace-score-value ${grade(result.score)}`;
    setBar(this.scoreBars, 'accuracy-bar', result.accuracy);
    setBar(this.scoreBars, 'smoothness-bar', result.smoothness);
    setBar(this.scoreBars, 'speed-bar', result.speed);
  }

  reset(): void {
    this.scorecard.classList.add('sl-hidden');
    this.startButton.classList.remove('sl-hidden');
    this.startButton.textContent = 'INSERT GUIDEWIRE';
    this.finishButton.classList.add('sl-hidden');
    this.live.classList.add('sl-hidden');
  }

  show(): void {
    this.panel.show();
  }

  hide(): void {
    this.panel.hide();
  }

  get visible(): boolean {
    return this.panel.visible;
  }
}

function meterCell(label: string, value: HTMLElement, unit: string): HTMLElement {
  const cell = element('div', 'trace-meter');
  const readout = element('div', 'trace-meter-value');
  readout.append(value, element('em', undefined, unit));
  cell.append(element('span', undefined, label), readout);
  return cell;
}

function scoreBar(cls: string, label: string): HTMLElement {
  const row = element('div', 'trace-score-row');
  const fill = element('i', cls);
  const meter = element('div', 'trace-score-meter');
  meter.append(fill);
  row.append(element('span', undefined, label), meter, element('b', `${cls}-value`, '0'));
  return row;
}

function setBar(root: HTMLElement, cls: string, value: number): void {
  const fill = root.querySelector<HTMLElement>(`.${cls}`);
  const num = root.querySelector<HTMLElement>(`.${cls}-value`);
  if (fill) fill.style.width = `${value}%`;
  if (num) num.textContent = String(value);
}

function grade(score: number): string {
  if (score >= 80) return 'proficient';
  if (score >= 60) return 'intermediate';
  return 'novice';
}
