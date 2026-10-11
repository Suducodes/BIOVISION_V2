import * as THREE from 'three';
import type { SegmentDef } from '../segments';

// Weights are packed four to an attribute, so two attributes carry up to eight
// segments — enough for the cardiac set. More would need a third.
const MAX_SEGMENTS = 8;

// How sharply a vertex commits to its nearest segment, in model units (the
// specimen is 2 across). Small enough that the interior of a segment is
// unambiguous, large enough that the border is a smooth ramp rather than a
// per-triangle staircase.
const BLEND = 0.035;

/**
 * Splits a specimen into its named segments and lets one be lit up.
 *
 * The mesh has no parts of its own, so each vertex is given a weight for every
 * segment, from its distance to that segment's sites. The weights are smooth,
 * so interpolating them across a triangle traces the border between two
 * segments as a clean line instead of a jagged edge that follows the mesh.
 * (Interpolating a segment *index* instead is tempting and wrong: across a
 * triangle between segment 1 and segment 5 it passes through 2, 3 and 4, and
 * lights stray slivers of segments that aren't there.)
 *
 * A small patch on the standard material reads those weights. With a segment
 * selected, everything else dims and a glowing contour traces the segment's
 * border, so the heart reads as split into parts while the selected one keeps
 * its natural colour — no geometry or texture is altered.
 */
export class SegmentHighlighter {
  private readonly indexById = new Map<string, number>();
  // Uniform objects are shared by reference with every patched material, so
  // updating `.value` here updates all of them at once.
  private readonly uSel0 = { value: new THREE.Vector4() };
  private readonly uSel1 = { value: new THREE.Vector4() };
  private readonly uMix = { value: 0 };
  private readonly uPulse = { value: 1 };
  private target = 0;
  private selected = -1;
  private readonly patched: THREE.Material[] = [];

  constructor(
    root: THREE.Object3D,
    pivot: THREE.Object3D,
    segments: SegmentDef[],
  ) {
    if (segments.length > MAX_SEGMENTS) {
      console.warn(`[bio-vision] ${segments.length} segments; only the first ${MAX_SEGMENTS} can be highlighted`);
    }
    const used = segments.slice(0, MAX_SEGMENTS);
    used.forEach((s, i) => this.indexById.set(s.id, i));

    const sites: Array<{ index: number; p: THREE.Vector3 }> = [];
    used.forEach((s, index) => {
      sites.push({ index, p: new THREE.Vector3(...s.anchor) });
      for (const extra of s.sites ?? []) {
        sites.push({ index, p: new THREE.Vector3(...extra) });
      }
    });

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
      const w0 = new Float32Array(position.count * 4);
      const w1 = new Float32Array(position.count * 4);
      const v = new THREE.Vector3();
      const distances = new Float32Array(sites.length);
      const share = new Float32Array(MAX_SEGMENTS);

      for (let i = 0; i < position.count; i++) {
        v.fromBufferAttribute(position, i).applyMatrix4(relative);
        let nearest = Infinity;
        for (let s = 0; s < sites.length; s++) {
          const d = v.distanceTo(sites[s]!.p);
          distances[s] = d;
          if (d < nearest) nearest = d;
        }
        // A softmax over distance from the nearest site: it falls off
        // exponentially, so a vertex deep in a segment gets ~1 for it and ~0
        // for the rest, and only vertices near a border split their weight.
        share.fill(0);
        let total = 0;
        for (let s = 0; s < sites.length; s++) {
          const weight = Math.exp(-(distances[s]! - nearest) / BLEND);
          share[sites[s]!.index]! += weight;
          total += weight;
        }
        for (let k = 0; k < 4; k++) {
          w0[i * 4 + k] = share[k]! / total;
          w1[i * 4 + k] = share[k + 4]! / total;
        }
      }
      child.geometry.setAttribute('aW0', new THREE.BufferAttribute(w0, 4));
      child.geometry.setAttribute('aW1', new THREE.BufferAttribute(w1, 4));

      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) this.patch(material);
    });
  }

  /** Light up one segment, or pass null to restore the whole specimen. */
  select(id: string | null): void {
    const index = id === null ? undefined : this.indexById.get(id);
    if (index === undefined) {
      this.target = 0;
      return;
    }
    // Moving straight from one segment to another re-triggers the fade-in, so
    // the change is visible rather than an instant swap of what glows.
    if (this.selected !== index) this.uMix.value = Math.min(this.uMix.value, 0.2);
    this.selected = index;
    this.uSel0.value.set(0, 0, 0, 0);
    this.uSel1.value.set(0, 0, 0, 0);
    if (index < 4) this.uSel0.value.setComponent(index, 1);
    else this.uSel1.value.setComponent(index - 4, 1);
    this.target = 1;
  }

  /** Call once per frame. `time` is seconds since start, for the pulse. */
  update(delta: number, time: number): void {
    const k = Math.min(1, 7 * delta);
    this.uMix.value += (this.target - this.uMix.value) * k;
    this.uPulse.value = 0.8 + 0.2 * Math.sin(time * 3.2);
    // Once fully faded out nothing should be tinted or dimmed.
    if (this.target === 0 && this.uMix.value < 0.002) this.uMix.value = 0;
  }

  private patch(material: THREE.Material): void {
    if (!(material instanceof THREE.MeshStandardMaterial)) return;

    material.onBeforeCompile = (shader) => {
      shader.uniforms.uSel0 = this.uSel0;
      shader.uniforms.uSel1 = this.uSel1;
      shader.uniforms.uMix = this.uMix;
      shader.uniforms.uPulse = this.uPulse;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute vec4 aW0;\nattribute vec4 aW1;\nvarying vec4 vW0;\nvarying vec4 vW1;',
        )
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvW0 = aW0;\nvW1 = aW1;');

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform vec4 uSel0;\nuniform vec4 uSel1;\nuniform float uMix;\nuniform float uPulse;\nvarying vec4 vW0;\nvarying vec4 vW1;',
        )
        // The three weights are worked out where the normal map has been
        // applied but lighting has not run, then used at the very end:
        //   segW      the selected segment's share of this fragment, 0..1
        //   segInside ramps up across the border so the segment keeps full colour
        //   segEdge   peaks where segW crosses one half — the border itself
        // Dimming acts on the *finished* light, not the diffuse colour. At close
        // range a headlamp's specular shine is as strong as the diffuse term, so
        // dimming only the diffuse left the rest of the heart bright.
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          float segW = dot(vW0, uSel0) + dot(vW1, uSel1);
          float segInside = smoothstep(0.40, 0.60, segW);
          float segEdge = 1.0 - smoothstep(0.0, 0.16, abs(segW - 0.5));`,
        )
        .replace(
          '#include <opaque_fragment>',
          `outgoingLight *= mix(1.0, mix(0.26, 1.0, segInside), uMix);
          // Added after the dimming so the contour stays bright against it.
          outgoingLight += vec3(0.10, 0.85, 1.0) * segEdge * uMix * uPulse * 0.9;
          #include <opaque_fragment>`,
        );
    };
    // Only patched materials share this program, so give it its own cache key —
    // otherwise three.js could hand it to an unpatched material, or the reverse.
    material.customProgramCacheKey = () => 'bio-vision-segment-highlight-v3';
    material.needsUpdate = true;
    this.patched.push(material);
  }

  dispose(): void {
    for (const material of this.patched) {
      material.onBeforeCompile = () => {};
      material.customProgramCacheKey = () => '';
    }
    this.patched.length = 0;
  }
}
