import * as THREE from 'three';
import type { HandLandmarks } from '../../gesture/types';
import { LM } from '../../gesture/types';
import { buildNavVessel, type NavVessel } from '../coronaryModel';
import type { CoronaryCase } from '../cases';

/**
 * Catheter/guidewire navigation through the coronary lumen.
 *
 * Replaces the earlier "Steady Hand" trace challenge, which scored a
 * fingertip traced along the *outside* of a vessel — a motion that maps to
 * no real clinical action. This scores the thing an operator actually does:
 * advance a wire down the true lumen, staying centred, without touching the
 * wall, until it crosses the lesion. Wall contact is a real geometric event
 * here, not a metaphor — the steerable offset is clamped against the same
 * arc-length radius profile that geometrically narrows the vessel at the
 * stenosis (see coronaryModel.ts), so squeezing past the lesion is measurably
 * harder than cruising the healthy proximal segment.
 *
 * Rendering lives on its own THREE.Layers channel (see NAV_LAYER) so the
 * dedicated nav-vessel mesh this class builds is only ever drawn by its own
 * camera — the split-view "catheter" pane — never by the main scene camera,
 * which keeps showing whatever specimen is actually loaded (GLB scan or
 * procedural tree) undisturbed. The two panes stay visually in sync via a
 * marker (rendered on the *default* layer, so both cameras see it) that
 * tracks the same curve at the same parameter t.
 */

const NAV_LAYER = 2;

// Hand-position → control-signal mapping. Comfortable bands well inside the
// webcam frame, not the literal edges, so full deflection doesn't require an
// awkward hand position.
const Y_ADVANCE_LOW = 0.16; // hand near the top of frame → fully advanced
const Y_ADVANCE_HIGH = 0.84; // hand near the bottom → fully withdrawn
const X_STEER_LOW = 0.28;
const X_STEER_HIGH = 0.72;
const Z_STEER_RANGE = 0.16;

// Exponential smoothing time constants — enough to soak up webcam/tracking
// jitter without feeling laggy to steer.
const ADVANCE_SMOOTH_MS = 220;
const STEER_SMOOTH_MS = 140;

// A steering deflection can reach this far past the "safe" radius before
// being clamped — past DEFLECT_REACH is the same as bottoming out, which is
// what makes wall contact a real, reachable event rather than something the
// clamp always prevents outright.
const SAFE_FRACTION = 0.82;
const DEFLECT_REACH = 1.25;

const LOOKAHEAD_T = 0.035;

const JERK_ANGLE_DEG = 26;
const JERK_BUDGET = 10;

const PAR_SECONDS = 20;
const COMPLETION_DWELL_MS = 500;
// How far past the lesion counts as "crossed it" — the real clinical action
// is crossing the stenosis, not merely reaching its centre.
const LESION_CROSS_MARGIN = 0.08;
const NO_LESION_COMPLETION_T = 0.94;

const CYAN = new THREE.Color(0x34e3ff);
const RED = new THREE.Color(0xff5a5a);
const AMBER = new THREE.Color(0xffce6a);

export interface CatheterResult {
  score: number;
  accuracy: number;
  smoothness: number;
  speed: number;
  timeMs: number;
  wallContacts: number;
}

export class CatheterNav {
  readonly camera: THREE.PerspectiveCamera;
  private readonly headlamp: THREE.PointLight;
  private readonly rig = new THREE.Group();
  private readonly marker: THREE.Mesh;
  private readonly guideMesh: THREE.Mesh;
  private readonly guideMaterial: THREE.ShaderMaterial;

  private vessel: NavVessel | undefined;
  private completionT = NO_LESION_COMPLETION_T;
  private missionLabel = 'LAD';

  private running = false;
  private t = 0;
  private steerN = 0;
  private steerB = 0;
  private wallContact = false;

  private elapsedMs = 0;
  private accuracySum = 0;
  private accuracySamples = 0;
  private jerkTotal = 0;
  private wallContactEvents = 0;
  private dwellMs = 0;
  private lastResult: CatheterResult | null = null;
  private readonly lastSteer = new THREE.Vector2();
  private hasLastSteer = false;

  private readonly scratchPoint = new THREE.Vector3();
  private readonly scratchTangent = new THREE.Vector3();
  private readonly scratchN = new THREE.Vector3();
  private readonly scratchB = new THREE.Vector3();
  private readonly scratchOffset = new THREE.Vector3();
  private readonly scratchLook = new THREE.Vector3();
  private readonly scratchWorldLook = new THREE.Vector3();
  private readonly scratchLocalUp = new THREE.Vector3();
  private readonly scratchInvQuat = new THREE.Quaternion();
  private readonly scratchSteer = new THREE.Vector2();
  private readonly worldUp = new THREE.Vector3(0, 1, 0);

  constructor(scene: THREE.Scene) {
    this.rig.name = 'catheter-nav-rig';
    this.rig.visible = false;
    // A sibling of the pivot, transform-synced every frame rather than a
    // true child of it — pivot.clear() on every specimen switch would
    // otherwise sweep this away (see TraceChallenge's original writeup of
    // the same gotcha, now retired).
    scene.add(this.rig);

    this.camera = new THREE.PerspectiveCamera(100, 1, 0.005, 10);
    this.camera.layers.disableAll();
    this.camera.layers.enable(NAV_LAYER);
    this.rig.add(this.camera);

    // WebGLRenderer only collects lights whose own layer matches the
    // rendering camera's — the scene's main lighting rig sits on the default
    // layer, which this camera deliberately doesn't have, so without an
    // explicit layer tag here the interior would render pitch black. A dim
    // ambient fill alongside the headlamp keeps the tube from going fully
    // black just past the headlamp's falloff.
    this.headlamp = new THREE.PointLight(0xfff0e0, 6, 0, 1.4);
    this.headlamp.layers.set(NAV_LAYER);
    this.camera.add(this.headlamp);

    const navAmbient = new THREE.AmbientLight(0x40261e, 0.9);
    navAmbient.layers.set(NAV_LAYER);
    this.rig.add(navAmbient);

    const markerGeo = new THREE.SphereGeometry(1, 16, 12);
    this.marker = new THREE.Mesh(markerGeo, pulseMaterial(CYAN));
    this.marker.scale.setScalar(0.05);
    this.marker.visible = false;
    this.rig.add(this.marker);

    this.guideMaterial = flowMaterial();
    this.guideMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.guideMaterial);
    this.guideMesh.visible = false;
    this.rig.add(this.guideMesh);
  }

  /** Copies the pivot's transform onto the rig — see TraceChallenge's
   *  original comment for why this can't just be true scene-graph parentage. */
  syncToPivot(pivot: THREE.Object3D): void {
    this.rig.position.copy(pivot.position);
    this.rig.quaternion.copy(pivot.quaternion);
    this.rig.scale.copy(pivot.scale);
  }

  /** Called after every specimen swap — rebuilds the dedicated nav geometry
   *  for whichever vessel this case's mission targets (the lesion vessel, or
   *  the LAD when the case is a clean baseline). */
  onSpecimenLoaded(def: CoronaryCase | undefined): void {
    this.stop();
    this.disposeVessel();

    if (!def) {
      this.vessel = undefined;
      return;
    }

    const region = def.lesion?.vessel ?? 'LAD';
    this.vessel = buildNavVessel(def, region);
    this.vessel.mesh.layers.set(NAV_LAYER);
    this.rig.add(this.vessel.mesh);
    if (this.vessel.stenosisMesh) {
      this.vessel.stenosisMesh.layers.set(NAV_LAYER);
      this.rig.add(this.vessel.stenosisMesh);
    }

    this.completionT = def.lesion
      ? Math.min(0.98, def.lesion.at + LESION_CROSS_MARGIN)
      : NO_LESION_COMPLETION_T;
    this.missionLabel = region;

    this.guideMesh.geometry.dispose();
    this.guideMesh.geometry = new THREE.TubeGeometry(this.vessel.curve, 96, 0.016, 8, false);
  }

  get active(): boolean {
    return this.running;
  }

  get result(): CatheterResult | null {
    return this.lastResult;
  }

  get ready(): boolean {
    return this.vessel !== undefined;
  }

  get vesselLabel(): string {
    return this.missionLabel;
  }

  get liveProgressPct(): number {
    return Math.round(this.t * 100);
  }

  get liveAccuracyPct(): number {
    return this.accuracySamples > 0 ? Math.round((this.accuracySum / this.accuracySamples) * 100) : 0;
  }

  get liveElapsedMs(): number {
    return this.elapsedMs;
  }

  get liveWallContact(): boolean {
    return this.wallContact;
  }

  get liveWallContacts(): number {
    return this.wallContactEvents;
  }

  start(): void {
    if (!this.vessel) return;
    this.running = true;
    this.t = 0;
    this.steerN = 0;
    this.steerB = 0;
    this.wallContact = false;
    this.elapsedMs = 0;
    this.accuracySum = 0;
    this.accuracySamples = 0;
    this.jerkTotal = 0;
    this.wallContactEvents = 0;
    this.hasLastSteer = false;
    this.dwellMs = 0;
    this.lastResult = null;
    this.rig.visible = true;
    this.marker.visible = true;
    this.guideMesh.visible = true;
  }

  stop(): void {
    this.running = false;
    this.rig.visible = false;
    this.marker.visible = false;
    this.guideMesh.visible = false;
  }

  /**
   * @param hand primary tracked hand, or undefined when none is visible —
   *   navigation freezes in place rather than penalising a momentary loss of
   *   tracking.
   */
  update(hand: HandLandmarks | undefined, deltaMs: number, nowSeconds: number): CatheterResult | null {
    this.guideMaterial.uniforms.uTime!.value = nowSeconds;
    if (!this.running || !this.vessel) return null;

    if (hand) {
      const tip = hand[LM.INDEX_TIP]!;
      const targetT = mapRange(tip.y, Y_ADVANCE_LOW, Y_ADVANCE_HIGH, 1, 0);
      const targetN = mapRange(1 - tip.x, X_STEER_LOW, X_STEER_HIGH, -1, 1);
      const targetB = clamp(tip.z / Z_STEER_RANGE, -1, 1);

      this.t = damp(this.t, targetT, ADVANCE_SMOOTH_MS, deltaMs);
      this.steerN = damp(this.steerN, targetN, STEER_SMOOTH_MS, deltaMs);
      this.steerB = damp(this.steerB, targetB, STEER_SMOOTH_MS, deltaMs);
      this.elapsedMs += deltaMs;
    }

    this.vessel.curve.getPointAt(this.t, this.scratchPoint);
    this.vessel.curve.getTangentAt(this.t, this.scratchTangent).normalize();
    // The curve lives in rig-local (pivot-normalised) space, but `worldUp` is
    // a world-space reference — rotate it into local space first via the
    // rig's inverse orientation, so steering still reads as "up/down" even
    // while the specimen itself is rotated (mouse-orbited) away from level.
    this.scratchInvQuat.copy(this.rig.quaternion).invert();
    this.scratchLocalUp.copy(this.worldUp).applyQuaternion(this.scratchInvQuat);
    this.buildFrame(this.scratchTangent, this.scratchLocalUp, this.scratchN, this.scratchB);

    const radius = this.vessel.radiusAt(this.t);
    const safe = radius * SAFE_FRACTION;
    this.scratchOffset
      .copy(this.scratchN)
      .multiplyScalar(this.steerN * radius * DEFLECT_REACH)
      .addScaledVector(this.scratchB, this.steerB * radius * DEFLECT_REACH);
    const mag = this.scratchOffset.length();
    const wasContact = this.wallContact;
    this.wallContact = mag > safe;
    if (this.wallContact && !wasContact) this.wallContactEvents++;
    if (mag > safe) this.scratchOffset.setLength(safe);

    this.camera.position.copy(this.scratchPoint).add(this.scratchOffset);
    this.vessel.curve.getPointAt(Math.min(1, this.t + LOOKAHEAD_T), this.scratchLook);
    // lookAt expects a world-space target (it corrects for the parent's
    // rotation internally) — the target above is rig-local, so it has to be
    // transformed before the call, same reasoning as the up vector.
    this.rig.localToWorld(this.scratchWorldLook.copy(this.scratchLook));
    this.camera.up.copy(this.worldUp);
    this.camera.lookAt(this.scratchWorldLook);

    this.marker.position.copy(this.scratchPoint);
    const markerColor = this.wallContact ? RED : this.accuracyOf(mag, safe) > 0.7 ? CYAN : AMBER;
    (this.marker.material as THREE.MeshBasicMaterial).color.copy(markerColor);
    pulse(this.marker.material as THREE.MeshBasicMaterial, nowSeconds, 0);

    if (!hand) return null;

    const accuracy = this.accuracyOf(mag, safe);
    this.accuracySum += accuracy;
    this.accuracySamples++;

    this.scratchSteer.set(this.steerN, this.steerB);
    this.trackJerk(this.scratchSteer);

    const crossedLesion = this.t >= this.completionT;
    if (crossedLesion && !this.wallContact) {
      this.dwellMs += deltaMs;
      if (this.dwellMs >= COMPLETION_DWELL_MS) return this.finish();
    } else {
      this.dwellMs = 0;
    }

    return null;
  }

  finish(): CatheterResult {
    this.running = false;
    const accuracy = this.accuracySamples > 0 ? this.accuracySum / this.accuracySamples : 0;
    const smoothness = clamp01(1 - this.jerkTotal / JERK_BUDGET);
    const seconds = this.elapsedMs / 1000;
    const speed = clamp01(1 - Math.max(0, seconds - PAR_SECONDS) / PAR_SECONDS);
    const score = Math.round(((accuracy + smoothness + speed) / 3) * 100);

    const result: CatheterResult = {
      score,
      accuracy: Math.round(accuracy * 100),
      smoothness: Math.round(smoothness * 100),
      speed: Math.round(speed * 100),
      timeMs: Math.round(this.elapsedMs),
      wallContacts: this.wallContactEvents,
    };
    this.lastResult = result;
    return result;
  }

  private accuracyOf(mag: number, safe: number): number {
    return safe > 0 ? clamp01(1 - mag / safe) : 1;
  }

  private trackJerk(steer: THREE.Vector2): void {
    if (steer.length() < 0.08) return;
    if (this.hasLastSteer) {
      const dot = clamp(steer.dot(this.lastSteer) / (steer.length() * this.lastSteer.length() || 1), -1, 1);
      const angleDeg = THREE.MathUtils.radToDeg(Math.acos(dot));
      if (angleDeg > JERK_ANGLE_DEG) this.jerkTotal += (angleDeg - JERK_ANGLE_DEG) / 40;
    }
    this.lastSteer.copy(steer);
    this.hasLastSteer = true;
  }

  /** Stable steering basis: up crossed with the tangent, rather than the
   *  curve's own Frenet frame — the Frenet frame is continuous along the
   *  curve but has no relation to "up", so steering left/right would read as
   *  an arbitrary rolled direction at some points along a bendy vessel. This
   *  is an approximation (not parallel-transported), which is fine for a
   *  stylised steering control and far more robust than fighting frame twist. */
  private buildFrame(tangent: THREE.Vector3, up: THREE.Vector3, outN: THREE.Vector3, outB: THREE.Vector3): void {
    outN.crossVectors(up, tangent);
    if (outN.lengthSq() < 1e-6) outN.set(1, 0, 0).cross(tangent);
    outN.normalize();
    outB.crossVectors(tangent, outN).normalize();
  }

  private disposeVessel(): void {
    if (!this.vessel) return;
    this.vessel.mesh.geometry.dispose();
    (this.vessel.mesh.material as THREE.Material).dispose();
    this.rig.remove(this.vessel.mesh);
    if (this.vessel.stenosisMesh) {
      this.vessel.stenosisMesh.geometry.dispose();
      (this.vessel.stenosisMesh.material as THREE.Material).dispose();
      this.rig.remove(this.vessel.stenosisMesh);
    }
    this.vessel = undefined;
  }

  dispose(): void {
    this.stop();
    this.disposeVessel();
    this.rig.removeFromParent();
    this.marker.geometry.dispose();
    (this.marker.material as THREE.Material).dispose();
    this.guideMesh.geometry.dispose();
    this.guideMaterial.dispose();
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

function mapRange(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  const frac = clamp((v - inMin) / (inMax - inMin), 0, 1);
  return outMin + frac * (outMax - outMin);
}

/** Framerate-independent exponential smoothing toward `target` over `tauMs`. */
function damp(current: number, target: number, tauMs: number, deltaMs: number): number {
  const alpha = 1 - Math.exp(-deltaMs / tauMs);
  return current + (target - current) * alpha;
}

function pulseMaterial(color: THREE.Color): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: color.clone(),
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
}

function pulse(material: THREE.MeshBasicMaterial, nowSeconds: number, phase: number): void {
  material.opacity = 0.55 + 0.4 * Math.sin((nowSeconds + phase) * 3.4);
}

/** Same "energy flowing along the vessel" look as the retired trace guide. */
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
        float glow = 0.18 + flow * 0.8;
        gl_FragColor = vec4(uColor * glow, glow * 0.7);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}
