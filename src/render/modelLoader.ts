import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { asset } from '../paths';

export interface LoadedModel {
  root: THREE.Object3D;
  /** Every mesh material in the model, collected so the clipping plane can be
   *  attached to all of them in one pass (Phase 3). */
  materials: THREE.Material[];
  /** Radius of the bounding sphere after normalisation — the slice plane
   *  sweeps across this range. */
  radius: number;
  loadMs: number;
}

export interface LoadProgress {
  (fraction: number): void;
}

/**
 * Loads a glTF/GLB anatomical model, transparently decoding Draco-compressed
 * geometry. The decoder is self-hosted under /draco rather than pulled from a
 * CDN so the platform keeps working fully offline.
 */
export async function loadAnatomicalModel(
  url: string,
  onProgress?: LoadProgress,
): Promise<LoadedModel> {
  const started = performance.now();

  const draco = new DRACOLoader();
  draco.setDecoderPath(asset('draco/'));
  draco.setDecoderConfig({ type: 'js' });

  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);

  const gltf = await loader.loadAsync(url, (event) => {
    if (onProgress && event.lengthComputable) {
      onProgress(event.loaded / event.total);
    }
  });

  draco.dispose();

  const root = gltf.scene;
  const materials = normalise(root);
  const radius = boundingRadius(root);

  return {
    root,
    materials,
    radius,
    loadMs: performance.now() - started,
  };
}

/**
 * Anatomical assets arrive at wildly different scales and origins depending on
 * their source. Recentre on the bounding-box centre and rescale so the longest
 * axis is 2 world units — that way camera framing and gesture sensitivity are
 * identical no matter which organ is loaded.
 *
 * Returns the deduplicated material list gathered during the same traversal.
 */
function normalise(root: THREE.Object3D): THREE.Material[] {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());

  const longest = Math.max(size.x, size.y, size.z);
  const scale = longest > 0 ? 2 / longest : 1;

  root.position.sub(centre);
  // Wrapping in a parent would double the transform the gesture layer owns, so
  // bake the normalisation straight into the model's own transform instead.
  root.position.multiplyScalar(scale);
  root.scale.setScalar(scale);

  const materials = new Set<THREE.Material>();
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.castShadow = true;
    child.receiveShadow = true;
    for (const material of toArray(child.material)) {
      // Clipping reveals back-facing interior geometry; without double-sided
      // rendering the cut surface appears hollow and see-through.
      material.side = THREE.DoubleSide;
      correctTissuePbr(material);
      materials.add(material);
    }
  });

  return [...materials];
}

/**
 * Anatomical scans are routinely exported with `metalness = 1`, which is
 * physically wrong: a fully metallic surface has no diffuse response, so with
 * no environment map the specimen renders almost black regardless of how much
 * light is aimed at it. Biological tissue is dielectric, so force metalness to
 * zero and give it a damp, slightly glossy finish.
 */
function correctTissuePbr(material: THREE.Material): void {
  if (!(material instanceof THREE.MeshStandardMaterial)) return;
  material.metalness = 0;
  // Rougher + weaker environment reflection than a hero render: tissue is damp,
  // not lacquered, so highlights stay soft and diffuse instead of mirror-bright.
  material.roughness = 0.62;
  material.envMapIntensity = 0.35;

  // Anisotropic filtering keeps surface textures crisp at grazing angles (and
  // when zoomed right in), instead of smearing to mush — the difference between
  // a "crystal clear" specimen and a soft one on a retina display.
  for (const map of [material.map, material.normalMap, material.roughnessMap]) {
    if (map) {
      map.anisotropy = 8;
      map.needsUpdate = true;
    }
  }
  material.needsUpdate = true;
}

function boundingRadius(root: THREE.Object3D): number {
  const sphere = new THREE.Box3()
    .setFromObject(root)
    .getBoundingSphere(new THREE.Sphere());
  return sphere.radius;
}

function toArray(material: THREE.Material | THREE.Material[]): THREE.Material[] {
  return Array.isArray(material) ? material : [material];
}
