import type * as THREE from 'three';
import type { InteractionController } from '../controller/interactionController';
import type { GestureMapper } from '../gesture/gestureMapper';

/** User-tunable feel/look values. Persisted so a demo keeps its calibration. */
export interface Settings {
  brightness: number;
  move: number;
  rotate: number;
  zoom: number;
  smooth: number;
}

export const DEFAULT_SETTINGS: Settings = {
  brightness: 0.72,
  move: 2.6,
  rotate: 5.5,
  zoom: 1,
  smooth: 0.22,
};

const STORAGE_KEY = 'bio-vision.settings';

// The pinch aperture spans this half-width around its centre at zoom
// sensitivity 1; higher sensitivity narrows the window so less finger travel
// covers the full zoom range.
const APERTURE_CENTRE = 0.165;
const APERTURE_HALF = 0.135;

/**
 * Live calibration panel. Anatomy demos run on unknown cameras, hands and
 * lighting, so rather than hard-code a feel that suits one setup, every
 * sensitivity is exposed as a slider that applies immediately and is saved to
 * localStorage. This also turns "tune the gestures" from a code change into
 * something the presenter can do at the venue.
 */
export class SettingsPanel {
  private settings: Settings;

  private readonly rows: Array<{
    key: keyof Settings;
    input: HTMLInputElement;
    value: HTMLElement;
    format: (v: number) => string;
  }>;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly controller: InteractionController,
    private readonly mapper: GestureMapper,
  ) {
    this.settings = load();

    this.rows = [
      { key: 'brightness', input: input('s-brightness'), value: el('v-brightness'), format: (v) => v.toFixed(2) },
      { key: 'move', input: input('s-move'), value: el('v-move'), format: (v) => v.toFixed(1) },
      { key: 'rotate', input: input('s-rotate'), value: el('v-rotate'), format: (v) => v.toFixed(1) },
      { key: 'zoom', input: input('s-zoom'), value: el('v-zoom'), format: (v) => `${v.toFixed(2)}×` },
      { key: 'smooth', input: input('s-smooth'), value: el('v-smooth'), format: (v) => v.toFixed(2) },
    ];

    for (const row of this.rows) {
      row.input.addEventListener('input', () => {
        this.settings[row.key] = Number(row.input.value);
        this.applyOne(row.key);
        save(this.settings);
      });
    }

    this.wireChrome();
    this.syncInputs();
    this.applyAll();
  }

  private wireChrome(): void {
    const panel = document.getElementById('settings')!;
    document.getElementById('settings-toggle')!.addEventListener('click', () => {
      panel.classList.toggle('hidden');
    });
    document.getElementById('settings-close')!.addEventListener('click', () => {
      panel.classList.add('hidden');
    });
    document.getElementById('settings-reset')!.addEventListener('click', () => {
      this.settings = { ...DEFAULT_SETTINGS };
      this.syncInputs();
      this.applyAll();
      save(this.settings);
    });
  }

  private syncInputs(): void {
    for (const row of this.rows) {
      const v = this.settings[row.key];
      row.input.value = String(v);
      row.value.textContent = row.format(v);
    }
  }

  private applyAll(): void {
    for (const row of this.rows) this.applyOne(row.key);
  }

  private applyOne(key: keyof Settings): void {
    const s = this.settings;
    const row = this.rows.find((r) => r.key === key);
    if (row) row.value.textContent = row.format(s[key]);

    switch (key) {
      case 'brightness':
        this.renderer.toneMappingExposure = s.brightness;
        break;
      case 'move':
        this.mapper.configure({ positionRangeX: s.move, positionRangeY: s.move * 0.77 });
        break;
      case 'rotate':
        this.mapper.configure({ rotateGain: s.rotate });
        break;
      case 'zoom': {
        const half = APERTURE_HALF / s.zoom;
        this.mapper.configure({
          apertureMin: Math.max(0.01, APERTURE_CENTRE - half),
          apertureMax: APERTURE_CENTRE + half,
        });
        break;
      }
      case 'smooth':
        this.controller.setSmoothing(s.smooth);
        break;
    }
  }
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* corrupt or unavailable storage — fall back to defaults */
  }
  return { ...DEFAULT_SETTINGS };
}

function save(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* storage may be unavailable (private mode); tuning just won't persist */
  }
}

function input(id: string): HTMLInputElement {
  const node = document.getElementById(id);
  if (!(node instanceof HTMLInputElement)) throw new Error(`slider #${id} missing`);
  return node;
}

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`settings element #${id} missing`);
  return node;
}
