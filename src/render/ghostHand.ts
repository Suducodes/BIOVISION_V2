import * as THREE from 'three';
import { LM, type HandLandmarks } from '../gesture/types';

/**
 * The holographic ghost hand — a translucent, fresnel-rimmed 3D hand that
 * tracks the user's real hand in space above the specimen.
 *
 * Every other gesture consumer in this app reduces the 21 MediaPipe landmarks
 * down to a couple of numbers (a centroid, a pinch distance) because that's
 * all move/rotate/zoom needs. This is the first thing that renders the full
 * skeleton — 21 joints, the bones between them, and a filled palm plate — as
 * an actual object in the 3D scene rather than a flat overlay on the camera
 * thumbnail.
 *
 * Positioning is camera-relative, not specimen-relative: the hand represents
 * something physically in front of the webcam, so it is parented to the scene
 * and unprojected fresh every frame from the camera's current pose, never to
 * the pivot. Rotating the specimen must never rotate the hand.
 *
 * Depth is the one place this is honest about its limits. A single webcam
 * gives MediaPipe's z only *relative* to the wrist, not true metric depth —
 * there is no second camera to triangulate against. That's enough to make
 * fingers visibly curl toward and away from the lens, which is all a
 * stylised hologram needs; it is not measurement-grade AR, and DEPTH_UNITS
 * below is a tuned constant, not a calibrated one.
 */

interface Bone {
  from: number;
  to: number;
  radius: number;
}

// Palm struts render thicker than finger bones so the hand still reads as a
// hand at a glance, the way the real webbing between fingers does. Fingers
// taper base-to-tip across their three segments.
const BONES: Bone[] = [
  // Wrist to each knuckle. The palm *plate* (below) is what actually reads
  // as a palm; these are its structural spine.
  { from: LM.WRIST, to: LM.THUMB_CMC, radius: 0.036 },
  { from: LM.WRIST, to: LM.PINKY_MCP, radius: 0.036 },
  // Thumb — visibly stouter than the fingers, like a real thumb.
  { from: LM.THUMB_CMC, to: LM.THUMB_MCP, radius: 0.032 },
  { from: LM.THUMB_MCP, to: LM.THUMB_IP, radius: 0.026 },
  { from: LM.THUMB_IP, to: LM.THUMB_TIP, radius: 0.02 },
  // Index
  { from: LM.INDEX_MCP, to: LM.INDEX_PIP, radius: 0.03 },
  { from: LM.INDEX_PIP, to: LM.INDEX_DIP, radius: 0.024 },
  { from: LM.INDEX_DIP, to: LM.INDEX_TIP, radius: 0.018 },
  // Middle — the longest finger, kept the thickest of the four for it.
  { from: LM.MIDDLE_MCP, to: LM.MIDDLE_PIP, radius: 0.031 },
  { from: LM.MIDDLE_PIP, to: LM.MIDDLE_DIP, radius: 0.025 },
  { from: LM.MIDDLE_DIP, to: LM.MIDDLE_TIP, radius: 0.019 },
  // Ring
  { from: LM.RING_MCP, to: LM.RING_PIP, radius: 0.029 },
  { from: LM.RING_PIP, to: LM.RING_DIP, radius: 0.023 },
  { from: LM.RING_DIP, to: LM.RING_TIP, radius: 0.017 },
  // Pinky
  { from: LM.PINKY_MCP, to: LM.PINKY_PIP, radius: 0.025 },
  { from: LM.PINKY_PIP, to: LM.PINKY_DIP, radius: 0.02 },
  { from: LM.PINKY_DIP, to: LM.PINKY_TIP, radius: 0.015 },
];

// The palm plate's own fan triangulation, wrist as the hub. This is what
// turns the hand from a wireframe star into something that reads as a palm
// at a glance — the single biggest lever on "does this look like a hand".
const PALM_VERTS = [LM.WRIST, LM.THUMB_CMC, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP];
const PALM_INDICES = [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5];

// Per-landmark joint radius. A fingertip joint sitting under a knuckle-sized
// sphere is what read as "an olive balanced on a toothpick" in testing —
// sizing each joint to the bone it actually terminates makes the transition
// seamless instead of ball-on-a-stick.
const JOINT_RADIUS: Partial<Record<number, number>> = {
  [LM.WRIST]: 0.075,
  [LM.THUMB_CMC]: 0.036, [LM.THUMB_MCP]: 0.03, [LM.THUMB_IP]: 0.024, [LM.THUMB_TIP]: 0.017,
  [LM.INDEX_MCP]: 0.034, [LM.INDEX_PIP]: 0.026, [LM.INDEX_DIP]: 0.021, [LM.INDEX_TIP]: 0.015,
  [LM.MIDDLE_MCP]: 0.035, [LM.MIDDLE_PIP]: 0.027, [LM.MIDDLE_DIP]: 0.021, [LM.MIDDLE_TIP]: 0.016,
  [LM.RING_MCP]: 0.033, [LM.RING_PIP]: 0.025, [LM.RING_DIP]: 0.02, [LM.RING_TIP]: 0.014,
  [LM.PINKY_MCP]: 0.029, [LM.PINKY_PIP]: 0.022, [LM.PINKY_DIP]: 0.017, [LM.PINKY_TIP]: 0.012,
};
const DEFAULT_JOINT_RADIUS = 0.026;

// How far in front of the camera the wrist sits, as a fraction of the
// camera-to-pivot distance. Tying it to that distance (rather than a fixed
// number) keeps the hand sized sensibly relative to the specimen as the user
// zooms the camera dolly in and out.
const HOVER_FRACTION = 0.55;

// MediaPipe's z is in roughly the same normalised units as x, more negative
// toward the camera. Fixed, *absolute* world units — not scaled by camera
// distance — is what keeps depth exaggeration proportionate to hand size at
// every zoom level. Scaling this by hoverDistance (the first version did)
// meant the same small z difference between two fingertips ballooned into a
// spike worth nearly half the hand's hover distance the moment the camera
// pulled back even slightly — that's the "toothpick" look in testing.
// Clamped per-landmark so tracking noise can't spike a single joint.
const DEPTH_UNITS = 0.32;
const MAX_DEPTH_Z = 0.35;

const CYAN = new THREE.Color(0x34e3ff);

/** Fresnel-rimmed hologram material: bright, opaque at grazing angles, dim
 *  and glassy face-on. Additive blending on the near-black background reads
 *  as light rather than as a lit solid, and it's a single cheap dot product
 *  per fragment — no render-to-texture passes, unlike a physically
 *  transmissive material, which this platform's low-end hardware target
 *  can't afford. */
function hologramMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: CYAN.clone() },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vViewDir = normalize(-viewPosition.xyz);
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        // A gentler falloff (1.5, was 2.2) and a higher floor (0.3, was
        // 0.16) keep the face-on surface of a thick finger reading as
        // glassy solid rather than fading to a near-invisible core with a
        // blown-out rim — the earlier tuning was calibrated against thin
        // bones, where that core was never on screen for long anyway.
        float fresnel = pow(1.0 - max(dot(normalize(vNormal), normalize(vViewDir)), 0.0), 1.5);
        float glow = 0.3 + fresnel * 0.8;
        gl_FragColor = vec4(uColor * glow, glow * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

interface BoneMesh {
  mesh: THREE.Mesh;
  from: number;
  to: number;
  radius: number;
}

export class GhostHand {
  readonly group = new THREE.Group();
  private readonly joints: THREE.Mesh[] = [];
  private readonly bones: BoneMesh[] = [];
  private readonly palm: THREE.Mesh;
  private readonly palmPosition: THREE.BufferAttribute;
  private readonly material: THREE.ShaderMaterial;

  private readonly scratchA = new THREE.Vector3();
  private readonly scratchDir = new THREE.Vector3();
  private readonly scratchQuat = new THREE.Quaternion();
  private readonly upAxis = new THREE.Vector3(0, 1, 0);
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
    for (let i = 0; i < 21; i++) {
      const mesh = new THREE.Mesh(jointGeometry, this.material);
      this.group.add(mesh);
      this.joints.push(mesh);
    }

    // One unit capsule (radius 1, length 1) reused for every bone; per-bone
    // radius and length are applied as a non-uniform scale each frame rather
    // than baking a differently-sized geometry per bone. The hemispherical
    // caps distort slightly under that non-uniform scale, which is
    // imperceptible on bones this thin at the distances they're viewed from.
    const boneGeometry = new THREE.CapsuleGeometry(1, 1, 6, 12);
    for (const bone of BONES) {
      const mesh = new THREE.Mesh(boneGeometry, this.material);
      this.group.add(mesh);
      this.bones.push({ mesh, from: bone.from, to: bone.to, radius: bone.radius });
    }

    // Palm plate: positions rewritten from tracked landmarks every frame,
    // topology (the fan triangulation) fixed at construction.
    const palmGeometry = new THREE.BufferGeometry();
    this.palmPosition = new THREE.BufferAttribute(new Float32Array(PALM_VERTS.length * 3), 3);
    palmGeometry.setAttribute('position', this.palmPosition);
    palmGeometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(PALM_VERTS.length * 3), 3));
    palmGeometry.setIndex(PALM_INDICES);
    this.palm = new THREE.Mesh(palmGeometry, this.material);
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
      this.joints[i]!.position.copy(this.points[i]!);
      this.joints[i]!.scale.setScalar(JOINT_RADIUS[i] ?? DEFAULT_JOINT_RADIUS);
    }

    for (const bone of this.bones) {
      const a = this.points[bone.from]!;
      const b = this.points[bone.to]!;
      const length = a.distanceTo(b);
      bone.mesh.position.copy(a).lerp(b, 0.5);
      this.scratchDir.copy(b).sub(a).normalize();
      this.scratchQuat.setFromUnitVectors(this.upAxis, this.scratchDir);
      bone.mesh.quaternion.copy(this.scratchQuat);
      bone.mesh.scale.set(bone.radius, Math.max(length, 1e-4), bone.radius);
    }

    // Palm plate lives in world space directly (its vertices are already the
    // unprojected joint positions), so the mesh itself sits at the identity
    // transform and only its position attribute moves.
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
    this.joints[0]?.geometry.dispose();
    this.bones[0]?.mesh.geometry.dispose();
    this.palm.geometry.dispose();
    this.material.dispose();
  }
}
