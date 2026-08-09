import * as THREE from 'three';
import { REGION_INFO, caseRegions, type CoronaryCase, type RegionId } from './cases';
import { buildRegionProxies } from './coronaryModel';
import { DEFAULT_ANCHOR_RADIUS, loadAnchors, type AnchorSet } from './anchors';

/**
 * Binds anatomical regions to meshes so the challenge layer can raycast, glow
 * and score them.
 *
 * Three sources, in priority order:
 *  1. The procedural tree, which names its meshes after the arteries outright.
 *  2. A supplied GLB whose mesh names match the usual radiological shorthand.
 *  3. Invisible proxy tubes generated for whatever the GLB did not name.
 *
 * Highlight state is applied to a *clone* of each material so lighting one
 * vessel never bleeds into another, and so exiting challenge mode restores the
 * specimen exactly as explore mode left it.
 */

/** How a region is currently being drawn. */
export type HighlightState = 'none' | 'dwell' | 'found' | 'lesion';

const NAME_PATTERNS: Record<RegionId, RegExp> = {
  LAD: /\b(lad|left[\s_-]*anterior[\s_-]*descending|ant[\s_-]*interventricular)\b/i,
  LCX: /\b(lcx|lc?x|circumflex|left[\s_-]*circumflex)\b/i,
  RCA: /\b(rca|right[\s_-]*coronary)\b/i,
  STENOSIS: /(stenos|plaque|lesion|narrow)/i,
};

interface MaterialSnapshot {
  material: THREE.MeshStandardMaterial;
  emissive: number;
  emissiveIntensity: number;
  opacity: number;
  transparent: boolean;
}

const CYAN = new THREE.Color(0x34e3ff);
const AMBER = new THREE.Color(0xffb44a);
const LESION = new THREE.Color(0xff5a1f);

export class Region {
  readonly id: RegionId;
  /** Meshes that are drawn and highlighted. */
  readonly meshes: THREE.Mesh[];
  /** Meshes the hover raycast actually tests — coarse where one is available. */
  readonly colliders: THREE.Mesh[];
  /** True when this region only exists as an invisible hover proxy. */
  readonly isProxy: boolean;

  private readonly snapshots: MaterialSnapshot[] = [];
  private state: HighlightState = 'none';
  private pulse = 0;

  constructor(id: RegionId, meshes: THREE.Mesh[], colliders: THREE.Mesh[], isProxy: boolean) {
    this.id = id;
    this.meshes = meshes;
    // Falling back to the display meshes keeps a GLB that names its own vessels
    // working; it just pays full triangle cost on the raycast.
    this.colliders = colliders.length > 0 ? colliders : meshes;
    this.isProxy = isProxy;

    for (const mesh of meshes) {
      // Cloning decouples this region's appearance from every other mesh that
      // happened to share the source material.
      const source = Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material;
      const cloned = source.clone() as THREE.Material;
      mesh.material = cloned;
      if (cloned instanceof THREE.MeshStandardMaterial) {
        this.snapshots.push({
          material: cloned,
          emissive: cloned.emissive.getHex(),
          emissiveIntensity: cloned.emissiveIntensity,
          opacity: cloned.opacity,
          transparent: cloned.transparent,
        });
      }
    }
  }

  get info() {
    return REGION_INFO[this.id];
  }

  setState(state: HighlightState): void {
    if (state === this.state) return;
    this.state = state;
    this.pulse = 0;
    if (state === 'none') this.restore();
  }

  /** @param elapsed seconds since the previous frame */
  update(elapsed: number): void {
    if (this.state === 'none') return;
    this.pulse += elapsed;

    // Dwell breathes quickly to signal "keep holding"; a confirmed find settles
    // into a slow, steady glow so the student can still read the vessel.
    const wave =
      this.state === 'dwell'
        ? 0.55 + 0.45 * Math.sin(this.pulse * 9)
        : 0.62 + 0.38 * Math.sin(this.pulse * 2.4);

    const colour = this.state === 'lesion' ? LESION : this.state === 'found' ? CYAN : AMBER;
    const strength = this.state === 'dwell' ? 0.9 : this.state === 'lesion' ? 1.25 : 1.0;

    for (const snap of this.snapshots) {
      snap.material.emissive.copy(colour);
      snap.material.emissiveIntensity = strength * wave;
      if (this.isProxy || snap.opacity === 0) {
        // Proxies are invisible until they matter, then fade in as the label.
        snap.material.transparent = true;
        snap.material.opacity = 0.16 + 0.22 * wave;
        snap.material.depthWrite = false;
      }
    }
  }

  restore(): void {
    for (const snap of this.snapshots) {
      snap.material.emissive.setHex(snap.emissive);
      snap.material.emissiveIntensity = snap.emissiveIntensity;
      snap.material.opacity = snap.opacity;
      snap.material.transparent = snap.transparent;
    }
  }

  dispose(): void {
    this.restore();
    for (const snap of this.snapshots) snap.material.dispose();
  }
}

export interface RegionSet {
  regions: Region[];
  byId: Map<RegionId, Region>;
  /** Every raycastable mesh across all regions, flattened once up-front. */
  targets: THREE.Mesh[];
  /** Regions that had to be synthesised because the GLB did not name them. */
  synthesised: RegionId[];
  /**
   * True when a patient-derived specimen is being scored against reference
   * anatomy rather than its own — i.e. the hover targets are guesses. The UI
   * must say so rather than quietly marking a student wrong.
   */
  unmapped: boolean;
  update(elapsed: number): void;
  clear(): void;
  dispose(): void;
}

/**
 * Region built from a clinician-placed anchor: a sphere sitting on the vessel,
 * invisible until found, then glowing as the "you identified this" marker.
 */
function anchorRegion(id: RegionId, anchor: NonNullable<AnchorSet[RegionId]>): THREE.Mesh {
  const radius = anchor.radius ?? DEFAULT_ANCHOR_RADIUS;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 16, 12),
    new THREE.MeshStandardMaterial({
      color: 0x34e3ff,
      emissive: 0x34e3ff,
      emissiveIntensity: 0,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      roughness: 0.5,
      metalness: 0,
    }),
  );
  mesh.position.fromArray(anchor.at);
  mesh.name = `anchor-${id}`;
  mesh.userData.surgilearnRegion = id;
  return mesh;
}

/**
 * Resolves the case's regions against a loaded specimen, generating proxies for
 * anything the asset does not provide.
 */
export function bindRegions(
  def: CoronaryCase,
  root: THREE.Object3D,
  /** Where the geometry came from — a real scan cannot be scored against
   *  reference centrelines, the procedural tree is built from them. */
  origin: 'glb' | 'procedural',
): RegionSet {
  // Everything this function adds to the scene lives under one group, so a
  // rebind (after anchors are placed) can remove its predecessor wholesale
  // instead of accumulating duplicate hover targets.
  const container = new THREE.Group();
  container.name = 'surgilearn-regions';
  root.add(container);

  const wanted = caseRegions(def);
  const found = new Map<RegionId, THREE.Mesh[]>();
  const foundColliders = new Map<RegionId, THREE.Mesh[]>();

  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const tag = child.userData.surgilearnRegion as RegionId | undefined;
    const id = tag ?? matchByName(child.name, wanted);
    if (!id || !wanted.includes(id)) return;
    // Colliders carry the same region tag as the vessel they stand for, so
    // route them away from the display list rather than double-counting.
    const bucket = child.name.startsWith('collider-') ? foundColliders : found;
    const list = bucket.get(id);
    if (list) list.push(child);
    else bucket.set(id, [child]);
  });

  // Anchors placed in the app override the ones checked into the case, so a
  // clinician can relabel a specimen without a rebuild.
  const anchors: AnchorSet = { ...def.regionAnchors, ...loadAnchors(def.id) };

  const regions: Region[] = [];
  const anchored: RegionId[] = [];
  const stillMissing: RegionId[] = [];

  for (const id of wanted) {
    if (found.has(id)) continue;
    const anchor = anchors[id];
    if (!anchor) {
      stillMissing.push(id);
      continue;
    }
    const mesh = anchorRegion(id, anchor);
    container.add(mesh);
    regions.push(new Region(id, [mesh], [mesh], true));
    anchored.push(id);
  }

  // Only fall back to reference centrelines for what is still unaccounted for.
  const proxies = buildRegionProxies(def, stillMissing, root, container);

  for (const id of wanted) {
    const direct = found.get(id);
    if (direct) {
      regions.push(new Region(id, direct, foundColliders.get(id) ?? [], false));
      continue;
    }
    const proxy = proxies.meshes.get(id);
    if (proxy) {
      regions.push(new Region(id, proxy, proxies.colliders.get(id) ?? [], true));
    }
  }

  // Reference geometry is only trustworthy on the procedural specimen, which
  // is built from those very centrelines. On a real scan it is a guess.
  const unmapped = origin === 'glb' && stillMissing.length > 0;
  if (anchored.length > 0) {
    console.info(`[surgilearn] ${def.id}: bound ${anchored.join(', ')} from placed anchors.`);
  }
  if (unmapped) {
    console.warn(
      `[surgilearn] ${def.id}: ${stillMissing.join(', ')} have no anchor on this specimen — ` +
        'hover targets are reference anatomy and will not match the scan. ' +
        'Open the region picker (📍 in the mission panel, or ?anchors=1) to place them.',
    );
  }

  const byId = new Map(regions.map((r) => [r.id, r] as const));
  const targets = regions.flatMap((r) => r.colliders);

  return {
    regions,
    byId,
    targets,
    synthesised: stillMissing,
    unmapped,
    update(elapsed) {
      for (const region of regions) region.update(elapsed);
    },
    clear() {
      for (const region of regions) region.setState('none');
    },
    dispose() {
      for (const region of regions) region.dispose();
      // Drops every anchor sphere and reference proxy this bind created.
      container.removeFromParent();
      container.traverse((child) => {
        if (child instanceof THREE.Mesh) child.geometry.dispose();
      });
    },
  };
}

function matchByName(name: string, wanted: RegionId[]): RegionId | undefined {
  if (!name) return undefined;
  // Stenosis first: a mesh called "LAD_stenosis" is the lesion, not the vessel.
  const order: RegionId[] = ['STENOSIS', 'LAD', 'LCX', 'RCA'];
  for (const id of order) {
    if (wanted.includes(id) && NAME_PATTERNS[id].test(name)) return id;
  }
  return undefined;
}
