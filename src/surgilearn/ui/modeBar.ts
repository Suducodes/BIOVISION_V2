import { element } from './panel';

export type Mode = 'EXPLORE' | 'CHALLENGE';

/**
 * Top-right mode switch plus the dashboard button.
 *
 * Injected into the existing `#top-bar` flex row rather than absolutely
 * positioned, so it participates in the same layout that already guarantees the
 * title, organ selector and telemetry can never overlap.
 */
export class ModeBar {
  private readonly buttons = new Map<Mode, HTMLButtonElement>();
  readonly el = element('div', 'sl-modebar');

  constructor(
    host: HTMLElement,
    handlers: { onMode: (mode: Mode) => void; onDashboard: () => void },
  ) {
    const group = element('div', 'sl-modes');
    for (const mode of ['EXPLORE', 'CHALLENGE'] as const) {
      const button = element('button', 'sl-mode');
      button.type = 'button';
      button.textContent = `${mode} MODE`;
      button.setAttribute('aria-pressed', String(mode === 'EXPLORE'));
      button.addEventListener('click', () => handlers.onMode(mode));
      this.buttons.set(mode, button);
      group.append(button);
    }
    this.buttons.get('EXPLORE')!.classList.add('active');

    const dashboard = element('button', 'sl-dash-button', '📊');
    dashboard.type = 'button';
    dashboard.title = 'Progress dashboard';
    dashboard.setAttribute('aria-label', 'Progress dashboard');
    dashboard.addEventListener('click', handlers.onDashboard);

    this.el.append(group, dashboard);
    // Sits between the organ selector and the telemetry readout.
    const hud = host.querySelector('#hud');
    if (hud) host.insertBefore(this.el, hud);
    else host.append(this.el);
  }

  setMode(mode: Mode): void {
    for (const [key, button] of this.buttons) {
      const active = key === mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    this.el.classList.toggle('challenge', mode === 'CHALLENGE');
  }
}
