import { SEVERITIES, type CoronaryCase, type Severity } from '../cases';
import type { EngineSnapshot, ObjectiveState } from '../engine';
import { createPanel, element, formatClock, type Panel } from './panel';

/**
 * The mission panel: the case vignette, the objective checklist, the live
 * orientation gauge, the severity grading control, and the timer/score readout.
 *
 * Objectives that accumulate — holding an angiographic view, resting on a
 * vessel — draw a fill bar behind the row, so the student can see that they are
 * making progress rather than guessing whether the system noticed them.
 */
export class MissionPanel {
  private readonly panel: Panel;
  private readonly caseLine = element('div', 'mission-case');
  private readonly brief = element('p', 'mission-brief');
  private readonly list = element('ul', 'mission-tasks');
  private readonly orientation = element('div', 'mission-orientation');
  private readonly orientationValue = element('b', 'mission-orientation-value');
  private readonly classify = element('div', 'mission-classify');
  private readonly clock = element('b', 'mission-clock', '00:00');
  private readonly scoreValue = element('b', 'mission-score-value', '100');
  private readonly penalty = element('div', 'mission-penalty');
  private readonly notice = element('div', 'mission-notice sl-hidden');
  private readonly noticeText = element('span');
  private readonly noticeAction = element('button', 'mission-notice-action');

  private rows = new Map<string, { li: HTMLLIElement; fill: HTMLElement; box: HTMLElement }>();
  private buttons = new Map<Severity, HTMLButtonElement>();
  private locked = false;

  constructor(container: HTMLElement, private readonly onClassify: (answer: Severity) => void) {
    this.panel = createPanel({
      id: 'sl-mission',
      title: 'MISSION',
      className: 'sl-mission',
    });

    const orientationLabel = element('span', undefined, 'ORIENTATION');
    this.orientation.append(orientationLabel, this.orientationValue);

    const grade = element('div', 'mission-grade-label', 'CLASSIFY SEVERITY');
    for (const severity of SEVERITIES) {
      const button = element('button', 'mission-grade');
      button.type = 'button';
      button.textContent = severity;
      button.addEventListener('click', () => {
        if (this.locked || button.disabled) return;
        this.onClassify(severity);
      });
      this.buttons.set(severity, button);
      this.classify.append(button);
    }

    const stats = element('div', 'mission-stats');
    const timeCell = element('div', 'mission-stat');
    timeCell.append(element('span', undefined, 'TIME'), this.clock);
    const scoreCell = element('div', 'mission-stat');
    scoreCell.append(element('span', undefined, 'SCORE'), this.scoreValue);
    stats.append(timeCell, scoreCell);

    this.noticeAction.type = 'button';
    this.notice.append(this.noticeText, this.noticeAction);

    this.panel.body.append(
      this.caseLine,
      this.brief,
      this.notice,
      this.list,
      this.orientation,
      grade,
      this.classify,
      stats,
      this.penalty,
    );

    this.panel.hide();
    container.append(this.panel.el);
  }

  /** Rebuilds the checklist for a new case. */
  mount(def: CoronaryCase): void {
    this.locked = false;
    this.caseLine.textContent = def.title;
    this.brief.textContent = def.brief;
    this.penalty.textContent = '';
    this.list.replaceChildren();
    this.rows.clear();

    for (const objective of def.objectives) {
      const li = element('li', 'mission-task');
      const fill = element('i', 'mission-task-fill');
      const box = element('span', 'mission-task-box', '□');
      const label = element('span', 'mission-task-label', objective.label);
      li.append(fill, box, label);
      this.list.append(li);
      this.rows.set(objective.id, { li, fill, box });
    }

    for (const button of this.buttons.values()) {
      button.disabled = false;
      button.classList.remove('correct', 'wrong');
    }

    this.orientation.classList.toggle(
      'sl-hidden',
      !def.objectives.some((o) => o.kind === 'view'),
    );
    this.panel.setCollapsed(false);
  }

  render(snapshot: EngineSnapshot): void {
    this.clock.textContent = formatClock(snapshot.elapsedMs);
    this.scoreValue.textContent = String(snapshot.score);
    this.scoreValue.classList.toggle('low', snapshot.score < 70);

    for (const objective of snapshot.objectives) {
      this.renderRow(objective);
    }

    if (snapshot.viewErrorDeg === null) {
      this.orientationValue.textContent = 'ON TARGET';
      this.orientation.classList.remove('off');
    } else {
      const deg = Math.round(snapshot.viewErrorDeg);
      this.orientationValue.textContent = `${deg}° OFF`;
      this.orientation.classList.toggle('off', deg > 20);
    }

    if (snapshot.wrongClassifications > 0) {
      this.penalty.textContent = `−${snapshot.wrongClassifications * 10} for ${
        snapshot.wrongClassifications
      } incorrect grade${snapshot.wrongClassifications > 1 ? 's' : ''}`;
    }

    if (snapshot.complete) this.lock();
  }

  /**
   * Surfaces a caveat about the specimen itself — currently only used when a
   * patient scan's vessels have not been labelled, so the student knows the
   * hover targets are reference anatomy rather than their case.
   */
  setNotice(message: string | null, action?: { label: string; run: () => void }): void {
    this.notice.classList.toggle('sl-hidden', message === null);
    if (message === null) return;
    this.noticeText.textContent = message;
    this.noticeAction.classList.toggle('sl-hidden', !action);
    if (action) {
      this.noticeAction.textContent = action.label;
      this.noticeAction.onclick = action.run;
    }
  }

  /** Flags an incorrect grade without closing the objective. */
  markWrong(answer: Severity): void {
    const button = this.buttons.get(answer);
    if (!button) return;
    button.classList.add('wrong');
    button.disabled = true;
  }

  markCorrect(answer: Severity): void {
    this.buttons.get(answer)?.classList.add('correct');
    this.lock();
  }

  private lock(): void {
    this.locked = true;
    for (const button of this.buttons.values()) button.disabled = true;
  }

  private renderRow(objective: ObjectiveState): void {
    const row = this.rows.get(objective.id);
    if (!row) return;
    row.li.classList.toggle('done', objective.done);
    row.box.textContent = objective.done ? '☑' : '□';
    row.fill.style.width = `${(objective.done ? 1 : objective.progress) * 100}%`;
    row.li.classList.toggle('active', !objective.done && objective.progress > 0);
  }

  show(): void {
    this.panel.show();
  }

  hide(): void {
    this.panel.hide();
  }
}
