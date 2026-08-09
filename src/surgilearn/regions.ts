import * as THREE from 'three';
import { REGION_INFO, caseRegions, type CoronaryCase, type RegionId } from './cases';
import { buildRegionProxies } from './coronaryModel';

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
  readonly meshes: THREE.Mesh[];
  /** True when this region only exists as an invisible hover proxy. */
  readonly isProxy: boolean;

  private readonly snapshots: MaterialSnapshot[] = [];
  private state: HighlightState = 'none';
  private pulse = 0;

  constructor(id: RegionId, meshes: THREE.Mesh[], isProxy: boolean) {
    this.id = id;
    this.meshes = meshes;
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
  update(elapsed: number): void;
  clear(): void;
  dispose(): void;
}

/**
 * Resolves the case's regions against a loaded specimen, generating proxies for
 * anything the asset does not provide.
 */
export function bindRegions(def: CoronaryCase, root: THREE.Object3D): RegionSet {
  const wanted = caseRegions(def);
  const found = new Map<RegionId, THREE.Mesh[]>();

  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const tag = child.userData.surgilearnRegion as RegionId | undefined;
    const id = tag ?? matchByName(child.name, wanted);
    if (!id || !wanted.includes(id)) return;
    const list = found.get(id);
    if (list) list.push(child);
    else found.set(id, [child]);
  });

  const missing = wanted.filter((id) => !found.has(id));
  const proxies = buildRegionProxies(def, missing, root);
  if (missing.length > 0) {
    console.info(
      `[surgilearn] ${def.id}: generated hover proxies for ${missing.join(', ')} — ` +
        'name the GLB meshes LAD / LCX / RCA / STENOSIS to bind them directly.',
    );
  }

  const regions: Region[] = [];
  for (const id of wanted) {
    const direct = found.get(id);
    if (direct) {
      regions.push(new Region(id, direct, false));
      continue;
    }
    const proxy = proxies.get(id);
    if (proxy) regions.push(new Region(id, proxy, true));
  }

  const byId = new Map(regions.map((r) => [r.id, r] as const));
  const targets = regions.flatMap((r) => r.meshes);

  return {
    regions,
    byId,
    targets,
    synthesised: missing,
    update(elapsed) {
      for (const region of regions) region.update(elapsed);
    },
    clear() {
      for (const region of regions) region.setState('none');
    },
    dispose() {
      for (const region of regions) region.dispose();
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
