/**
 * Shared chrome for every SurgiLearn panel.
 *
 * Deliberately imperative and framework-free, matching the way the existing
 * organ switcher is built, and reusing the platform's own `.collapsible-head` /
 * `.chevron` markup so a new panel is visually indistinguishable from the
 * specimen log the user already knows.
 */

export interface Panel {
  el: HTMLElement;
  body: HTMLElement;
  head: HTMLButtonElement;
  setCollapsed(collapsed: boolean): void;
  show(): void;
  hide(): void;
  readonly visible: boolean;
}

export interface PanelOptions {
  id: string;
  title: string;
  /** Leading glyph, or omitted for the pulsing status dot. */
  glyph?: string;
  className?: string;
  collapsed?: boolean;
  draggable?: boolean;
}

export function createPanel(options: PanelOptions): Panel {
  const el = document.createElement('section');
  el.id = options.id;
  el.className = `sl-panel ${options.className ?? ''}`.trim();
  if (options.collapsed) el.classList.add('collapsed');

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'collapsible-head sl-head';
  head.setAttribute('aria-expanded', String(!options.collapsed));

  const mark = document.createElement('span');
  if (options.glyph) {
    mark.className = 'sl-glyph';
    mark.textContent = options.glyph;
  } else {
    mark.className = 'dot';
  }

  const heading = document.createElement('h2');
  heading.textContent = options.title;

  const chevron = document.createElement('span');
  chevron.className = 'chevron';
  chevron.textContent = '›';

  head.append(mark, heading, chevron);

  const body = document.createElement('div');
  body.className = 'sl-body';

  el.append(head, body);

  const setCollapsed = (collapsed: boolean) => {
    el.classList.toggle('collapsed', collapsed);
    head.setAttribute('aria-expanded', String(!collapsed));
  };

  head.addEventListener('click', () => setCollapsed(!el.classList.contains('collapsed')));

  if (options.draggable !== false) makeDraggable(el, head);

  return {
    el,
    body,
    head,
    setCollapsed,
    show: () => el.classList.remove('sl-hidden'),
    hide: () => el.classList.add('sl-hidden'),
    get visible() {
      return !el.classList.contains('sl-hidden');
    },
  };
}

/**
 * Drag by the header. Panels float over a 3D viewport whose interesting region
 * moves as the specimen does, so being able to shove a panel out of the way is
 * the difference between a HUD and an obstruction.
 *
 * A drag is only committed once the pointer has actually travelled, so the
 * header keeps working as a collapse toggle.
 */
export function makeDraggable(panel: HTMLElement, handle: HTMLElement): void {
  const DRAG_THRESHOLD = 4;
  let startX = 0;
  let startY = 0;
  let originLeft = 0;
  let originTop = 0;
  let dragging = false;
  let armed = false;

  const onDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const rect = panel.getBoundingClientRect();
    startX = event.clientX;
    startY = event.clientY;
    originLeft = rect.left;
    originTop = rect.top;
    armed = true;
    handle.setPointerCapture(event.pointerId);
  };

  const onMove = (event: PointerEvent) => {
    if (!armed) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

    if (!dragging) {
      dragging = true;
      panel.classList.add('sl-dragging');
      // Switch to explicit positioning so a panel anchored by `right`/`bottom`
      // does not fight the drag.
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.transform = 'none';
    }

    const maxLeft = window.innerWidth - panel.offsetWidth - 8;
    const maxTop = window.innerHeight - 48;
    panel.style.left = `${clamp(originLeft + dx, 8, Math.max(8, maxLeft))}px`;
    panel.style.top = `${clamp(originTop + dy, 8, Math.max(8, maxTop))}px`;
  };

  const onUp = (event: PointerEvent) => {
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    armed = false;
    if (!dragging) return;
    dragging = false;
    panel.classList.remove('sl-dragging');
    // Swallow the click that follows the drag so the panel does not collapse.
    handle.addEventListener('click', stop, { capture: true, once: true });
  };

  const stop = (event: Event) => {
    event.stopPropagation();
    event.preventDefault();
  };

  handle.addEventListener('pointerdown', onDown);
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp);
  handle.addEventListener('pointercancel', onUp);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Small helper for the imperative markup below. */
export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
