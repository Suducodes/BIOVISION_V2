import * as THREE from 'three';
import type { CoronaryCase, Lesion, RegionId } from './cases';

/**
 * Procedural coronary tree.
 *
 * The platform must be demonstrable before any patient-derived GLB has been
 * dropped into public/models/coronary/, so the challenge layer ships with a
 * parametric arterial tree it can build in the browser. It is not a stand-in
 * placeholder mesh: the vessels follow the real epicardial courses (anterior
 * interventricular groove for the LAD, left AV groove for the LCX, right AV
 * groove for the RCA), the lumen radius is a function of arc length so a
 * stenosis is *geometrically* narrowed rather than merely coloured in, and
 * Case 3 re-routes the RCA ostium to the left sinus with an interarterial
 * course. That means every challenge objective — hover identification,
 * lesion location, severity grading — is scoreable with or without a GLB.
 *
 * When a real GLB *is* present, the same curves are reused to generate
 * invisible hover proxies wherever the asset's meshes are not already named
 * after the arteries (see {@link buildRegionProxies}).
 */

/** Named vessel meshes the challenge layer can bind regions to. */
export interface CoronaryTree {
  root: THREE.Group;
  /** Display meshes keyed by the region they represent. */
  meshes: Map<RegionId, THREE.Mesh[]>;
  /** Coarse raycast-only stand-ins for the same regions — see {@link COLLIDER}. */
  colliders: Map<RegionId, THREE.Mesh[]>;
  radius: number;
}

/**
 * Collider resolution.
 *
 * Hover detection raycasts every rendered frame, and `THREE.Raycaster` has no
 * acceleration structure: once the ray clears a mesh's bounding sphere it tests
 * every triangle. Pointing at a display-resolution vessel therefore cost ~1.3 ms
 * per frame — more than the entire scene render — and a patient-derived
 * segmentation at 234k triangles would have been far worse.
 *
 * So identification raycasts against these instead: same centrelines, ~320
 * triangles per vessel, never drawn. Two orders of magnitude cheaper, and the
 * hit is identical at the tolerance a fingertip can actually hold.
 */
const COLLIDER = { tubular: 20, radial: 8 } as const;

/** Slightly fatter than the artery it stands for, to forgive fingertip jitter. */
const COLLIDER_RADIUS = 0.055;

/** Invisible to the renderer (`material.visible`), still hit by the raycaster. */
function colliderMaterial(): THREE.Material {
  return new THREE.MeshBasicMaterial({ visible: false });
}

function colliderMesh(
  geometry: THREE.BufferGeometry,
  region: RegionId,
  label: string,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, colliderMaterial());
  mesh.name = label;
  mesh.userData.surgilearnRegion = region;
  // `material.visible` rather than `object.visible`: the renderer skips it
  // either way, but only the former is guaranteed to leave it raycastable.
  mesh.frustumCulled = false;
  return mesh;
}

type Pt = [number, number, number];

// --- Vessel centrelines ----------------------------------------------------
// Coordinates are in a heart-sized frame roughly spanning x,y ∈ [-1, 1] with
// +x = patient's left (screen right in the anterior view), +y = superior,
// +z = anterior (toward the camera).

const LM_BIFURCATION: Pt = [0.22, 0.42, 0.1];

const LAD_PATH: Pt[] = [
  [0.06, 0.56, 0.0],
  LM_BIFURCATION,
  [0.26, 0.2, 0.24],
  [0.22, -0.1, 0.3],
  [0.14, -0.42, 0.26],
  [0.05, -0.7, 0.16],
  [-0.02, -0.88, 0.05],
];

const LCX_PATH: Pt[] = [
  [0.06, 0.56, 0.0],
  LM_BIFURCATION,
  [0.4, 0.34, -0.02],
  [0.56, 0.14, -0.18],
  [0.58, -0.12, -0.3],
  [0.46, -0.36, -0.34],
];

const RCA_PATH: Pt[] = [
  [-0.06, 0.55, 0.06],
  [-0.28, 0.44, 0.12],
  [-0.48, 0.24, 0.02],
  [-0.54, -0.04, -0.12],
  [-0.44, -0.3, -0.26],
  [-0.26, -0.48, -0.34],
];

/**
 * Anomalous RCA: ostium in the LEFT coronary sinus, then an interarterial
 * course back across the midline between the aorta and pulmonary trunk before
 * it reaches its normal position in the right AV groove. This is the segment
 * that gets compressed during exertion.
 */
const RCA_ANOMALOUS_PATH: Pt[] = [
  [0.11, 0.57, 0.02],
  [0.02, 0.61, -0.1],
  [-0.14, 0.56, -0.12],
  [-0.34, 0.4, -0.02],
  [-0.52, 0.18, 0.0],
  [-0.54, -0.06, -0.14],
  [-0.42, -0.32, -0.28],
  [-0.26, -0.48, -0.34],
];

// Side branches. Purely cosmetic — they make the tree read as a coronary tree
// rather than three lines, and they are bound to their parent vessel's region
// so hovering a diagonal still identifies the LAD.
const BRANCHES: Array<{ parent: RegionId; path: Pt[]; radius: number }> = [
  {
    parent: 'LAD',
    path: [
      [0.245, 0.11, 0.26],
      [0.42, -0.02, 0.2],
      [0.56, -0.2, 0.1],
    ],
    radius: 0.022,
  },
  {
    parent: 'LAD',
    path: [
      [0.19, -0.24, 0.29],
      [0.34, -0.4, 0.2],
      [0.44, -0.6, 0.08],
    ],
    radius: 0.017,
  },
  {
    parent: 'LCX',
    path: [
      [0.55, 0.16, -0.17],
      [0.66, -0.02, -0.1],
      [0.72, -0.24, 0.0],
    ],
    radius: 0.021,
  },
  {
    parent: 'RCA',
    path: [
      [-0.3, -0.46, -0.32],
      [-0.18, -0.62, -0.2],
      [-0.06, -0.8, -0.02],
    ],
    radius: 0.02,
  },
];

const PROXIMAL_RADIUS: Record<'LAD' | 'LCX' | 'RCA', number> = {
  LAD: 0.045,
  LCX: 0.04,
  RCA: 0.048,
};
const DISTAL_RADIUS = 0.016;

/** Vessel colours: arterial crimson, with the lesion left uncoloured so the
 *  narrowing itself — not a hint — is what the student has to spot. */
const VESSEL_COLOR = 0xb02a30;

function curveOf(path: Pt[]): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3(
    path.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    false,
    'catmullrom',
    0.4,
  );
}

/**
 * Standalone, navigable vessel for the catheter-navigation challenge: same
 * centreline and geometrically-narrowed lumen the main tree renders, but
 * built and returned in isolation so the challenge can put it on its own
 * render layer. That matters because the loaded specimen is sometimes a
 * patient CTA scan whose own mesh has no per-vessel lumen labelling (see
 * anchors.ts) — this reference geometry is what stays "actually accurate to
 * the model" (real epicardial course, real geometric stenosis) in every
 * case, real scan or procedural, since it's authored the same normalised
 * pivot frame every specimen is fitted into on load.
 */
export interface NavVessel {
  region: 'LAD' | 'LCX' | 'RCA';
  curve: THREE.CatmullRomCurve3;
  radiusAt: (t: number) => number;
  mesh: THREE.Mesh;
  stenosisMesh?: THREE.Mesh;
}

export function buildNavVessel(def: CoronaryCase, region: 'LAD' | 'LCX' | 'RCA'): NavVessel {
  const curve = curveOf(pathFor(def, region));
  const lesion =
    def.lesion && def.lesion.vessel === region
      ? { at: def.lesion.at, severity: def.lesion.severity, halfWidth: LESION_HALF_WIDTH }
      : undefined;
  const radiusAt = radiusProfile(PROXIMAL_RADIUS[region], lesion);
  const mesh = new THREE.Mesh(variableTube(curve, radiusAt, 128, 16), vesselMaterial());

  let stenosisMesh: THREE.Mesh | undefined;
  if (lesion && def.lesion) {
    stenosisMesh = new THREE.Mesh(
      stenosisSleeve(curve, def.lesion),
      new THREE.MeshStandardMaterial({
        color: 0xff7a2f,
        emissive: 0xff5a1f,
        emissiveIntensity: 0.4,
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
        roughness: 0.6,
        metalness: 0,
        side: THREE.DoubleSide,
      }),
    );
  }

  return { region, curve, radiusAt, mesh, stenosisMesh };
}

/**
 * Tube geometry with a radius that varies along the curve.
 *
 * `THREE.TubeGeometry` only accepts a constant radius, and a stenosis that is
 * merely painted on teaches nothing — the whole point is that the student sees
 * the lumen pinch. Same Frenet-frame construction as three's own tube, with
 * the radius sampled per ring.
 */
function variableTube(
  curve: THREE.Curve<THREE.Vector3>,
  radiusAt: (t: number) => number,
  tubularSegments = 96,
  radialSegments = 14,
): THREE.BufferGeometry {
  const frames = curve.computeFrenetFrames(tubularSegments, false);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const P = new THREE.Vector3();
  for (let i = 0; i <= tubularSegments; i++) {
    const t = i / tubularSegments;
    curve.getPointAt(t, P);
    const N = frames.normals[i]!;
    const B = frames.binormals[i]!;
    const r = radiusAt(t);

    for (let j = 0; j <= radialSegments; j++) {
      const v = (j / radialSegments) * Math.PI * 2;
      const sin = Math.sin(v);
      const cos = -Math.cos(v);
      const nx = cos * N.x + sin * B.x;
      const ny = cos * N.y + sin * B.y;
      const nz = cos * N.z + sin * B.z;
      normals.push(nx, ny, nz);
      positions.push(P.x + r * nx, P.y + r * ny, P.z + r * nz);
      uvs.push(t, j / radialSegments);
    }
  }

  const stride = radialSegments + 1;
  for (let i = 1; i <= tubularSegments; i++) {
    for (let j = 1; j <= radialSegments; j++) {
      const a = stride * (i - 1) + (j - 1);
      const b = stride * i + (j - 1);
      const c = stride * i + j;
      const d = stride * (i - 1) + j;
      indices.push(a, b, d, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return geometry;
}

/**
 * Radius profile for a main vessel: a smooth proximal-to-distal taper, with an
 * optional focal narrowing. The lesion window is a raised cosine so the plaque
 * has shoulders rather than a step, which is what a real eccentric plaque
 * looks like in cross-section.
 */
function radiusProfile(
  proximal: number,
  lesion?: { at: number; severity: number; halfWidth: number },
): (t: number) => number {
  return (t: number) => {
    const base = proximal + (DISTAL_RADIUS - proximal) * Math.pow(t, 0.85);
    if (!lesion) return base;
    const d = Math.abs(t - lesion.at);
    if (d > lesion.halfWidth) return base;
    const shoulder = 0.5 * (1 + Math.cos((d / lesion.halfWidth) * Math.PI));
    return base * (1 - lesion.severity * shoulder);
  };
}

const LESION_HALF_WIDTH = 0.055;

function vesselMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: VESSEL_COLOR,
    roughness: 0.42,
    metalness: 0,
    emissive: 0x000000,
    envMapIntensity: 0.5,
    side: THREE.DoubleSide,
  });
}

function pathFor(def: CoronaryCase, region: 'LAD' | 'LCX' | 'RCA'): Pt[] {
  if (region === 'LAD') return LAD_PATH;
  if (region === 'LCX') return LCX_PATH;
  return def.anomalousRcaOrigin ? RCA_ANOMALOUS_PATH : RCA_PATH;
}

/** The stenosis proxy is a short sleeve wrapped around the narrowed segment. */
function stenosisSleeve(curve: THREE.CatmullRomCurve3, lesion: Lesion): THREE.BufferGeometry {
  const from = Math.max(0, lesion.at - LESION_HALF_WIDTH * 1.6);
  const to = Math.min(1, lesion.at + LESION_HALF_WIDTH * 1.6);
  const pts: THREE.Vector3[] = [];
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    pts.push(curve.getPointAt(from + ((to - from) * i) / steps));
  }
  const sleeve = new THREE.CatmullRomCurve3(pts);
  return variableTube(sleeve, () => 0.075, 24, 12);
}

/**
 * Builds the full arterial tree for a case, including the aortic-root stub the
 * ostia arise from and a translucent myocardial ghost that gives the vessels
 * somewhere to sit.
 */
export function buildCoronaryTree(def: CoronaryCase): CoronaryTree {
  const root = new THREE.Group();
  root.name = 'coronary-tree';
  const meshes = new Map<RegionId, THREE.Mesh[]>();
  const colliders = new Map<RegionId, THREE.Mesh[]>();

  const push = (region: RegionId, mesh: THREE.Mesh) => {
    mesh.name = region;
    mesh.userData.surgilearnRegion = region;
    const list = meshes.get(region);
    if (list) list.push(mesh);
    else meshes.set(region, [mesh]);
    root.add(mesh);
  };

  const pushCollider = (region: RegionId, mesh: THREE.Mesh) => {
    const list = colliders.get(region);
    if (list) list.push(mesh);
    else colliders.set(region, [mesh]);
    root.add(mesh);
  };

  for (const region of ['LAD', 'LCX', 'RCA'] as const) {
    const curve = curveOf(pathFor(def, region));
    const lesion =
      def.lesion && def.lesion.vessel === region
        ? { at: def.lesion.at, severity: def.lesion.severity, halfWidth: LESION_HALF_WIDTH }
        : undefined;
    const geometry = variableTube(curve, radiusProfile(PROXIMAL_RADIUS[region], lesion));
    push(region, new THREE.Mesh(geometry, vesselMaterial()));

    pushCollider(
      region,
      colliderMesh(
        variableTube(curve, () => COLLIDER_RADIUS, COLLIDER.tubular, COLLIDER.radial),
        region,
        `collider-${region}`,
      ),
    );

    if (lesion && def.lesion) {
      // Invisible hover target over the narrowed segment. Opacity rather than
      // `visible = false` so it is raycastable on every three.js version, and
      // so the highlight can simply fade it in when the student finds it.
      const sleeveMat = new THREE.MeshStandardMaterial({
        color: 0xff7a2f,
        emissive: 0xff5a1f,
        emissiveIntensity: 0,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        roughness: 0.6,
        metalness: 0,
        side: THREE.DoubleSide,
      });
      push('STENOSIS', new THREE.Mesh(stenosisSleeve(curve, def.lesion), sleeveMat));
      pushCollider(
        'STENOSIS',
        colliderMesh(stenosisSleeve(curve, def.lesion), 'STENOSIS', 'collider-STENOSIS'),
      );
    }
  }

  for (const branch of BRANCHES) {
    // The anomalous RCA's distal course still matches the normal one, so the
    // PDA branch attaches correctly in both variants.
    const curve = curveOf(branch.path);
    const geometry = variableTube(
      curve,
      (t) => branch.radius * (1 - 0.45 * t),
      48,
      10,
    );
    push(branch.parent, new THREE.Mesh(geometry, vesselMaterial()));
    // Branches identify as their parent vessel, so a student who points at a
    // diagonal has still found the LAD.
    pushCollider(
      branch.parent,
      colliderMesh(
        variableTube(curve, () => COLLIDER_RADIUS * 0.7, 12, COLLIDER.radial),
        branch.parent,
        `collider-${branch.parent}-branch`,
      ),
    );
  }

  root.add(aorticRoot(), myocardialGhost());

  const radius = new THREE.Box3()
    .setFromObject(root)
    .getBoundingSphere(new THREE.Sphere())
    .radius;

  return { root, meshes, colliders, radius };
}

function aorticRoot(): THREE.Mesh {
  const geometry = new THREE.CylinderGeometry(0.16, 0.2, 0.3, 28, 1, true);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: 0x8f5f63,
      roughness: 0.55,
      metalness: 0,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    }),
  );
  mesh.position.set(0, 0.7, -0.02);
  mesh.name = 'aortic-root';
  return mesh;
}

/** Faint myocardial silhouette so the vessels read as epicardial, not floating. */
function myocardialGhost(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(0.62, 32, 24);
  geometry.scale(1.05, 1.25, 0.9);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: 0x3a1b22,
      roughness: 0.95,
      metalness: 0,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.BackSide,
    }),
  );
  mesh.position.set(0.02, -0.16, -0.06);
  mesh.name = 'myocardium';
  return mesh;
}

/**
 * Hover proxies for a *supplied* GLB whose meshes are not named after the
 * arteries. The same centrelines are rebuilt at the model's own scale and
 * added as fully transparent tubes, so a case still plays even when the asset
 * carries no region metadata. Fatter than the real vessels because they have
 * to forgive the mismatch between generic curves and a specific patient.
 */
export function buildRegionProxies(
  def: CoronaryCase,
  missing: RegionId[],
  /** Object whose extents the reference tree is fitted to. */
  measureFrom: THREE.Object3D,
  /** Where the generated meshes are parented — kept separate so a rebind can
   *  drop them all at once. */
  attachTo: THREE.Object3D,
): { meshes: Map<RegionId, THREE.Mesh[]>; colliders: Map<RegionId, THREE.Mesh[]> } {
  const meshes = new Map<RegionId, THREE.Mesh[]>();
  const colliders = new Map<RegionId, THREE.Mesh[]>();
  if (missing.length === 0) return { meshes, colliders };

  const box = new THREE.Box3().setFromObject(measureFrom);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  // The reference tree spans ~2 units across its longest axis, matching the
  // normalisation every loaded model goes through.
  const scale = Math.max(size.x, size.y, size.z) / 2;

  const group = new THREE.Group();
  group.name = 'surgilearn-region-proxies';
  group.scale.setScalar(scale);
  group.position.copy(centre);

  const proxyMaterial = () =>
    new THREE.MeshStandardMaterial({
      color: 0x34e3ff,
      emissive: 0x34e3ff,
      emissiveIntensity: 0,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      roughness: 0.5,
      metalness: 0,
      side: THREE.DoubleSide,
    });

  for (const region of missing) {
    const curve =
      region === 'STENOSIS'
        ? def.lesion && curveOf(pathFor(def, def.lesion.vessel))
        : curveOf(pathFor(def, region));
    if (!curve) continue;

    const geometry =
      region === 'STENOSIS' && def.lesion
        ? stenosisSleeve(curve, def.lesion)
        : variableTube(curve, () => 0.07, 48, 10);

    const mesh = new THREE.Mesh(geometry, proxyMaterial());
    mesh.name = `proxy-${region}`;
    mesh.userData.surgilearnRegion = region;
    meshes.set(region, [mesh]);
    group.add(mesh);

    // The display proxy only exists to glow once found; identification raycasts
    // against this coarse twin instead so the per-frame cost stays flat however
    // detailed the loaded specimen is.
    const collider = colliderMesh(
      region === 'STENOSIS' && def.lesion
        ? stenosisSleeve(curve, def.lesion)
        : variableTube(curve, () => 0.075, COLLIDER.tubular, COLLIDER.radial),
      region,
      `collider-${region}`,
    );
    colliders.set(region, [collider]);
    group.add(collider);
  }

  attachTo.add(group);
  return { meshes, colliders };
}

/**
 * Recentres and rescales the procedural tree exactly the way `modelLoader`
 * normalises a GLB, so camera framing and gesture sensitivity are identical
 * whichever source the specimen came from.
 */
export function normaliseTree(tree: CoronaryTree): number {
  const box = new THREE.Box3().setFromObject(tree.root);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z);
  const scale = longest > 0 ? 2 / longest : 1;

  tree.root.position.sub(centre).multiplyScalar(scale);
  tree.root.scale.setScalar(scale);

  return new THREE.Box3()
    .setFromObject(tree.root)
    .getBoundingSphere(new THREE.Sphere()).radius;
}
