import type { GestureMode } from '../gesture/types';

interface ModePresentation {
  chip: string;
  className: string;
  lead: string;
}

const MODE_UI: Record<GestureMode, ModePresentation> = {
  IDLE: {
    chip: 'STANDBY',
    className: 'idle',
    lead: 'Awaiting input. Show one hand to pick up the specimen.',
  },
  GRAB: {
    chip: 'MOVE · ZOOM',
    className: 'grab',
    lead: 'Move your hand to carry the specimen. Pinch to pull out, spread to dive inside.',
  },
  ROTATE: {
    chip: 'ROTATE',
    className: 'rotate',
    lead: 'Second hand detected — specimen anchored. Lead hand spins it in place.',
  },
};

/**
 * Owns the non-telemetry HUD: the specimen-log lead line, the input-mode chip
 * and the gesture-legend highlight. Kept separate from {@link Hud} because this
 * reacts to gesture state, not frame timing.
 */
export class StatusUi {
  private readonly chip = document.getElementById('mode-chip')!;
  private readonly title = document.getElementById('notes-title')!;
  private readonly lead = document.getElementById('notes-lead')!;
  private readonly facts = document.getElementById('notes-facts')!;
  private readonly legend = Array.from(
    document.querySelectorAll<HTMLElement>('.legend-item'),
  );

  private current: GestureMode | null = null;

  constructor() {
    // Specimen log and gesture guide start collapsed so the organ itself is
    // never obstructed; tapping the header reveals each on demand.
    this.wireCollapsible('notes', 'notes-head');
    this.wireCollapsible('legend', 'legend-head');
  }

  private wireCollapsible(panelId: string, headId: string): void {
    const panel = document.getElementById(panelId);
    const head = document.getElementById(headId);
    if (!panel || !head) return;
    head.addEventListener('click', () => {
      const collapsed = panel.classList.toggle('collapsed');
      head.setAttribute('aria-expanded', String(!collapsed));
    });
  }

  setMode(mode: GestureMode): void {
    if (mode === this.current) return;
    this.current = mode;

    const ui = MODE_UI[mode];
    this.chip.textContent = ui.chip;
    this.chip.className = `mode-chip ${ui.className}`;
    this.lead.textContent = ui.lead;

    for (const item of this.legend) {
      item.classList.toggle('active', item.dataset.mode === mode);
    }
  }

  /** Populate the specimen log's fact list (bold label + value pairs). */
  setSpecimen(title: string, facts: Array<[string, string]>): void {
    this.title.textContent = title;
    this.facts.replaceChildren(
      ...facts.map(([label, value]) => {
        const li = document.createElement('li');
        const b = document.createElement('b');
        b.textContent = `${label}: `;
        li.append(b, document.createTextNode(value));
        return li;
      }),
    );
  }
}
