import type { CaseResult } from '../engine';
import { DEBRIEF_PLACEHOLDER, requestDebrief, type Debrief } from '../tutor';
import { element, formatClock, makeDraggable } from './panel';

/**
 * Post-case debrief.
 *
 * Score and time sit above a per-task breakdown, and the AI clinical debrief is
 * rendered as a console read-out — the shell is present and legible whether or
 * not a key is configured, because the teaching value of "here is what an
 * examiner would say next" is worth showing even in the unconfigured state.
 */
export class DebriefPanel {
  private readonly el = element('div', 'sl-debrief sl-hidden');
  private readonly card = element('section', 'sl-debrief-card');
  private readonly heading = element('h2');
  private readonly verdict = element('div', 'debrief-verdict');
  private readonly scoreValue = element('b');
  private readonly timeValue = element('b');
  private readonly gradeValue = element('b');
  private readonly breakdown = element('ul', 'debrief-breakdown');
  private readonly console = element('pre', 'debrief-console');
  private readonly consoleNote = element('div', 'debrief-console-note');
  private readonly nextButton = element('button', 'sl-button primary');
  private readonly retryButton = element('button', 'sl-button');

  private caret: number | undefined;

  constructor(
    container: HTMLElement,
    handlers: { onNext: () => void; onRetry: () => void; onClose: () => void },
  ) {
    const head = element('div', 'sl-debrief-head');
    const close = element('button', 'sl-debrief-close', '×');
    close.type = 'button';
    close.addEventListener('click', handlers.onClose);
    head.append(this.heading, close);

    const stats = element('div', 'debrief-stats');
    stats.append(
      statCell('SCORE', this.scoreValue),
      statCell('TIME', this.timeValue),
      statCell('GRADE', this.gradeValue),
    );

    const consoleHead = element('div', 'debrief-console-head');
    consoleHead.append(
      element('span', undefined, 'AI CLINICAL DEBRIEF'),
      this.consoleNote,
    );

    this.nextButton.type = 'button';
    this.nextButton.textContent = 'NEXT CASE →';
    this.nextButton.addEventListener('click', handlers.onNext);
    this.retryButton.type = 'button';
    this.retryButton.textContent = 'RETRY →';
    this.retryButton.addEventListener('click', handlers.onRetry);

    const actions = element('div', 'sl-debrief-actions');
    actions.append(this.retryButton, this.nextButton);

    this.card.append(
      head,
      this.verdict,
      stats,
      element('div', 'debrief-section-label', 'PERFORMANCE BREAKDOWN'),
      this.breakdown,
      consoleHead,
      this.console,
      actions,
    );
    this.el.append(this.card);
    container.append(this.el);
    makeDraggable(this.card, head);
  }

  /** Opens the panel for a finished case and kicks off the tutor request. */
  async present(result: CaseResult): Promise<void> {
    this.heading.textContent = `DEBRIEF · ${result.caseTitle}`;
    this.verdict.textContent = result.correct
      ? 'Case closed — severity graded correctly.'
      : `Case closed — graded ${result.classification ?? '—'}, correct answer ${result.correctAnswer}.`;
    this.verdict.classList.toggle('miss', !result.correct);

    this.scoreValue.textContent = `${result.score}/100`;
    this.timeValue.textContent = formatClock(result.timeMs);
    this.gradeValue.textContent = result.classification ?? '—';

    this.breakdown.replaceChildren(
      ...result.objectives.map((objective) => {
        const li = element('li');
        li.classList.toggle('done', objective.done);
        li.append(
          element('span', 'debrief-mark', objective.done ? '☑' : '☐'),
          element('span', undefined, objective.label),
        );
        return li;
      }),
      metricRow('Time penalty', `−${Math.floor(result.timeMs / 10_000) * 2}`),
      metricRow('Grading penalty', `−${result.wrongClassifications * 10}`),
      metricRow('Off-target identifications', String(result.offTargetIdentifications)),
    );

    this.el.classList.remove('sl-hidden');
    this.setConsole(DEBRIEF_PLACEHOLDER, 'requesting');
    this.consoleNote.textContent = 'CONNECTING…';

    const debrief = await requestDebrief(result);
    this.renderDebrief(debrief, result);
  }

  private renderDebrief(debrief: Debrief, result: CaseResult): void {
    switch (debrief.status) {
      case 'ok':
        this.consoleNote.textContent = 'CLAUDE · LIVE';
        this.consoleNote.className = 'debrief-console-note ok';
        this.typeOut(debrief.text);
        break;
      case 'unconfigured':
        this.consoleNote.textContent = 'NO API KEY';
        this.consoleNote.className = 'debrief-console-note idle';
        this.setConsole(
          `${DEBRIEF_PLACEHOLDER}\n\n` +
            `Add your key to config.js to enable the live tutor.\n\n` +
            `[ OFFLINE REFERENCE ]\n${result.teaching}`,
        );
        break;
      case 'error':
        this.consoleNote.textContent = 'REQUEST FAILED';
        this.consoleNote.className = 'debrief-console-note error';
        this.setConsole(
          `${DEBRIEF_PLACEHOLDER}\n\n${debrief.detail ?? 'Unknown error.'}\n\n` +
            `[ OFFLINE REFERENCE ]\n${result.teaching}`,
        );
        break;
    }
  }

  /** Types the debrief in rather than dumping it, matching the console framing. */
  private typeOut(text: string): void {
    window.clearInterval(this.caret);
    this.console.textContent = '';
    this.console.classList.add('typing');
    let index = 0;
    const step = Math.max(2, Math.round(text.length / 240));
    this.caret = window.setInterval(() => {
      index = Math.min(text.length, index + step);
      this.console.textContent = text.slice(0, index);
      this.console.scrollTop = this.console.scrollHeight;
      if (index >= text.length) {
        window.clearInterval(this.caret);
        this.console.classList.remove('typing');
      }
    }, 16);
  }

  private setConsole(text: string, state?: string): void {
    window.clearInterval(this.caret);
    this.console.classList.toggle('typing', state === 'requesting');
    this.console.textContent = text;
  }

  /** Case 3 is the last case, so the button becomes a restart. */
  setNextLabel(label: string): void {
    this.nextButton.textContent = label;
  }

  hide(): void {
    window.clearInterval(this.caret);
    this.el.classList.add('sl-hidden');
  }

  get visible(): boolean {
    return !this.el.classList.contains('sl-hidden');
  }
}

function statCell(label: string, value: HTMLElement): HTMLElement {
  const cell = element('div', 'debrief-stat');
  cell.append(element('span', undefined, label), value);
  return cell;
}

function metricRow(label: string, value: string): HTMLLIElement {
  const li = element('li', 'debrief-metric');
  li.append(element('span', undefined, label), element('b', undefined, value));
  return li;
}
