import * as THREE from 'three';
import { HEART_PIECES, type PieceName, type SegmentDef } from '../segments';

// How sharply a vertex commits to its nearest site, in model units (the
// specimen is 2 across). Small enough that the interior of a part is
// unambiguous, large enough that a border is a smooth ramp rather than a
// per-triangle staircase.
const BLEND = 0.035;

// Positions closer than this are the same point: glTF splits vertices along UV
// seams, and those copies must be merged before pieces can be traced.
const WELD = 1e4;

/**
 * Splits the specimen into its named parts and draws them three ways:
 * a selection (one or more parts lit, the rest dimmed, a glowing contour on
 * the border), an atlas (every part in its own colour with white borders), and
 * an x-ray (the shell turns to glass so the schematic interior shows through).
 *
 * The mesh has no parts of its own. Each vertex gets a weight for every part,
 * from its distance to the part's sites — but only parts that claim the
 * vertex's piece of the shell compete for it, so borders snap to the model's
 * real seams (aorta against atrium, say) instead of cutting straight across.
 * Weights are smooth, so interpolating them across a triangle traces a clean
 * border rather than a jagged edge that follows the mesh. (Interpolating a part
 * *index* instead is tempting and wrong: between part 1 and part 5 it passes
 * through 2, 3 and 4, and lights slivers of parts that aren't there.)
 *
 * The weights stay on the CPU. Selecting writes one float per vertex — the
 * summed weight of the chosen parts — so any number of parts can be lit at
 * once, and the previous selection is kept in a second attribute so the glow
 * cross-fades from one part to the next instead of jumping.
 */
export class SegmentHighlighter {
  private readonly indexById = new Map<string, number>();
  private readonly targets: Array<{
    geometry: THREE.BufferGeometry;
    weights: Float32Array; // vertex-major, `count` per vertex
    selA: THREE.BufferAttribute;
    selB: THREE.BufferAttribute;
  }> = [];
  private readonly count: number;

  // Uniform objects are shared by reference with every patched material, so
  // updating `.value` here updates all of them at once.
  private readonly uMix = { value: 0 };
  private readonly uBlend = { value: 1 };
  private readonly uPulse = { value: 1 };
  private readonly uAtlas = { value: 0 };
  private readonly uXray = { value: 0 };
  private mixTarget = 0;
  private atlasTarget = 0;
  private xrayTarget = 0;
  private xrayLive = false;
  private selected: string[] = [];
  private readonly patched: THREE.MeshStandardMaterial[] = [];
  private readonly meshes: THREE.Mesh[] = [];

  constructor(root: THREE.Object3D, pivot: THREE.Object3D, segments: SegmentDef[]) {
    this.count = segments.length;
    segments.forEach((s, i) => this.indexById.set(s.id, i));

    // Sites are in the specimen's own space with the pivot at rest, so measure
    // each vertex relative to the pivot — correct even while the pivot is still
    // easing back from the previous organ's pose.
    pivot.updateMatrixWorld(true);
    root.updateMatrixWorld(true);
    const toPivotSpace = pivot.matrixWorld.clone().invert();

    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const position = child.geometry.getAttribute('position');
      if (!position) return;

      const relative = toPivotSpace.clone().multiply(child.matrixWorld);
      const points = new Float32Array(position.count * 3);
      const v = new THREE.Vector3();
      for (let i = 0; i < position.count; i++) {
        v.fromBufferAttribute(position, i).applyMatrix4(relative);
        points.set([v.x, v.y, v.z], i * 3);
      }

      const piece = tracePieces(child.geometry, points);
      const weights = weigh(points, piece, segments);

      const selA = new THREE.BufferAttribute(new Float32Array(position.count), 1);
      const selB = new THREE.BufferAttribute(new Float32Array(position.count), 1);
      selA.setUsage(THREE.DynamicDrawUsage);
      selB.setUsage(THREE.DynamicDrawUsage);
      child.geometry.setAttribute('aSelA', selA);
      child.geometry.setAttribute('aSelB', selB);
      const { tint, edge } = atlasAttributes(weights, segments);
      child.geometry.setAttribute('aTint', new THREE.BufferAttribute(tint, 3));
      child.geometry.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1));
      this.targets.push({ geometry: child.geometry, weights, selA, selB });
      this.meshes.push(child);

      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) this.patch(material);
    });
  }

  /** Light up one or more parts; null or an empty list restores the specimen. */
  select(ids: string | string[] | null): void {
    const list = (ids === null ? [] : Array.isArray(ids) ? ids : [ids]).filter((id) => this.indexById.has(id));
    const same = list.length === this.selected.length && list.every((id) => this.selected.includes(id));
    this.mixTarget = list.length > 0 ? 1 : 0;
    if (same) return;
    // An empty selection keeps whatever is lit while it fades out; there is
    // nothing new to fade to.
    if (list.length === 0) {
      this.selected = [];
      return;
    }
    const indices = list.map((id) => this.indexById.get(id)!);
    const blend = this.uBlend.value;
    for (const t of this.targets) {
      const a = t.selA.array as Float32Array;
      const b = t.selB.array as Float32Array;
      for (let v = 0; v < a.length; v++) {
        // Start the cross-fade from exactly what is on screen now.
        a[v] = a[v]! + (b[v]! - a[v]!) * blend;
        let sum = 0;
        for (const k of indices) sum += t.weights[v * this.count + k]!;
        b[v] = Math.min(1, sum);
      }
      t.selA.needsUpdate = true;
      t.selB.needsUpdate = true;
    }
    // Lighting from nothing has nothing to cross-fade from.
    if (this.selected.length === 0 && this.uMix.value < 0.05) {
      for (const t of this.targets) {
        (t.selA.array as Float32Array).set(t.selB.array as Float32Array);
        t.selA.needsUpdate = true;
      }
    }
    this.uBlend.value = 0;
    this.selected = list;
  }

  /** Every part in its own colour, borders traced in white. */
  setAtlas(on: boolean): void {
    this.atlasTarget = on ? 1 : 0;
  }

  /** Turns the shell to glass so the interior shows through. */
  setXray(on: boolean): void {
    this.xrayTarget = on ? 1 : 0;
    if (on) this.setTransparent(true);
  }

  /** 0 = solid, 1 = fully see-through; the interior fades in with this. */
  get xray(): number {
    return this.uXray.value;
  }

  get atlas(): number {
    return this.uAtlas.value;
  }

  /** Call once per frame. `time` is seconds since start, for the pulse. */
  update(delta: number, time: number): void {
    const k = Math.min(1, 6 * delta);
    this.uMix.value += (this.mixTarget - this.uMix.value) * k;
    this.uBlend.value += (1 - this.uBlend.value) * Math.min(1, 5 * delta);
    this.uAtlas.value += (this.atlasTarget - this.uAtlas.value) * Math.min(1, 4 * delta);
    this.uXray.value += (this.xrayTarget - this.uXray.value) * Math.min(1, 4 * delta);
    this.uPulse.value = 0.8 + 0.2 * Math.sin(time * 3.2);
    // Once fully faded out nothing should be tinted, dimmed or see-through.
    if (this.mixTarget === 0 && this.uMix.value < 0.002) this.uMix.value = 0;
    if (this.atlasTarget === 0 && this.uAtlas.value < 0.002) this.uAtlas.value = 0;
    if (this.xrayTarget === 0 && this.uXray.value < 0.004) {
      this.uXray.value = 0;
      this.setTransparent(false);
    }
  }

  /**
   * Transparency is a pipeline switch, not just a uniform: the shell must stop
   * writing depth (or its near side hides its far side and the whole interior)
   * and be drawn after the interior. Flipped only at the ends of the fade.
   */
  private setTransparent(on: boolean): void {
    if (this.xrayLive === on) return;
    this.xrayLive = on;
    for (const material of this.patched) {
      material.transparent = on;
      material.depthWrite = !on;
      material.needsUpdate = true;
    }
    for (const mesh of this.meshes) mesh.renderOrder = on ? 10 : 0;
  }

  private patch(material: THREE.Material): void {
    if (!(material instanceof THREE.MeshStandardMaterial)) return;

    material.onBeforeCompile = (shader) => {
      shader.uniforms.uMix = this.uMix;
      shader.uniforms.uBlend = this.uBlend;
      shader.uniforms.uPulse = this.uPulse;
      shader.uniforms.uAtlas = this.uAtlas;
      shader.uniforms.uXray = this.uXray;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute float aSelA; attribute float aSelB; attribute vec3 aTint; attribute float aEdge;
          varying float vSelA; varying float vSelB; varying vec3 vTint; varying float vEdge;`,
        )
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvSelA = aSelA; vSelB = aSelB; vTint = aTint; vEdge = aEdge;',
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uMix; uniform float uBlend; uniform float uPulse; uniform float uAtlas; uniform float uXray;
          varying float vSelA; varying float vSelB; varying vec3 vTint; varying float vEdge;`,
        )
        // Everything acts on the *finished* light. At close range a headlamp's
        // specular shine is as strong as the diffuse term, so dimming only the
        // diffuse colour left the rest of the heart bright.
        //   segW      the selected parts' share of this fragment, 0..1
        //   segInside ramps up across the border so a part keeps full colour
        //   segEdge   peaks where segW crosses one half — the border itself
        .replace(
          '#include <opaque_fragment>',
          `float segW = mix(vSelA, vSelB, uBlend);
          float segInside = smoothstep(0.40, 0.60, segW);
          float segEdge = 1.0 - smoothstep(0.0, 0.16, abs(segW - 0.5));

          // Atlas: keep the tissue's shading, swap its colour for the part's.
          float lum = dot(outgoingLight, vec3(0.299, 0.587, 0.114));
          vec3 atlasCol = mix(outgoingLight, vTint * (0.18 + 1.25 * lum), 0.78);
          atlasCol = mix(atlasCol, vec3(0.95), smoothstep(0.30, 0.75, vEdge) * 0.7);
          outgoingLight = mix(outgoingLight, atlasCol, uAtlas);

          // Selection: dim the rest, then trace the border on top so the
          // contour stays bright against the dimming.
          outgoingLight *= mix(1.0, mix(0.26, 1.0, segInside), uMix);
          outgoingLight += vec3(0.10, 0.85, 1.0) * segEdge * uMix * uPulse * 0.9;

          // X-ray: glass with a fresnel rim. Faces seen edge-on stay visible,
          // faces seen square-on nearly vanish, so the outline of the heart
          // survives while the inside shows through.
          float fres = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.2);
          vec3 glass = outgoingLight * 0.45 + vec3(0.30, 0.62, 1.0) * fres * 0.75
            + vec3(0.10, 0.85, 1.0) * segInside * uMix * 0.35;
          outgoingLight = mix(outgoingLight, glass, uXray);
          diffuseColor.a = mix(diffuseColor.a, clamp(0.04 + 0.7 * fres + 0.3 * segInside * uMix, 0.0, 1.0), uXray);
          #include <opaque_fragment>`,
        );
    };
    // Only patched materials share this program, so give it its own cache key —
    // otherwise three.js could hand it to an unpatched material, or the reverse.
    material.customProgramCacheKey = () => 'bio-vision-segment-highlight-v4';
    material.needsUpdate = true;
    this.patched.push(material);
  }

  dispose(): void {
    this.setTransparent(false);
    for (const material of this.patched) {
      material.onBeforeCompile = () => {};
      material.customProgramCacheKey = () => '';
      material.needsUpdate = true;
    }
    this.patched.length = 0;
  }
}

/**
 * Labels every vertex with the shell piece it belongs to. Pieces are traced
 * through shared *edges*: the model's pieces touch one another at single
 * vertices, so tracing through shared vertices would merge them all into one.
 */
function tracePieces(geometry: THREE.BufferGeometry, points: Float32Array): Int16Array {
  const vertexCount = points.length / 3;
  // Weld seam duplicates into one id per distinct position.
  const weldId = new Int32Array(vertexCount);
  const seen = new Map<string, number>();
  for (let i = 0; i < vertexCount; i++) {
    const key = `${Math.round(points[i * 3]! * WELD)},${Math.round(points[i * 3 + 1]! * WELD)},${Math.round(points[i * 3 + 2]! * WELD)}`;
    let id = seen.get(key);
    if (id === undefined) {
      id = seen.size;
      seen.set(key, id);
    }
    weldId[i] = id;
  }

  const index = geometry.getIndex();
  const faceCount = index ? index.count / 3 : vertexCount / 3;
  const corner = (f: number, c: number) => (index ? index.getX(f * 3 + c) : f * 3 + c);

  const parent = new Int32Array(faceCount).map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  const firstFaceOnEdge = new Map<number, number>();
  const welded = seen.size;
  for (let f = 0; f < faceCount; f++) {
    for (let c = 0; c < 3; c++) {
      const a = weldId[corner(f, c)]!;
      const b = weldId[corner(f, (c + 1) % 3)]!;
      const key = a < b ? a * welded + b : b * welded + a;
      const other = firstFaceOnEdge.get(key);
      if (other === undefined) firstFaceOnEdge.set(key, f);
      else parent[find(f)] = find(other);
    }
  }

  // Name each piece by the reference centroid it sits nearest.
  const sums = new Map<number, { x: number; y: number; z: number; n: number }>();
  for (let f = 0; f < faceCount; f++) {
    const root = find(f);
    let s = sums.get(root);
    if (!s) sums.set(root, (s = { x: 0, y: 0, z: 0, n: 0 }));
    for (let c = 0; c < 3; c++) {
      const v = corner(f, c);
      s.x += points[v * 3]! / 3;
      s.y += points[v * 3 + 1]! / 3;
      s.z += points[v * 3 + 2]! / 3;
    }
    s.n++;
  }
  const names = Object.keys(HEART_PIECES) as PieceName[];
  const pieceOfRoot = new Map<number, number>();
  for (const [root, s] of sums) {
    const cx = s.x / s.n;
    const cy = s.y / s.n;
    const cz = s.z / s.n;
    let best = -1;
    let bestD = 0.12; // further than this from every reference: an unknown piece
    names.forEach((name, i) => {
      const r = HEART_PIECES[name];
      const d = Math.hypot(cx - r[0], cy - r[1], cz - r[2]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    pieceOfRoot.set(root, best);
  }

  const piece = new Int16Array(vertexCount).fill(-1);
  for (let f = 0; f < faceCount; f++) {
    const p = pieceOfRoot.get(find(f))!;
    for (let c = 0; c < 3; c++) piece[corner(f, c)] = p;
  }
  return piece;
}

/** Per-vertex part weights: a softmax over distance to the claiming parts' sites. */
function weigh(points: Float32Array, piece: Int16Array, segments: SegmentDef[]): Float32Array {
  const names = Object.keys(HEART_PIECES) as PieceName[];
  const count = segments.length;
  type Site = { x: number; y: number; z: number; part: number };
  const all: Site[] = [];
  const byPiece: Site[][] = names.map(() => []);
  segments.forEach((s, part) => {
    for (const p of s.sites ?? []) {
      const site = { x: p[0], y: p[1], z: p[2], part };
      all.push(site);
      for (const name of s.pieces ?? []) byPiece[names.indexOf(name)]!.push(site);
    }
  });

  const vertexCount = points.length / 3;
  const weights = new Float32Array(vertexCount * count);
  if (all.length === 0) return weights;
  const distances = new Float32Array(all.length);
  for (let v = 0; v < vertexCount; v++) {
    const p = piece[v]!;
    // A piece no part claims (or one that wasn't recognised) falls back to
    // competing for every site, so nothing is left unassigned.
    const sites = p >= 0 && byPiece[p]!.length > 0 ? byPiece[p]! : all;
    const x = points[v * 3]!;
    const y = points[v * 3 + 1]!;
    const z = points[v * 3 + 2]!;
    let nearest = Infinity;
    for (let s = 0; s < sites.length; s++) {
      const site = sites[s]!;
      const d = Math.hypot(x - site.x, y - site.y, z - site.z);
      distances[s] = d;
      if (d < nearest) nearest = d;
    }
    // Falls off exponentially from the nearest site, so a vertex deep in a
    // part gets ~1 for it and ~0 for the rest, and only vertices near a border
    // split their weight.
    let total = 0;
    const base = v * count;
    for (let s = 0; s < sites.length; s++) {
      const w = Math.exp(-(distances[s]! - nearest) / BLEND);
      const slot = base + sites[s]!.part;
      weights[slot] = weights[slot]! + w;
      total += w;
    }
    for (let k = 0; k < count; k++) weights[base + k] = weights[base + k]! / total;
  }
  return weights;
}

/** Atlas colour (weight-blended) and a border factor per vertex. */
function atlasAttributes(weights: Float32Array, segments: SegmentDef[]): { tint: Float32Array; edge: Float32Array } {
  const count = segments.length;
  const colours = segments.map((s) => new THREE.Color(s.color));
  const vertexCount = weights.length / count;
  const tint = new Float32Array(vertexCount * 3);
  const edge = new Float32Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) {
    let first = 0;
    let second = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let k = 0; k < count; k++) {
      const w = weights[v * count + k]!;
      if (w === 0) continue;
      r += colours[k]!.r * w;
      g += colours[k]!.g * w;
      b += colours[k]!.b * w;
      if (w > first) {
        second = first;
        first = w;
      } else if (w > second) second = w;
    }
    tint.set([r, g, b], v * 3);
    // 0 deep inside a part, approaching 1 where two parts share a vertex.
    edge[v] = 1 - (first - second);
  }
  return { tint, edge };
}
