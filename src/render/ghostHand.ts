import * as THREE from 'three';
import { LM, type HandLandmarks } from '../gesture/types';

/**
 * The holographic ghost hand — a translucent, fresnel-rimmed 3D hand that
 * tracks the user's real hand in space above the specimen.
 *
 * Every other gesture consumer in this app reduces the 21 MediaPipe landmarks
 * down to a couple of numbers (a centroid, a pinch distance) because that's
 * all move/rotate/zoom needs. This is the first thing that renders the full
 * skeleton as an actual object in the 3D scene rather than a flat overlay on
 * the camera thumbnail.
 *
 * Fingers are one continuous tapered tube each (a Catmull-Rom spline through
 * the four joints, swept with a varying radius), not a chain of separate
 * capsule segments — the same technique the coronary vessels use elsewhere
 * in this app. A first version built each finger from three rigid capsules
 * glued at the joints; no amount of radius tuning fixed it, because the seam
 * between two independently-oriented rigid primitives always reads as a
 * bump, and with real tracked (rather than hand-placed synthetic) landmark
 * noise it read as spikes radiating off a palm blob. A spline swept once per
 * finger has no seams to begin with.
 *
 * Positioning is camera-relative, not specimen-relative: the hand represents
 * something physically in front of the webcam, so it is parented to the
 * scene and unprojected fresh every frame from the camera's current pose,
 * never to the pivot. Rotating the specimen must never rotate the hand.
 *
 * Depth is the one place this is honest about its limits. A single webcam
 * gives MediaPipe's z only *relative* to the wrist, not true metric depth —
 * there is no second camera to triangulate against. That's enough to make
 * fingers visibly curl toward and away from the lens, which is all a
 * stylised hologram needs; it is not measurement-grade AR, and DEPTH_UNITS
 * below is a tuned constant, not a calibrated one.
 */

interface FingerDef {
  joints: [number, number, number, number];
  baseRadius: number;
  tipRadius: number;
}

const FINGERS: FingerDef[] = [
  { joints: [LM.THUMB_CMC, LM.THUMB_MCP, LM.THUMB_IP, LM.THUMB_TIP], baseRadius: 0.034, tipRadius: 0.016 },
  { joints: [LM.INDEX_MCP, LM.INDEX_PIP, LM.INDEX_DIP, LM.INDEX_TIP], baseRadius: 0.03, tipRadius: 0.014 },
  { joints: [LM.MIDDLE_MCP, LM.MIDDLE_PIP, LM.MIDDLE_DIP, LM.MIDDLE_TIP], baseRadius: 0.031, tipRadius: 0.015 },
  { joints: [LM.RING_MCP, LM.RING_PIP, LM.RING_DIP, LM.RING_TIP], baseRadius: 0.029, tipRadius: 0.013 },
  { joints: [LM.PINKY_MCP, LM.PINKY_PIP, LM.PINKY_DIP, LM.PINKY_TIP], baseRadius: 0.025, tipRadius: 0.011 },
];

// The palm plate's own fan triangulation, wrist as the hub — the single
// biggest lever on "does this read as a hand" versus five sticks fanning
// out of a point.
const PALM_VERTS = [LM.WRIST, LM.THUMB_CMC, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP];
const PALM_INDICES = [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5];

const WRIST_RADIUS = 0.078;

// How far in front of the camera the wrist sits, as a fraction of the
// camera-to-pivot distance. Tying it to that distance (rather than a fixed
// number) keeps the hand sized sensibly relative to the specimen as the user
// zooms the camera dolly in and out.
const HOVER_FRACTION = 0.55;

// MediaPipe's z is in roughly the same normalised units as x, more negative
// toward the camera. Fixed, *absolute* world units — not scaled by camera
// distance — is what keeps depth exaggeration proportionate to hand size at
// every zoom level. Clamped per-landmark so tracking noise can't spike a
// single joint (this was the original cause of the "toothpick" spikes: v1
// scaled the offset by camera distance, so ordinary per-fingertip z noise
// ballooned as the camera pulled back).
const DEPTH_UNITS = 0.32;
const MAX_DEPTH_Z = 0.35;

const CYAN = new THREE.Color(0x34e3ff);

// Roughly the scene's own key light direction (see buildLightingRig in
// render/scene.ts, position (3,4,5)) — not physically linked to it, just
// aimed the same way so the hologram's shading agrees with the specimen's.
const LIGHT_DIR = new THREE.Vector3(3, 4, 5).normalize();

/** Fresnel-rimmed hologram material, plus a fixed-direction Lambert term.
 *
 *  Fresnel alone (bright at grazing angles, dim face-on) is what a first
 *  version used, and it made every tube look like a flat glowing ribbon
 *  instead of a round finger: fresnel only varies with *view* angle, and
 *  across the width of a thin cylinder pointed roughly away from the camera
 *  the view angle barely changes, so the whole cross-section came out one
 *  flat brightness. A real material would reveal the curvature through
 *  standard Lambertian shading (surface tilt relative to a light), which is
 *  exactly what the coronary vessels elsewhere in this app get from
 *  MeshStandardMaterial and this didn't. Adding one hardcoded-direction dot
 *  product alongside the fresnel term gets that same "this is round" cue
 *  for the cost of a single extra multiply-add — nowhere near the cost of
 *  wiring this into the scene's real lights via a physically-lit material.
 *
 *  All of this happens in world space rather than view space: every mesh
 *  this material is used on (the tubes, the palm plate) already writes
 *  world-space coordinates directly into its position/normal attributes
 *  (see DynamicTube.update below), and the joint spheres carry only
 *  position + uniform scale, never rotation, so their local normals are
 *  already parallel to world space too. That sidesteps normalMatrix/camera
 *  transforms entirely — cheaper, and correct for every mesh in this group
 *  without needing to special-case any of them. */
function hologramMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: CYAN.clone() },
      uOpacity: { value: 1 },
      uLightDir: { value: LIGHT_DIR },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      void main() {
        vWorldPos = position;
        vWorldNormal = normalize(normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform vec3 uLightDir;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      void main() {
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        float fresnel = pow(1.0 - max(dot(vWorldNormal, viewDir), 0.0), 1.5);
        float lambert = max(dot(vWorldNormal, uLightDir), 0.0);
        float glow = 0.2 + lambert * 0.45 + fresnel * 0.55;
        gl_FragColor = vec4(uColor * glow, glow * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

const TUBULAR_SEGMENTS = 12;
const RADIAL_SEGMENTS = 8;

/**
 * One finger's surface: a fixed-topology tube whose vertex positions are
 * rewritten in place every frame from a fresh Catmull-Rom spline through the
 * finger's four current joint positions. No per-frame allocation of GPU
 * buffers — only the existing typed arrays are overwritten — so this costs a
 * handful of trig calls per vertex, not a geometry rebuild.
 */
class DynamicTube {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.BufferGeometry;
  private readonly posAttr: THREE.BufferAttribute;
  private readonly normAttr: THREE.BufferAttribute;
  private readonly point = new THREE.Vector3();

  constructor(material: THREE.Material) {
    const vertCount = (TUBULAR_SEGMENTS + 1) * (RADIAL_SEGMENTS + 1);
    this.geometry = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(vertCount * 3), 3);
    this.normAttr = new THREE.BufferAttribute(new Float32Array(vertCount * 3), 3);
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('normal', this.normAttr);

    const indices: number[] = [];
    const stride = RADIAL_SEGMENTS + 1;
    for (let i = 1; i <= TUBULAR_SEGMENTS; i++) {
      for (let j = 1; j <= RADIAL_SEGMENTS; j++) {
        const a = stride * (i - 1) + (j - 1);
        const b = stride * i + (j - 1);
        const c = stride * i + j;
        const d = stride * (i - 1) + j;
        indices.push(a, b, d, b, c, d);
      }
    }
    this.geometry.setIndex(indices);
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
  }

  update(points: THREE.Vector3[], baseRadius: number, tipRadius: number): void {
    const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.35);
    const frames = curve.computeFrenetFrames(TUBULAR_SEGMENTS, false);
    const stride = RADIAL_SEGMENTS + 1;

    for (let i = 0; i <= TUBULAR_SEGMENTS; i++) {
      const t = i / TUBULAR_SEGMENTS;
      curve.getPointAt(t, this.point);
      const normalRing = frames.normals[i]!;
      const binormalRing = frames.binormals[i]!;
      // Eased taper: stays close to baseRadius near the palm, narrows faster
      // approaching the tip — reads as a finger, not a cone.
      const radius = baseRadius + (tipRadius - baseRadius) * Math.pow(t, 0.7);

      for (let j = 0; j <= RADIAL_SEGMENTS; j++) {
        const angle = (j / RADIAL_SEGMENTS) * Math.PI * 2;
        const sin = Math.sin(angle);
        const cos = -Math.cos(angle);
        const nx = cos * normalRing.x + sin * binormalRing.x;
        const ny = cos * normalRing.y + sin * binormalRing.y;
        const nz = cos * normalRing.z + sin * binormalRing.z;
        const idx = stride * i + j;
        this.posAttr.setXYZ(
          idx,
          this.point.x + radius * nx,
          this.point.y + radius * ny,
          this.point.z + radius * nz,
        );
        this.normAttr.setXYZ(idx, nx, ny, nz);
      }
    }
    this.posAttr.needsUpdate = true;
    this.normAttr.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }

  dispose(): void {
    this.geometry.dispose();
  }
}

export class GhostHand {
  readonly group = new THREE.Group();
  private readonly fingers: DynamicTube[] = [];
  private readonly wristJoint: THREE.Mesh;
  private readonly tipJoints: THREE.Mesh[] = [];
  private readonly palm: THREE.Mesh;
  private readonly palmPosition: THREE.BufferAttribute;
  private readonly material: THREE.ShaderMaterial;

  private readonly scratchA = new THREE.Vector3();
  private readonly scratchDir = new THREE.Vector3();
  private readonly points: THREE.Vector3[] = Array.from({ length: 21 }, () => new THREE.Vector3());

  constructor(scene: THREE.Scene) {
    this.group.name = 'ghost-hand';
    this.group.visible = false;
    // Depth-sorted after the specimen so it reads as hovering above it rather
    // than fighting for the same depth range; renderOrder alone is enough
    // since depthWrite is off on the material.
    this.group.renderOrder = 10;
    scene.add(this.group);

    this.material = hologramMaterial();

    const jointGeometry = new THREE.SphereGeometry(1, 16, 12);

    // Rounds off the heel of the hand and blends into the palm plate.
    this.wristJoint = new THREE.Mesh(jointGeometry, this.material);
    this.wristJoint.scale.setScalar(WRIST_RADIUS);
    this.group.add(this.wristJoint);

    for (const finger of FINGERS) {
      const tube = new DynamicTube(this.material);
      this.group.add(tube.mesh);
      this.fingers.push(tube);

      // Rounds off the open end of each tube — without this the fingertip is
      // a flat ring, which reads as a cut-off stub rather than a tip.
      const tip = new THREE.Mesh(jointGeometry, this.material);
      tip.scale.setScalar(finger.tipRadius);
      this.group.add(tip);
      this.tipJoints.push(tip);
    }

    // Palm plate: positions rewritten from tracked landmarks every frame,
    // topology (the fan triangulation) fixed at construction.
    const palmGeometry = new THREE.BufferGeometry();
    this.palmPosition = new THREE.BufferAttribute(new Float32Array(PALM_VERTS.length * 3), 3);
    palmGeometry.setAttribute('position', this.palmPosition);
    palmGeometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(PALM_VERTS.length * 3), 3));
    palmGeometry.setIndex(PALM_INDICES);
    this.palm = new THREE.Mesh(palmGeometry, this.material);
    // A fresh BufferGeometry has no bounding sphere until one is computed,
    // and this one's vertices move every frame, so there's never a moment to
    // compute a lasting one. Without this the palm plate silently failed
    // frustum culling and never rendered at all — visible as a gap of bare
    // heart tissue between the wrist joint and the finger bases in testing.
    this.palm.frustumCulled = false;
    this.group.add(this.palm);
  }

  /**
   * @param hand latest tracked landmarks for the hand to render, or undefined
   *   when no hand is currently visible to the camera
   */
  update(
    hand: HandLandmarks | undefined,
    camera: THREE.Camera,
    pivot: THREE.Object3D,
  ): void {
    if (!hand || hand.length < 21) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;

    const hoverDistance = Math.max(
      0.4,
      camera.position.distanceTo(pivot.position) * HOVER_FRACTION,
    );

    for (let i = 0; i < 21; i++) {
      this.unproject(hand[i]!, camera, hoverDistance, this.points[i]!);
    }

    this.wristJoint.position.copy(this.points[LM.WRIST]!);

    for (let f = 0; f < FINGERS.length; f++) {
      const def = FINGERS[f]!;
      const jointPoints = def.joints.map((idx) => this.points[idx]!);
      this.fingers[f]!.update(jointPoints, def.baseRadius, def.tipRadius);
      this.tipJoints[f]!.position.copy(this.points[def.joints[3]]!);
    }

    for (let v = 0; v < PALM_VERTS.length; v++) {
      const p = this.points[PALM_VERTS[v]!]!;
      this.palmPosition.setXYZ(v, p.x, p.y, p.z);
    }
    this.palmPosition.needsUpdate = true;
    this.palm.geometry.computeVertexNormals();
  }

  /** Casts a normalised-image-space landmark into a world-space point at the
   *  given distance from the camera, offset in depth by the landmark's own
   *  MediaPipe z. */
  private unproject(
    landmark: { x: number; y: number; z: number },
    camera: THREE.Camera,
    hoverDistance: number,
    out: THREE.Vector3,
  ): void {
    // Same mirror convention as the rest of the gesture pipeline (mirrored
    // webcam feed, screen-space y flip) — see hoverProbe.setGestureTip.
    const ndcX = 1 - 2 * landmark.x;
    const ndcY = 1 - 2 * landmark.y;

    this.scratchA.set(ndcX, ndcY, 0.5).unproject(camera);
    this.scratchDir.copy(this.scratchA).sub(camera.position).normalize();

    const z = Math.min(MAX_DEPTH_Z, Math.max(-MAX_DEPTH_Z, landmark.z));
    const depth = hoverDistance - z * DEPTH_UNITS;
    out.copy(camera.position).addScaledVector(this.scratchDir, depth);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.wristJoint.geometry.dispose();
    for (const tube of this.fingers) tube.dispose();
    this.palm.geometry.dispose();
    this.material.dispose();
  }
}
