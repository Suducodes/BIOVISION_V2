import * as THREE from 'three';
import { loadAnatomicalModel, type LoadedModel, type LoadProgress } from '../render/modelLoader';
import { buildCoronaryTree, normaliseTree } from './coronaryModel';
import type { CoronaryCase } from './cases';

export interface SpecimenModel extends LoadedModel {
  /** Where the geometry came from — surfaced in the specimen log. */
  origin: 'glb' | 'procedural';
}

/**
 * Loads a coronary case, falling back to the procedural arterial tree when the
 * GLB has not been dropped in yet.
 *
 * The presence check is a HEAD request rather than a try/catch around the
 * loader: a missing file is an expected state for a fresh clone, and probing
 * keeps it from surfacing as a thrown GLTFLoader error in the console.
 */
export async function loadCaseModel(
  def: CoronaryCase,
  url: string,
  onProgress?: LoadProgress,
): Promise<SpecimenModel> {
  if (await exists(url)) {
    try {
      const model = await loadAnatomicalModel(url, onProgress);
      applyArterialFinish(model.materials);
      return { ...model, origin: 'glb' };
    } catch (error) {
      console.warn(
        `[surgilearn] ${def.id}: ${url} failed to parse, using the procedural tree instead`,
        error,
      );
    }
  } else {
    console.info(
      `[surgilearn] ${def.id}: no GLB at ${url} — rendering the procedural coronary tree. ` +
        'Drop the file in to swap it out; no code change needed.',
    );
  }

  return buildProceduralSpecimen(def);
}

/**
 * Coronary segmentations are exported straight from the reconstruction pipeline
 * with no materials at all, so glTF hands them the default white plastic — which
 * reads as a 3D-print of a vessel tree rather than a vessel tree. Give untextured
 * meshes the same arterial finish the procedural tree uses, so the two sources
 * look like the same platform. Anything that arrived with its own texture is left
 * exactly as authored.
 */
function applyArterialFinish(materials: THREE.Material[]): void {
  for (const material of materials) {
    if (!(material instanceof THREE.MeshStandardMaterial)) continue;
    if (material.map) continue;
    material.color.setHex(0xb02a30);
    material.roughness = 0.45;
    material.metalness = 0;
    material.envMapIntensity = 0.5;
    material.needsUpdate = true;
  }
}

function buildProceduralSpecimen(def: CoronaryCase): SpecimenModel {
  const started = performance.now();
  const tree = buildCoronaryTree(def);
  const radius = normaliseTree(tree);

  const materials = new Set<THREE.Material>();
  tree.root.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
        materials.add(material);
      }
    }
  });

  return {
    root: tree.root,
    materials: [...materials],
    radius,
    loadMs: performance.now() - started,
    origin: 'procedural',
  };
}

/**
 * A plain `response.ok` is not enough: both the Vite dev server and GitHub
 * Pages answer an unknown path with an HTML document rather than a 404, which
 * would send an index page into the GLB parser. Rejecting `text/html` keeps the
 * missing-file path quiet in every environment this ships to.
 */
async function exists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    if (!response.ok) return false;
    return !(response.headers.get('content-type') ?? '').includes('text/html');
  } catch {
    return false;
  }
}
