import { CASES } from '../cases';
import { BADGES, type ProgressStore } from '../store';
import { createPanel, element, formatClock, type Panel } from './panel';

/**
 * Progress dashboard: competency level, a four-axis radar of the learner's best
 * runs, the badge cabinet, and a per-case local leaderboard.
 *
 * Chart.js is pulled from a CDN on first open rather than bundled, so the
 * platform's offline-first payload is unchanged for anyone who never opens the
 * dashboard. If the CDN is unreachable — an offline teaching lab is exactly the
 * environment this platform targets — the radar degrades to a labelled bar
 * read-out carrying the same four numbers.
 */

const CHART_CDN = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js';

const AXES = ['Speed', 'Accuracy', 'Identification', 'Classification'] as const;

interface ChartCtor {
  new (ctx: CanvasRenderingContext2D, config: unknown): { destroy(): void };
}

declare global {
  interface Window {
    Chart?: ChartCtor;
  }
}

export class Dashboard {
  private readonly panel: Panel;
  private readonly competency = element('b', 'dash-competency-value', 'NOVICE');
  private readonly summary = element('div', 'dash-summary');
  private readonly chartWrap = element('div', 'dash-chart');
  private readonly canvas = document.createElement('canvas');
  private readonly fallback = element('div', 'dash-chart-fallback');
  private readonly badgeGrid = element('div', 'dash-badges');
  private readonly boards = element('div', 'dash-boards');
  private readonly nameInput = document.createElement('input');

  private chart: { destroy(): void } | undefined;
  private chartLoad: Promise<boolean> | undefined;

  constructor(container: HTMLElement, private readonly store: ProgressStore) {
    this.panel = createPanel({
      id: 'sl-dashboard',
      title: 'PROGRESS',
      glyph: '📊',
      className: 'sl-dashboard',
    });

    const identity = element('label', 'dash-identity');
    this.nameInput.type = 'text';
    this.nameInput.maxLength = 24;
    this.nameInput.placeholder = 'Enter your name';
    this.nameInput.value = store.player;
    this.nameInput.addEventListener('change', () => store.setPlayer(this.nameInput.value));
    identity.append(element('span', undefined, 'LEARNER'), this.nameInput);

    const competencyRow = element('div', 'dash-competency');
    competencyRow.append(element('span', undefined, 'COMPETENCY'), this.competency);

    this.canvas.width = 320;
    this.canvas.height = 320;
    this.chartWrap.append(this.canvas, this.fallback);

    this.panel.body.append(
      identity,
      competencyRow,
      this.summary,
      element('div', 'dash-section', 'PERFORMANCE PROFILE'),
      this.chartWrap,
      element('div', 'dash-section', 'BADGES'),
      this.badgeGrid,
      element('div', 'dash-section', 'LEADERBOARD'),
      this.boards,
    );

    this.panel.hide();
    container.append(this.panel.el);
  }

  toggle(): void {
    if (this.panel.visible) {
      this.panel.hide();
      return;
    }
    this.refresh();
    this.panel.show();
  }

  hide(): void {
    this.panel.hide();
  }

  get visible(): boolean {
    return this.panel.visible;
  }

  refresh(): void {
    this.nameInput.value = this.store.player;
    this.competency.textContent = this.store.competency();
    this.competency.className = `dash-competency-value ${this.store.competency().toLowerCase()}`;

    const best = this.store.bestPerCase();
    const average = this.store.averageScore();
    this.summary.replaceChildren(
      summaryCell('CASES', `${best.size}/${CASES.length}`),
      summaryCell('ATTEMPTS', String(this.store.attempts.length)),
      summaryCell('AVG BEST', average === null ? '—' : average.toFixed(0)),
    );

    this.renderBadges();
    this.renderBoards();
    void this.renderChart();
  }

  private renderBadges(): void {
    const earned = new Set(this.store.badges.map((b) => b.id));
    this.badgeGrid.replaceChildren(
      ...BADGES.map((badge) => {
        const card = element('div', `dash-badge${earned.has(badge.id) ? ' earned' : ''}`);
        card.title = badge.blurb;
        card.append(
          element('span', 'dash-badge-glyph', badge.glyph),
          element('span', 'dash-badge-name', badge.name),
        );
        return card;
      }),
    );
  }

  private renderBoards(): void {
    this.boards.replaceChildren(
      ...CASES.map((def) => {
        const block = element('div', 'dash-board');
        block.append(element('div', 'dash-board-title', def.label.toUpperCase()));
        const rows = this.store.leaderboard(def.id);
        if (rows.length === 0) {
          block.append(element('div', 'dash-board-empty', 'No attempts yet'));
          return block;
        }
        const list = element('ol', 'dash-board-list');
        for (const attempt of rows) {
          const li = element('li');
          li.append(
            element('span', 'dash-board-name', attempt.player),
            element('b', undefined, String(attempt.score)),
            element('em', undefined, formatClock(attempt.timeMs)),
          );
          list.append(li);
        }
        block.append(list);
        return block;
      }),
    );
  }

  private async renderChart(): Promise<void> {
    const metrics = this.store.averageMetrics();
    const values = metrics
      ? [metrics.speed, metrics.accuracy, metrics.identification, metrics.classification]
      : [0, 0, 0, 0];

    const ready = await this.loadChartJs();
    if (!ready || !window.Chart) {
      this.renderChartFallback(values);
      return;
    }

    this.fallback.replaceChildren();
    this.fallback.classList.add('sl-hidden');
    this.canvas.classList.remove('sl-hidden');

    this.chart?.destroy();
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;

    this.chart = new window.Chart(ctx, {
      type: 'radar',
      data: {
        labels: [...AXES],
        datasets: [
          {
            label: 'Best runs',
            data: values,
            fill: true,
            backgroundColor: 'rgba(52, 227, 255, 0.18)',
            borderColor: '#34e3ff',
            borderWidth: 2,
            pointBackgroundColor: '#34e3ff',
            pointRadius: 3,
          },
        ],
      },
      options: {
        responsive: false,
        animation: { duration: 400 },
        plugins: { legend: { display: false } },
        scales: {
          r: {
            min: 0,
            max: 100,
            ticks: { display: false, stepSize: 25 },
            grid: { color: 'rgba(70, 200, 255, 0.16)' },
            angleLines: { color: 'rgba(70, 200, 255, 0.16)' },
            pointLabels: {
              color: '#6d84a6',
              font: { size: 10, family: "'JetBrains Mono', 'Consolas', monospace" },
            },
          },
        },
      },
    });
  }

  /** Text-mode radar. Same four numbers, no network required. */
  private renderChartFallback(values: number[]): void {
    this.canvas.classList.add('sl-hidden');
    this.fallback.classList.remove('sl-hidden');
    this.fallback.replaceChildren(
      ...AXES.map((axis, index) => {
        const row = element('div', 'dash-bar');
        const fill = element('i');
        fill.style.width = `${Math.round(values[index] ?? 0)}%`;
        const meter = element('div', 'dash-bar-meter');
        meter.append(fill);
        row.append(
          element('span', undefined, axis),
          meter,
          element('b', undefined, String(Math.round(values[index] ?? 0))),
        );
        return row;
      }),
    );
  }

  private loadChartJs(): Promise<boolean> {
    if (window.Chart) return Promise.resolve(true);
    this.chartLoad ??= new Promise<boolean>((resolve) => {
      const script = document.createElement('script');
      script.src = CHART_CDN;
      script.async = true;
      script.addEventListener('load', () => resolve(Boolean(window.Chart)));
      script.addEventListener('error', () => {
        console.info('[surgilearn] Chart.js CDN unreachable — using the text radar.');
        resolve(false);
      });
      document.head.append(script);
    });
    return this.chartLoad;
  }
}

function summaryCell(label: string, value: string): HTMLElement {
  const cell = element('div', 'dash-summary-cell');
  cell.append(element('span', undefined, label), element('b', undefined, value));
  return cell;
}
