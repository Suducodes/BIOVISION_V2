import type { OrganDef } from '../organs';

/**
 * Builds the organ selector. Kept as a small imperative builder rather than a
 * static markup block so the anatomical library can grow without touching the
 * HTML — add an entry to ORGANS and a button appears.
 */
export function buildOrganSwitcher(
  organs: OrganDef[],
  activeId: string,
  onSelect: (organ: OrganDef) => void,
): void {
  const container = document.getElementById('organ-switcher');
  if (!container) return;
  container.replaceChildren();

  for (const organ of organs) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'organ-button';
    button.dataset.organ = organ.id;
    if (organ.group) button.dataset.group = organ.group;
    button.setAttribute('aria-pressed', String(organ.id === activeId));
    if (organ.id === activeId) button.classList.add('active');

    const glyph = document.createElement('span');
    glyph.className = 'organ-glyph';
    glyph.textContent = organ.glyph;
    const label = document.createElement('span');
    label.className = 'organ-label';
    label.textContent = organ.label;
    button.append(glyph, label);

    button.addEventListener('click', () => {
      if (button.classList.contains('active')) return;
      for (const b of container.querySelectorAll('.organ-button')) {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      }
      button.classList.add('active');
      button.setAttribute('aria-pressed', 'true');
      onSelect(organ);
    });

    container.append(button);
  }
}

/**
 * Marks a specimen active without a click — needed when something other than
 * the user drives the swap (entering CHALLENGE mode, or advancing to the next
 * case from the debrief).
 */
export function setActiveOrgan(id: string): void {
  const container = document.getElementById('organ-switcher');
  if (!container) return;
  for (const button of container.querySelectorAll<HTMLElement>('.organ-button')) {
    const active = button.dataset.organ === id;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}
