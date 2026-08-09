import * as THREE from 'three';
import { REGION_INFO, caseRegions, type CoronaryCase, type RegionId } from '../cases';
import { clearAnchors, loadAnchors, saveAnchor, toSource, DEFAULT_ANCHOR_RADIUS } from '../anchors';
import { createPanel, element, type Panel } from './panel';

/**
 * Region picker — labels the vessels on a patient-derived specimen.
 *
 * A coronary segmentation names nothing, so somebody who can read the anatomy
 * has to say which vessel is which exactly once per case. This is that step:
 * arm a region, click it on the model, done. Anchors persist to localStorage
 * immediately so the case is playable on the next run, and the panel emits a
 * snippet to paste into `cases.ts` to make it permanent for everyone.
 */
export class AnchorPicker {
  private readonly panel: Panel;
  private readonly rows = new Map<RegionId, { button: HTMLButtonElement; value: HTMLElement }>();
  private readonly status = element('div', 'anchor-status');
  private readonly source = element('pre', 'anchor-source');

  private def: CoronaryCase | undefined;
  private arming: RegionId | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();

  constructor(
    container: HTMLElement,
    private readonly camera: THREE.Camera,
    /** The loaded specimen — what the click is raycast against. */
    private readonly subject: () => THREE.Object3D | undefined,
    /**
     * The frame anchors are stored in: the pivot every specimen is parented to,
     * whose local space is the normalised one (longest axis = 2 units). Storing
     * against the specimen's own mesh would record raw scanner millimetres and
     * bake in that model's arbitrary scale.
     */
    private readonly frame: THREE.Object3D,
    private readonly onChanged: () => void,
  ) {
    this.panel = createPanel({
      id: 'sl-anchors',
      title: 'REGION PICKER',
      glyph: '📍',
      className: 'sl-anchors',
    });

    this.panel.body.append(
      element(
        'p',
        'anchor-intro',
        'This scan does not name its vessels. Pick a region, then click it on the model.',
      ),
      this.status,
    );

    const copy = element('button', 'sl-button', 'COPY FOR cases.ts');
    copy.type = 'button';
    copy.addEventListener('click', () => void this.copySource());

    const reset = element('button', 'sl-button', 'CLEAR');
    reset.type = 'button';
    reset.addEventListener('click', () => {
      if (!this.def) return;
      clearAnchors(this.def.id);
      this.refresh();
      this.onChanged();
    });

    const actions = element('div', 'anchor-actions');
    actions.append(reset, copy);
    this.panel.body.append(this.source, actions);

    this.panel.hide();
    container.append(this.panel.el);
  }

  mount(def: CoronaryCase): void {
    this.def = def;
    this.arming = null;

    for (const [, row] of this.rows) row.button.remove();
    this.rows.clear();

    const list = element('div', 'anchor-rows');
    for (const id of caseRegions(def)) {
      const button = element('button', 'anchor-row');
      button.type = 'button';
      const label = element('b', undefined, id);
      const value = element('span', 'anchor-value', 'not set');
      button.append(label, value, element('span', 'anchor-set', 'SET'));
      button.title = REGION_INFO[id].name;
      button.addEventListener('click', () => this.arm(id));
      this.rows.set(id, { button, value });
      list.append(button);
    }
    this.status.replaceChildren(list);
    this.refresh();
  }

  private arm(id: RegionId): void {
    this.arming = this.arming === id ? null : id;
    for (const [region, row] of this.rows) {
      row.button.classList.toggle('arming', region === this.arming);
    }
    this.panel.el.classList.toggle('armed', this.arming !== null);
  }

  get isArmed(): boolean {
    return this.arming !== null && this.panel.visible;
  }

  /**
   * Records a click on the specimen. Returns true when the click was consumed
   * as an anchor placement, so the caller can suppress its own handling.
   */
  handleClick(ndcX: number, ndcY: number): boolean {
    const region = this.arming;
    const subject = this.subject();
    if (!region || !subject || !this.def) return false;

    this.ndc.set(ndcX, ndcY);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hits = this.raycaster.intersectObject(subject, true).filter(
      // Ignore the challenge layer's own helper geometry.
      (hit) => !(hit.object.userData.surgilearnRegion as RegionId | undefined),
    );
    const hit = hits[0];
    if (!hit) {
      this.flash('No vessel under that point — click directly on the mesh.');
      return true;
    }

    const local = this.frame.worldToLocal(hit.point.clone());
    saveAnchor(this.def.id, region, {
      at: [+local.x.toFixed(3), +local.y.toFixed(3), +local.z.toFixed(3)],
      radius: DEFAULT_ANCHOR_RADIUS,
    });
    this.arm(region); // disarm
    this.refresh();
    this.onChanged();
    return true;
  }

  private refresh(): void {
    if (!this.def) return;
    const anchors = { ...this.def.regionAnchors, ...loadAnchors(this.def.id) };
    for (const [id, row] of this.rows) {
      const anchor = anchors[id];
      row.value.textContent = anchor
        ? anchor.at.map((v) => v.toFixed(2)).join(', ')
        : 'not set';
      row.button.classList.toggle('placed', Boolean(anchor));
    }
    this.source.textContent = Object.keys(anchors).length
      ? toSource(this.def.id, anchors)
      : '// place at least one region';
  }

  private async copySource(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.source.textContent ?? '');
      this.flash('Copied — paste into the case in src/surgilearn/cases.ts');
    } catch {
      this.flash('Clipboard blocked — select the snippet and copy manually.');
    }
  }

  private flash(message: string): void {
    const note = element('div', 'anchor-flash', message);
    this.panel.body.append(note);
    window.setTimeout(() => note.remove(), 3200);
  }

  toggle(): void {
    if (this.panel.visible) this.panel.hide();
    else {
      this.refresh();
      this.panel.show();
      this.panel.setCollapsed(false);
    }
  }

  show(): void {
    this.refresh();
    this.panel.show();
    this.panel.setCollapsed(false);
  }

  hide(): void {
    this.panel.hide();
    this.arming = null;
  }
}
