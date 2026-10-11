import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  CHAMBER_CENTROIDS,
  FLOW_PATHS,
  VALVES,
  type ChamberId,
  type FlowPath,
  type ValveData,
  type ValveId,
} from '../anatomy/heartInteriorData';
import type { InteriorId } from '../segments';

// Right heart carries oxygen-poor blood, left heart oxygen-rich: the textbook
// blue/red convention, used for both the chamber casts and the moving blood.
const VENOUS = new THREE.Color('#3f7bff');
const ARTERIAL = new THREE.Color('#ff3b4e');
const CHAMBER_COLOUR: Record<ChamberId, THREE.Color> = {
  ra: new THREE.Color('#4a78ff'),
  rv: new THREE.Color('#2f56e0'),
  la: new THREE.Color('#ff5468'),
  lv: new THREE.Color('#e3233a'),
};
const SEPTUM_COLOUR = new THREE.Color('#ff9e8a');
const LEAFLET_COLOUR = new THREE.Color('#f4e6c8');
const GLOW = new THREE.Color('#29d9ff');

/** Particles per unit of path length, before the path's own weight. */
const PARTICLE_DENSITY = 90;

/**
 * The schematic inside of the heart: four chamber casts, the two septa, four
 * valves that open and close on the heartbeat, and blood moving through it all.
 *
 * The specimen itself is a surface with nothing inside, so the casts were built
 * offline — the shell voxelised, the enclosed cavity carved into chambers and
 * meshed with marching cubes — and ship as their own small model. The valves
 * and the blood are generated here. All of it lives in the pivot's space, so it
 * turns, slides and beats with the specimen.
 *
 * Shown only while the shell is see-through: {@link setReveal} fades it in.
 */
export class HeartInterior {
  readonly group = new THREE.Group();
  private readonly chambers = new Map<ChamberId, THREE.Mesh>();
  private readonly septa = new Map<string, THREE.Mesh>();
  private readonly valves = new Map<ValveId, Valve>();
  private readonly flow: Flow;
  private reveal = 0;
  private flowOn = false;
  private flowAmount = 0;
  private selected: InteriorId | null = null;
  private selectAmount = 0;

  static async load(url: string): Promise<HeartInterior> {
    const gltf = await new GLTFLoader().loadAsync(url);
    return new HeartInterior(gltf.scene);
  }

  private constructor(source: THREE.Object3D) {
    this.group.name = 'heart-interior';
    this.group.visible = false;

    source.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const name = child.name.replace(/[^a-z]/gi, '').toLowerCase();
      const geometry = child.geometry as THREE.BufferGeometry;
      geometry.computeVertexNormals();
      if (name in CHAMBER_COLOUR) {
        const id = name as ChamberId;
        const mesh = new THREE.Mesh(geometry, castMaterial(CHAMBER_COLOUR[id]));
        mesh.renderOrder = 1;
        // Scale about the chamber's own centre when it beats.
        const c = new THREE.Vector3(...CHAMBER_CENTROIDS[id]);
        mesh.userData.centre = c;
        this.chambers.set(id, mesh);
        this.group.add(mesh);
      } else if (name === 'ivs' || name === 'ias') {
        const mesh = new THREE.Mesh(geometry, castMaterial(SEPTUM_COLOUR));
        mesh.renderOrder = 2;
        this.septa.set(name, mesh);
        this.group.add(mesh);
      }
    });

    for (const [id, data] of Object.entries(VALVES) as Array<[ValveId, ValveData]>) {
      const valve = new Valve(data);
      this.valves.set(id, valve);
      this.group.add(valve.group);
    }

    this.flow = new Flow(FLOW_PATHS);
    this.group.add(this.flow.points);
  }

  /** 0 hides the interior, 1 shows it fully. Follows the shell's x-ray fade. */
  setReveal(amount: number): void {
    this.reveal = amount;
  }

  setFlow(on: boolean): void {
    this.flowOn = on;
  }

  get flowing(): boolean {
    return this.flowOn;
  }

  /** Light up one interior structure, or null for none. */
  select(id: InteriorId | null): void {
    if (id !== this.selected) this.selectAmount = 0;
    this.selected = id;
  }

  /**
   * @param phase position in the cardiac cycle, 0..1 (0 = first heart sound)
   * @param delta seconds since the last frame, already scaled for slow motion
   */
  update(delta: number, phase: number, time: number): void {
    const visible = this.reveal > 0.01;
    this.group.visible = visible;
    this.flowAmount += ((this.flowOn ? 1 : 0) - this.flowAmount) * Math.min(1, 4 * delta);
    if (!visible) return;
    this.selectAmount = Math.min(1, this.selectAmount + 3 * delta);

    const pulse = 0.65 + 0.35 * Math.sin(time * 4);
    const focus = this.selected !== null ? this.selectAmount : 0;

    // Ventricles squeeze in systole; the atria squeeze late in diastole (the
    // "atrial kick"). Small amplitudes: enough to read as a beat, not a wobble.
    const systole = bump(phase, 0.05, 0.36);
    const atrialKick = bump(phase, 0.8, 0.98);
    for (const [id, mesh] of this.chambers) {
      const ventricle = id === 'rv' || id === 'lv';
      const s = 1 - (ventricle ? 0.07 * systole : 0.06 * atrialKick);
      const c = mesh.userData.centre as THREE.Vector3;
      mesh.scale.setScalar(s);
      mesh.position.copy(c).multiplyScalar(1 - s);

      const material = mesh.material as THREE.MeshStandardMaterial;
      const isSelected = this.selected === id;
      // With something else in focus the casts step back so it stands out.
      const base = isSelected ? 0.62 : this.selected ? 0.16 : 0.42;
      material.opacity = base * this.reveal;
      material.emissiveIntensity = isSelected ? 0.25 + 0.55 * pulse * focus : 0.12;
    }
    for (const [id, mesh] of this.septa) {
      const material = mesh.material as THREE.MeshStandardMaterial;
      const isSelected = this.selected === id;
      material.opacity = (isSelected ? 0.85 : this.selected ? 0.12 : 0.3) * this.reveal;
      material.emissive.copy(isSelected ? GLOW : SEPTUM_COLOUR);
      material.emissiveIntensity = isSelected ? 0.35 + 0.5 * pulse * focus : 0.12;
    }
    for (const [id, valve] of this.valves) {
      valve.update(phase, this.reveal, this.selected === id ? pulse * focus : 0, this.selected !== null && this.selected !== id);
    }
    this.flow.update(delta, phase, this.reveal * this.flowAmount);
  }

  dispose(): void {
    this.group.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Points) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    });
    this.group.removeFromParent();
  }
}

function castMaterial(colour: THREE.Color): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: colour,
    emissive: colour,
    emissiveIntensity: 0.12,
    roughness: 0.35,
    metalness: 0,
    transparent: true,
    opacity: 0,
    // The casts overlap one another and the moving blood inside them, so none
    // of them may hide what is behind it.
    depthWrite: false,
  });
}

/** Smooth 0→1→0 over [start, end] of the cycle. */
function bump(phase: number, start: number, end: number): number {
  if (phase <= start || phase >= end) return 0;
  return Math.sin((Math.PI * (phase - start)) / (end - start));
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * How open each valve is through the cycle. The heart sounds are the valves
 * closing: S1 (phase ≈ 0.05) is the atrioventricular valves shutting as the
 * ventricles start to squeeze; S2 (≈ 0.32) is the semilunar valves shutting as
 * they relax. Between the two, the semilunar valves stand open.
 */
export function valveOpening(kind: 'av' | 'semilunar', phase: number): number {
  const ejecting = smoothstep(0.07, 0.12, phase) * (1 - smoothstep(0.27, 0.32, phase));
  if (kind === 'semilunar') return ejecting;
  const shut = smoothstep(0.01, 0.05, phase) * (1 - smoothstep(0.36, 0.42, phase));
  return 1 - shut;
}

/**
 * A valve: an annulus with two or three leaflets hinged on it. Closed, the
 * leaflets meet in the middle, billowing slightly against the back-pressure;
 * open, they swing downstream about their hinge. Built in a local frame where
 * +Y is the direction of flow, then turned to face along the valve's normal.
 */
class Valve {
  readonly group = new THREE.Group();
  private readonly kind: 'av' | 'semilunar';
  private readonly hinges: Array<{ pivot: THREE.Object3D; axis: THREE.Vector3 }> = [];
  private readonly leafletMaterial: THREE.MeshStandardMaterial;
  private readonly ringMaterial: THREE.MeshStandardMaterial;

  constructor(data: ValveData) {
    this.kind = data.leaflets === 2 || data.radius > 0.1 ? 'av' : 'semilunar';
    this.group.position.set(...data.centre);
    this.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...data.normal).normalize());
    this.group.renderOrder = 3;

    this.leafletMaterial = new THREE.MeshStandardMaterial({
      color: LEAFLET_COLOUR,
      emissive: GLOW,
      emissiveIntensity: 0,
      roughness: 0.55,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
    });
    this.ringMaterial = new THREE.MeshStandardMaterial({
      color: LEAFLET_COLOUR,
      emissive: GLOW,
      emissiveIntensity: 0,
      roughness: 0.5,
      transparent: true,
      opacity: 0,
    });

    const R = data.radius;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R, R * 0.07, 8, 48), this.ringMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.renderOrder = 3;
    this.group.add(ring);

    const n = data.leaflets;
    // The mitral's two leaflets are unequal: the anterior is the larger.
    const spans = n === 2 ? [Math.PI * 1.1, Math.PI * 0.9] : [1, 1, 1].map(() => (2 * Math.PI) / 3);
    let start = n === 2 ? 0 : Math.PI / 6;
    for (let k = 0; k < n; k++) {
      const span = spans[k]!;
      const mid = start + span / 2;
      const hinge = new THREE.Vector3(R * Math.cos(mid), 0, R * Math.sin(mid));
      const pivot = new THREE.Object3D();
      pivot.position.copy(hinge);
      const leaflet = new THREE.Mesh(leafletGeometry(R, start, span, hinge, n === 2 ? 0.32 : 0.22), this.leafletMaterial);
      leaflet.renderOrder = 3;
      pivot.add(leaflet);
      this.group.add(pivot);
      // Tangent to the ring at the hinge: the axis the leaflet swings about.
      this.hinges.push({ pivot, axis: new THREE.Vector3(-Math.sin(mid), 0, Math.cos(mid)) });
      start += span;
    }
  }

  update(phase: number, reveal: number, glow: number, dimmed: boolean): void {
    const open = valveOpening(this.kind, phase);
    // Swinging by a negative angle about the tangent carries the free edge
    // downstream (+Y).
    const angle = -open * (this.kind === 'av' ? 1.2 : 1.05);
    for (const { pivot, axis } of this.hinges) pivot.quaternion.setFromAxisAngle(axis, angle);
    const opacity = (dimmed ? 0.35 : 0.95) * reveal;
    this.leafletMaterial.opacity = opacity;
    this.ringMaterial.opacity = opacity;
    this.leafletMaterial.emissiveIntensity = 0.9 * glow;
    this.ringMaterial.emissiveIntensity = 0.2 + 1.4 * glow;
  }
}

/**
 * One leaflet: a sector of the annulus from the rim to almost the centre,
 * narrowing toward its free edge and billowing upstream (−Y) in the middle.
 * Vertices are relative to the hinge so the leaflet swings about it.
 */
function leafletGeometry(R: number, start: number, span: number, hinge: THREE.Vector3, billow: number): THREE.BufferGeometry {
  const radial = 6;
  const around = 10;
  const positions: number[] = [];
  const indices: number[] = [];
  const gap = 0.04;
  for (let i = 0; i <= radial; i++) {
    const u = i / radial; // 0 at the rim, 1 at the free edge
    const rho = R * (1 - 0.94 * u);
    for (let j = 0; j <= around; j++) {
      const t = j / around;
      const theta = start + gap + (span - 2 * gap) * t;
      const sag = -billow * R * Math.sin(Math.PI * Math.min(1, u * 1.15)) * Math.sin(Math.PI * t);
      positions.push(rho * Math.cos(theta) - hinge.x, sag, rho * Math.sin(theta) - hinge.z);
    }
  }
  const row = around + 1;
  for (let i = 0; i < radial; i++) {
    for (let j = 0; j < around; j++) {
      const a = i * row + j;
      indices.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Blood as glowing particles streaming along the circulation's paths, faster
 * while the ventricles eject and slower in diastole, so the flow pulses with
 * the beat. Each particle keeps a fixed offset from the path's centreline,
 * scaled to the lumen there, so the stream fills a vessel instead of tracing
 * a line. Positions are written on the CPU each frame — a few hundred points.
 */
class Flow {
  readonly points: THREE.Points;
  private readonly paths: Array<{ samples: THREE.Vector3[]; radii: number[]; length: number }>;
  private readonly particles: Array<{ path: number; s: number; ox: number; oy: number; oz: number; speed: number }> = [];
  private readonly positions: Float32Array;
  private readonly material: THREE.ShaderMaterial;
  private readonly scratch = new THREE.Vector3();

  constructor(source: FlowPath[]) {
    this.paths = source.map((p) => {
      const curve = new THREE.CatmullRomCurve3(p.points.map((q) => new THREE.Vector3(...q)));
      const length = curve.getLength();
      const n = Math.max(16, Math.round(length * 120));
      const samples = curve.getSpacedPoints(n);
      // Lumen width resampled onto the evenly spaced samples.
      const radii = samples.map((_, i) => p.radii[Math.round((i / n) * (p.radii.length - 1))]!);
      return { samples, radii, length };
    });

    const colours: number[] = [];
    source.forEach((p, path) => {
      const count = Math.round(this.paths[path]!.length * PARTICLE_DENSITY * p.weight);
      const colour = p.kind === 'venous' ? VENOUS : ARTERIAL;
      for (let i = 0; i < count; i++) {
        // A random direction in the unit ball, biased to the middle of the
        // vessel where real flow is fastest.
        const r = Math.pow(Math.random(), 0.7);
        const a = Math.random() * Math.PI * 2;
        const b = Math.acos(2 * Math.random() - 1);
        this.particles.push({
          path,
          s: Math.random(),
          ox: r * Math.sin(b) * Math.cos(a),
          oy: r * Math.sin(b) * Math.sin(a),
          oz: r * Math.cos(b),
          speed: 0.85 + 0.3 * Math.random(),
        });
        const shade = 0.75 + 0.5 * Math.random();
        colours.push(colour.r * shade, colour.g * shade, colour.b * shade);
      }
    });

    this.positions = new Float32Array(this.particles.length * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('colour', new THREE.Float32BufferAttribute(colours, 3));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 }, uSize: { value: 34 } },
      vertexShader: `
        attribute vec3 colour;
        varying vec3 vColour;
        uniform float uSize;
        void main() {
          vColour = colour;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // Clamped: a particle passing right by the camera would otherwise ask
          // for a point thousands of pixels wide.
          gl_PointSize = clamp(uSize / -mv.z, 1.0, 20.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vColour;
        uniform float uOpacity;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.05, d) * uOpacity;
          gl_FragColor = vec4(vColour * a * 1.6, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.renderOrder = 4;
    this.points.frustumCulled = false;
  }

  update(delta: number, phase: number, amount: number): void {
    this.points.visible = amount > 0.01;
    this.material.uniforms.uOpacity!.value = amount;
    if (!this.points.visible) return;
    // Units per second: a slow diastolic drift, a surge while blood is ejected.
    const surge = 0.16 + 0.75 * valveOpening('semilunar', phase) + 0.18 * valveOpening('av', phase);
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i]!;
      const path = this.paths[p.path]!;
      p.s += (surge * p.speed * delta) / path.length;
      if (p.s >= 1) p.s -= 1;
      const f = p.s * (path.samples.length - 1);
      const k = Math.floor(f);
      const a = path.samples[k]!;
      const b = path.samples[Math.min(k + 1, path.samples.length - 1)]!;
      const r = path.radii[k]! * 0.9;
      this.scratch.lerpVectors(a, b, f - k);
      this.positions[i * 3] = this.scratch.x + p.ox * r;
      this.positions[i * 3 + 1] = this.scratch.y + p.oy * r;
      this.positions[i * 3 + 2] = this.scratch.z + p.oz * r;
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
}
