import { element } from '../ui/panel';

/**
 * The split-view chrome: the dividing line and pane labels that turn "two
 * cameras rendered into two halves of one canvas" into a legible split
 * screen, plus a progress rail and wall-contact flash over the catheter
 * pane. Deliberately just DOM/CSS laid over the WebGL canvas — the render
 * split itself is a viewport/scissor trick done directly against the
 * renderer (see main.ts), so this only ever needs to draw a 50/50 layout,
 * never react to where the divider actually is.
 */
export class CatheterOverlay {
  private readonly root = element('div', 'cath-split sl-hidden');
  private readonly rail = element('div', 'cath-rail-fill');
  private readonly lesionMark = element('i', 'cath-rail-lesion');
  private readonly wallFlash = element('div', 'cath-wall-flash');

  constructor(container: HTMLElement) {
    const divider = element('div', 'cath-divider');
    const overviewLabel = element('div', 'cath-pane-label cath-pane-left', 'OVERVIEW — YOU ARE HERE');
    const catheterLabel = element('div', 'cath-pane-label cath-pane-right', 'CATHETER VIEW');
    const rail = element('div', 'cath-rail');
    // Marks where the stenosis sits along the run, so the rail shows both how
    // far there is to go *and* where the hard part is.
    this.lesionMark.classList.add('sl-hidden');
    rail.append(this.rail, this.lesionMark);

    this.root.append(divider, overviewLabel, catheterLabel, rail, this.wallFlash);
    container.append(this.root);
  }

  /** @param at 0..1 along the run, or null on a clean vessel */
  setLesionMarker(at: number | null): void {
    this.lesionMark.classList.toggle('sl-hidden', at === null);
    if (at !== null) this.lesionMark.style.left = `${at * 100}%`;
  }

  show(): void {
    this.root.classList.remove('sl-hidden');
  }

  hide(): void {
    this.root.classList.add('sl-hidden');
  }

  update(progressPct: number, wallContact: boolean): void {
    this.rail.style.width = `${progressPct}%`;
    this.wallFlash.classList.toggle('in', wallContact);
  }
}
