import * as THREE from 'three';

/**
 * Frees every GPU resource under a specimen root: geometries, materials, and
 * any textures a material holds.
 *
 * `Object3D.clear()` / `.remove()` only unlink children from the scene graph —
 * neither Three.js nor the browser frees the underlying GPU buffers on their
 * own, since a geometry or texture can legitimately be shared across objects
 * and only the caller knows when the last reference is gone. Here it isn't
 * shared: each specimen owns its geometry and materials outright, so the
 * outgoing root must be disposed explicitly before it's replaced.
 *
 * Confirmed with `renderer.info.memory` — switching organs without this
 * leaked both geometries and textures every time, growing without bound over
 * a session (Heart → Lungs → Heart → Lungs measured 13/5 → 15/5 → 16/8 →
 * 18/8 geometries/textures; each revisit added its footprint on top of the
 * last rather than reusing or freeing it).
 */
export function disposeSpecimen(root: THREE.Object3D): void {
  const seenMaterials = new Set<THREE.Material>();
  const seenTextures = new Set<THREE.Texture>();

  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;

    child.geometry.dispose();

    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (seenMaterials.has(material)) continue;
      seenMaterials.add(material);

      for (const key of Object.keys(material) as Array<keyof typeof material>) {
        const value = material[key];
        if (value instanceof THREE.Texture && !seenTextures.has(value)) {
          seenTextures.add(value);
          value.dispose();
        }
      }
      material.dispose();
    }
  });
}
