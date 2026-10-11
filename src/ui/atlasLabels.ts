import * as THREE from 'three';
import type { SegmentDef } from '../segments';

/**
 * Floating name tags pinned to each part, for the atlas view.
 *
 * Each tag follows its part's anchor across the screen and hides when the part
 * turns away from the viewer (its view direction, rotated with the specimen,
 * points away from the camera). Inside parts only appear with the shell
 * see-through. Overlapping tags are thinned nearest-first, so the screen never
 * fills with a pile of text. Tapping a tag flies to that part.
 */
export class AtlasLabels {
  private readonly layer = document.getElementById('atlas-labels')!;
  private tags: Array<{ part: SegmentDef; el: HTMLButtonElement; anchor: THREE.Vector3; view: THREE.Vector3; w: number; h: number }> = [];
  private amount = 0;
  private target = 0;
  private readonly v = new THREE.Vector3();
  private readonly n = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly centre = new THREE.Vector3();

  constructor(private readonly onPick: (id: string) => void) {}

  setParts(parts: SegmentDef[]): void {
    this.layer.replaceChildren();
    this.tags = parts.map((part) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `atlas-tag ${part.group === 'inside' ? 'inside' : ''}`;
      el.style.setProperty('--tag', part.color);
      el.textContent = part.label;
      el.addEventListener('click', () => this.onPick(part.id));
      this.layer.append(el);
      return { part, el, anchor: new THREE.Vector3(...part.anchor), view: new THREE.Vector3(...part.view), w: 0, h: 0 };
    });
  }

  setVisible(on: boolean): void {
    this.target = on ? 1 : 0;
  }

  update(delta: number, camera: THREE.Camera, pivot: THREE.Object3D, xray: number, focusedId: string | null): void {
    this.amount += (this.target - this.amount) * Math.min(1, 5 * delta);
    const shown = this.amount > 0.02;
    this.layer.style.opacity = String(this.amount);
    this.layer.classList.toggle('hidden', !shown);
    if (!shown) return;

    const width = this.layer.clientWidth;
    const height = this.layer.clientHeight;
    pivot.getWorldQuaternion(this.q);
    pivot.getWorldPosition(this.centre);
    const placed: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
    const candidates = this.tags
      .map((tag) => {
        const inside = tag.part.group === 'inside';
        this.v.copy(tag.anchor);
        pivot.localToWorld(this.v);
        const depth = this.v.distanceTo(camera.position);
        // On the near half of the specimen, and not looking straight away:
        // the stored view direction was picked from one angle, so it is only
        // a loose guide to which way the surface faces.
        const nearSide = this.v.z > this.centre.z - 0.12;
        this.v.project(camera);
        this.n.copy(tag.view).applyQuaternion(this.q);
        // Inside parts are seen through the glass from any side.
        const facing = inside ? xray > 0.5 : (nearSide && this.n.z > -0.35) || xray > 0.5;
        const onScreen = this.v.z < 1 && Math.abs(this.v.x) < 1.05 && Math.abs(this.v.y) < 1.05;
        return { tag, depth, x: (this.v.x * 0.5 + 0.5) * width, y: (-this.v.y * 0.5 + 0.5) * height, ok: facing && onScreen };
      })
      .sort((a, b) => Number(b.tag.part.id === focusedId) - Number(a.tag.part.id === focusedId) || a.depth - b.depth);

    for (const c of candidates) {
      const el = c.tag.el;
      if (!c.ok) {
        el.classList.add('off');
        continue;
      }
      // Tag sizes never change, so measure once rather than force a layout
      // for every tag on every frame.
      if (c.tag.w === 0) {
        c.tag.w = el.offsetWidth;
        c.tag.h = el.offsetHeight;
      }
      const w = c.tag.w || 90;
      const h = c.tag.h || 20;
      const box = { x0: c.x - w / 2 - 4, y0: c.y - h - 10, x1: c.x + w / 2 + 4, y1: c.y + 2 };
      const clash = placed.some((p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0);
      el.classList.toggle('off', clash);
      el.classList.toggle('focused', c.tag.part.id === focusedId);
      if (clash) continue;
      placed.push(box);
      el.style.transform = `translate(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px) translate(-50%, -100%)`;
    }
  }
}
