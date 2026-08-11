import * as THREE from 'three';
import { ladReferenceCurve } from '../coronaryModel';

/**
 * The Steady Hand trace challenge.
 *
 * Everything else in this app that uses hand tracking reduces the tracked
 * hand to a cursor — a point that identifies a vessel, drags a specimen,
 * drives a hologram. This is the first thing that scores the *motion
 * itself*: trace your bare fingertip along the LAD's real epicardial course
 * and it grades you the way surgical-training instruments grade technical
 * skill — path accuracy, motion smoothness, and time — not "did you find
 * the right vessel". The tracking data that used to just move a cursor
 * becomes the actual measurement instrument.
 *
 * The guide path, the trail, and the start/end markers are all parented to
 * the specimen's pivot rather than the scene. The LAD centreline is authored
 * in the same normalised coordinate frame every specimen is fitted into on
 * load (see coronaryModel.ts), so it means the same thing whether the heart,
 * a lung, or a coronary case is the specimen currently on screen — parenting
 * to the pivot means it also rotates naturally with whatever's loaded,
 * without this module needing to know or care which specimen that is.
 * Scoring accordingly happens in the pivot's local space: the tracked
 * fingertip (computed in world space, camera-relative) is converted into
 * that local space once per frame rather than transforming the whole
 * pre-sampled curve every frame.
 */

const GUIDE_RADIUS = 0.028;
const GUIDE_SAMPLES = 96;
const TRAIL_MAX_POINTS = 900;

// Points further than this from the centreline score zero accuracy for that
// sample; this is deliberately generous — a fingertip held in open air by a
// human hand is never going to trace a 2mm-equivalent line with anatomical
// precision, and the point is to reward *improvement*, not to be punishing.
const MAX_DEVIATION = 0.16;

// A direction change sharper than this between consecutive trail segments is
// counted as jitter rather than an intentional turn the vessel itself makes.
const JERK_ANGLE_DEG = 22;
const JERK_BUDGET = 14; // total "jerk units" before smoothness bottoms out

const PAR_SECONDS = 14;
const COMPLETION_T = 0.93;
const COMPLETION_DWELL_MS = 450;

const CYAN = new THREE.Color(0x34e3ff);
const AMBER = new THREE.Color(0xffce6a);
const RED = new THREE.Color(0xff5a5a);
const GREEN = new THREE.Color(0x38e08f);

export interface TraceResult {
  score: number;
  accuracy: number;
  smoothness: number;
  speed: number;
  timeMs: number;
  jerkEvents: number;
}

interface CurveSample {
  point: THREE.Vector3;
  t: number;
}

export class TraceChallenge {
  private readonly group = new THREE.Group();
  private readonly curve: THREE.CatmullRomCurve3;
  private readonly samples: CurveSample[];

  private readonly guideMesh: THREE.Mesh;
  private readonly guideMaterial: THREE.ShaderMaterial;
  private readonly startMarker: THREE.Mesh;
  private readonly endMarker: THREE.Mesh;
  private readonly cursor: THREE.Mesh;

  private readonly trailGeometry: THREE.BufferGeometry;
  private readonly trailPosition: THREE.BufferAttribute;
  private readonly trailColor: THREE.BufferAttribute;
  private readonly trailLine: THREE.Line;
  private trailCount = 0;
  private readonly lastTrailPoint = new THREE.Vector3();
  private lastSegmentDir: THREE.Vector3 | null = null;

  private running = false;
  private elapsedMs = 0;
  private accuracySum = 0;
  private accuracySamples = 0;
  private jerkTotal = 0;
  private jerkEvents = 0;
  private nearEndMs = 0;
  private lastResult: TraceResult | null = null;

  private readonly scratchLocal = new THREE.Vector3();
  private readonly scratchA = new THREE.Vector3();
  private readonly scratchB = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.group.name = 'trace-challenge';
    this.group.visible = false;
    this.group.renderOrder = 9;
    // A *sibling* of the pivot (both direct children of the scene), not a
    // child of it — every organ switch calls `pivot.clear()`, which removes
    // *all* of the pivot's children, not just the outgoing specimen mesh.
    // Something parented to the pivot at construction and never re-attached
    // is silently orphaned the first time the user changes specimens; this
    // was caught by trying exactly that and finding the guide/trail
    // rendered nothing after a single organ switch. syncToPivot() below
    // copies the pivot's transform onto this group every frame instead, so
    // it still tracks the specimen's rotate/move gestures without being a
    // scene-graph child that specimen-swap logic can sweep away.
    scene.add(this.group);

    this.curve = ladReferenceCurve();
    this.samples = this.curve.getSpacedPoints(GUIDE_SAMPLES).map((point, i) => ({
      point,
      t: i / GUIDE_SAMPLES,
    }));

    this.guideMaterial = flowMaterial();
    this.guideMesh = new THREE.Mesh(
      new THREE.TubeGeometry(this.curve, GUIDE_SAMPLES, GUIDE_RADIUS, 10, false),
      this.guideMaterial,
    );
    this.group.add(this.guideMesh);

    const markerGeometry = new THREE.SphereGeometry(1, 16, 12);
    this.startMarker = new THREE.Mesh(markerGeometry, pulseMaterial(GREEN));
    this.startMarker.position.copy(this.curve.getPointAt(0));
    this.startMarker.scale.setScalar(0.05);
    this.group.add(this.startMarker);

    this.endMarker = new THREE.Mesh(markerGeometry, pulseMaterial(AMBER));
    this.endMarker.position.copy(this.curve.getPointAt(1));
    this.endMarker.scale.setScalar(0.05);
    this.group.add(this.endMarker);

    this.cursor = new THREE.Mesh(markerGeometry, pulseMaterial(CYAN));
    this.cursor.scale.setScalar(0.032);
    this.cursor.visible = false;
    this.group.add(this.cursor);

    this.trailGeometry = new THREE.BufferGeometry();
    this.trailPosition = new THREE.BufferAttribute(new Float32Array(TRAIL_MAX_POINTS * 3), 3);
    this.trailColor = new THREE.BufferAttribute(new Float32Array(TRAIL_MAX_POINTS * 3), 3);
    this.trailGeometry.setAttribute('position', this.trailPosition);
    this.trailGeometry.setAttribute('color', this.trailColor);
    this.trailGeometry.setDrawRange(0, 0);
    this.trailLine = new THREE.Line(
      this.trailGeometry,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        // The reference LAD path is authored for the procedural coronary
        // tree, not sculpted to this GLB's own surface — depth-tested
        // against a textured heart model it can end up fully behind the
        // opaque mesh from some angles and simply never draw. This is a
        // floating guide overlay, not physically-occluded geometry, so it
        // should always render on top, the same way the reticle and region
        // highlights elsewhere in this app do.
        depthTest: false,
        linewidth: 3,
      }),
    );
    this.trailLine.frustumCulled = false;
    this.group.add(this.trailLine);
  }

  /** Copies the pivot's current transform onto this group so the guide path
   *  tracks the specimen's rotate/move gestures despite not being a scene
   *  graph child of it (see the constructor comment for why). Call once per
   *  frame, before update(), so worldToLocal() reflects the pivot's latest
   *  pose exactly — both are direct children of the same scene, so a copied
   *  transform is mathematically identical to true parentage. */
  syncToPivot(pivot: THREE.Object3D): void {
    this.group.position.copy(pivot.position);
    this.group.quaternion.copy(pivot.quaternion);
    this.group.scale.copy(pivot.scale);
  }

  get active(): boolean {
    return this.running;
  }

  get result(): TraceResult | null {
    return this.lastResult;
  }

  /** Live running accuracy (0–100), for the HUD while an attempt is in progress. */
  get liveAccuracyPct(): number {
    return this.accuracySamples > 0 ? Math.round((this.accuracySum / this.accuracySamples) * 100) : 0;
  }

  get liveElapsedMs(): number {
    return this.elapsedMs;
  }

  start(): void {
    this.running = true;
    this.elapsedMs = 0;
    this.accuracySum = 0;
    this.accuracySamples = 0;
    this.jerkTotal = 0;
    this.jerkEvents = 0;
    this.nearEndMs = 0;
    this.trailCount = 0;
    this.lastSegmentDir = null;
    this.lastResult = null;
    this.trailGeometry.setDrawRange(0, 0);
    this.group.visible = true;
    this.cursor.visible = false;
  }

  stop(): void {
    this.running = false;
    this.group.visible = false;
  }

  /**
   * @param fingerWorldPos tracked fingertip in world space, or null when no
   *   hand is visible
   * @param deltaMs milliseconds since the previous frame
   * @param nowSeconds a monotonically increasing clock, for the guide's flow
   *   animation
   */
  update(fingerWorldPos: THREE.Vector3 | null, deltaMs: number, nowSeconds: number): TraceResult | null {
    this.guideMaterial.uniforms.uTime!.value = nowSeconds;
    pulse(this.startMarker.material as THREE.MeshBasicMaterial, nowSeconds, 0);
    pulse(this.endMarker.material as THREE.MeshBasicMaterial, nowSeconds, 0.5);

    if (!this.running || !fingerWorldPos) {
      this.cursor.visible = false;
      return null;
    }

    this.scratchLocal.copy(fingerWorldPos);
    this.group.worldToLocal(this.scratchLocal);

    const nearest = this.nearestSample(this.scratchLocal);
    const distance = this.scratchLocal.distanceTo(nearest.point);
    const accuracy = clamp01(1 - distance / MAX_DEVIATION);

    this.cursor.visible = true;
    this.cursor.position.copy(this.scratchLocal);
    const cursorColor = distance < MAX_DEVIATION * 0.4 ? GREEN : distance < MAX_DEVIATION ? AMBER : RED;
    (this.cursor.material as THREE.MeshBasicMaterial).color.copy(cursorColor);

    this.elapsedMs += deltaMs;
    this.accuracySum += accuracy;
    this.accuracySamples++;
    this.pushTrailPoint(this.scratchLocal, cursorColor);

    if (nearest.t >= COMPLETION_T && distance < MAX_DEVIATION) {
      this.nearEndMs += deltaMs;
      if (this.nearEndMs >= COMPLETION_DWELL_MS) return this.finish();
    } else {
      this.nearEndMs = 0;
    }

    return null;
  }

  /** Ends the attempt immediately and scores whatever was traced so far —
   *  the manual escape hatch for when auto-completion doesn't trigger. */
  finish(): TraceResult {
    this.running = false;
    const accuracy = this.accuracySamples > 0 ? this.accuracySum / this.accuracySamples : 0;
    const smoothness = clamp01(1 - this.jerkTotal / JERK_BUDGET);
    const seconds = this.elapsedMs / 1000;
    const speed = clamp01(1 - Math.max(0, seconds - PAR_SECONDS) / PAR_SECONDS);
    const score = Math.round(((accuracy + smoothness + speed) / 3) * 100);

    const result: TraceResult = {
      score,
      accuracy: Math.round(accuracy * 100),
      smoothness: Math.round(smoothness * 100),
      speed: Math.round(speed * 100),
      timeMs: Math.round(this.elapsedMs),
      jerkEvents: this.jerkEvents,
    };
    this.lastResult = result;
    return result;
  }

  private nearestSample(point: THREE.Vector3): CurveSample {
    let best = this.samples[0]!;
    let bestDist = Infinity;
    for (const sample of this.samples) {
      const d = point.distanceToSquared(sample.point);
      if (d < bestDist) {
        bestDist = d;
        best = sample;
      }
    }
    return best;
  }

  private pushTrailPoint(point: THREE.Vector3, color: THREE.Color): void {
    if (this.trailCount > 0) {
      this.scratchA.copy(point).sub(this.lastTrailPoint);
      const segmentLength = this.scratchA.length();
      // Skip near-stationary jitter entirely — both from the trail (a dense
      // knot of points when the hand is nearly still looks worse than a
      // gap) and from the smoothness metric (a held-still hand shouldn't be
      // penalised for micro-jitter the way an actively wavering one should).
      if (segmentLength < 0.004) return;
      this.scratchA.normalize();

      if (this.lastSegmentDir) {
        const angle = THREE.MathUtils.radToDeg(this.scratchA.angleTo(this.lastSegmentDir));
        if (angle > JERK_ANGLE_DEG) {
          this.jerkTotal += (angle - JERK_ANGLE_DEG) / 30;
          this.jerkEvents++;
        }
      }
      this.lastSegmentDir = this.scratchB.copy(this.scratchA).clone();
    }

    if (this.trailCount >= TRAIL_MAX_POINTS) return; // cap reached — stop recording, keep scoring
    this.trailPosition.setXYZ(this.trailCount, point.x, point.y, point.z);
    this.trailColor.setXYZ(this.trailCount, color.r, color.g, color.b);
    this.trailCount++;
    this.trailPosition.needsUpdate = true;
    this.trailColor.needsUpdate = true;
    this.trailGeometry.setDrawRange(0, this.trailCount);
    this.lastTrailPoint.copy(point);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.guideMesh.geometry.dispose();
    this.guideMaterial.dispose();
    this.startMarker.geometry.dispose();
    (this.startMarker.material as THREE.Material).dispose();
    (this.endMarker.material as THREE.Material).dispose();
    (this.cursor.material as THREE.Material).dispose();
    this.trailGeometry.dispose();
    (this.trailLine.material as THREE.Material).dispose();
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function pulseMaterial(color: THREE.Color): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: color.clone(),
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    // See the trail material's comment — a floating guide marker, always on
    // top, not occluded by a specimen surface it isn't anatomically fitted to.
    depthTest: false,
  });
}

function pulse(material: THREE.MeshBasicMaterial, nowSeconds: number, phase: number): void {
  material.opacity = 0.55 + 0.4 * Math.sin((nowSeconds + phase) * 3.4);
}

/** The guide tube's "energy flowing along the vessel" look: a bright band
 *  sweeping along the tube's length (its UV.x, which THREE.TubeGeometry
 *  already lays out 0→1 along the curve) on a dim base glow — cheap, one
 *  sine per fragment, no textures. */
function flowMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: CYAN.clone() },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float band = fract(vUv.x * 1.0 - uTime * 0.35);
        float flow = smoothstep(0.35, 0.0, abs(band - 0.15));
        float glow = 0.22 + flow * 0.85;
        gl_FragColor = vec4(uColor * glow, glow * 0.8);
      }
    `,
    transparent: true,
    depthWrite: false,
    // Same reasoning as the trail and marker materials above.
    depthTest: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}
