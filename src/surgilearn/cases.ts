import { asset } from '../paths';
import type { OrganDef } from '../organs';
import type { AnchorSet } from './anchors';

/**
 * SurgiLearn case library.
 *
 * Each case is a coronary CTA-style specimen plus the clinical mission that
 * turns viewing it into an assessed task. The vignettes and the angiographic
 * working views (RAO/LAO) are the ones a cath-lab operator actually uses, so
 * the "navigate to view" objective teaches real projection geometry rather
 * than an arbitrary camera pose.
 */

/** Anatomical regions the challenge layer can label and score. */
export type RegionId = 'LAD' | 'LCX' | 'RCA' | 'STENOSIS';

/** Severity grades offered by the classification objective. */
export type Severity = 'NORMAL' | 'MILD' | 'MODERATE' | 'SEVERE';

export const SEVERITIES: Severity[] = ['NORMAL', 'MILD', 'MODERATE', 'SEVERE'];

export interface RegionInfo {
  id: RegionId;
  name: string;
  /** One-line clinical description shown in the hover label popup. */
  blurb: string;
}

export const REGION_INFO: Record<RegionId, RegionInfo> = {
  LAD: {
    id: 'LAD',
    name: 'LAD — Left Anterior Descending',
    blurb:
      'Runs the anterior interventricular groove to the apex. Supplies the anterior wall and most of the septum; a proximal occlusion is the classic "widow-maker".',
  },
  LCX: {
    id: 'LCX',
    name: 'LCX — Left Circumflex',
    blurb:
      'Curves into the left atrioventricular groove and gives off obtuse marginal branches to the lateral wall.',
  },
  RCA: {
    id: 'RCA',
    name: 'RCA — Right Coronary Artery',
    blurb:
      'Courses the right atrioventricular groove; supplies the SA and AV nodes in most hearts and, when dominant, the posterior descending artery.',
  },
  STENOSIS: {
    id: 'STENOSIS',
    name: 'Stenosis — Luminal Narrowing',
    blurb:
      'Focal reduction in lumen diameter. Grading drives management: <50% medical therapy, 50–70% functional testing, >70% revascularisation.',
  },
};

/** A single scored task inside a mission. */
export type Objective =
  | {
      kind: 'view';
      id: string;
      label: string;
      /** Target pivot yaw/pitch in degrees; the specimen must be held here. */
      yawDeg: number;
      pitchDeg: number;
      toleranceDeg: number;
      holdMs: number;
    }
  | { kind: 'identify'; id: string; label: string; region: RegionId }
  | { kind: 'classify'; id: string; label: string };

/** Procedural lesion description, used when no GLB has been supplied yet. */
export interface Lesion {
  vessel: 'LAD' | 'LCX' | 'RCA';
  /** Position along the vessel, 0 = ostium, 1 = distal. */
  at: number;
  /** Fraction of the lumen removed, 0..0.9. */
  severity: number;
}

export interface CoronaryCase {
  id: string;
  /** Switcher label. */
  label: string;
  glyph: string;
  /** GLB filename expected under public/models/coronary/. */
  file: string;
  logTitle: string;
  source: string;
  /** Mission heading, e.g. "CASE 2 · MILD STENOSIS". */
  title: string;
  /** Clinical vignette shown at the top of the mission panel. */
  brief: string;
  objectives: Objective[];
  /** Correct answer for the classification objective. */
  answer: Severity;
  lesion?: Lesion;
  /**
   * Vessel labels for a patient-derived GLB, placed in the specimen's own
   * normalised space. Only needed when the asset does not name its meshes —
   * see {@link import('./anchors')}. Author them with the in-app picker and
   * paste the result here.
   */
  regionAnchors?: AnchorSet;
  /** Case 3 models an RCA arising from the left coronary sinus. */
  anomalousRcaOrigin?: boolean;
  /** Offline teaching point, shown when no Claude API key is configured. */
  teaching: string;
}

/**
 * All three cases are procedural, deliberately. Two real patient CTA scans
 * (case_182, case_193) were trialled for Cases 1 and 2 — see
 * public/models/coronary/_real-scans-unused — but a real scan has no
 * per-vessel lumen labelling of its own, so identification and grading had
 * to be scored against this same reference anatomy overlaid as a guess (see
 * regions.ts's `unmapped` handling and the "hover targets are reference
 * anatomy" notice this used to show). That is an honest thing to ship, but
 * it is a weaker claim than "the case matches the content", so for now every
 * case is generated from these centrelines directly: the vignette, the
 * lesion, and the geometry the student actually sees are the same source of
 * truth, exactly as Case 3 always was. Swapping a real scan back in for a
 * specific case is a `file`-pointing exercise (see specimenLoader.ts) once
 * someone who can read the study has confirmed what it shows and updated
 * `brief`/`answer`/`lesion`/`teaching` to match it.
 */

// Angiographic working views. Positive yaw swings the specimen's left side
// away from the camera, which reads as a right anterior oblique projection;
// negative yaw is the left anterior oblique.
const RAO = { yawDeg: 38, pitchDeg: -8, toleranceDeg: 20, holdMs: 600 };
const LAO = { yawDeg: -40, pitchDeg: -6, toleranceDeg: 20, holdMs: 600 };

export const CASES: CoronaryCase[] = [
  {
    id: 'coronary-1',
    label: 'Case 1',
    glyph: '◍',
    file: 'case1.glb',
    logTitle: 'CORONARY CASE 1 — BASELINE',
    source: 'Coronary CTA reconstruction · normal anatomical baseline',
    title: 'CASE 1 · NORMAL ANATOMY',
    brief:
      '58F, atypical chest pain, low-risk stress test. CTA ordered for an anatomical baseline. Confirm a normal left system and grade any disease.',
    objectives: [
      { kind: 'view', id: 'view', label: 'Rotate to the LAO working view', ...LAO },
      { kind: 'identify', id: 'lad', label: 'Identify and hold on the LAD', region: 'LAD' },
      { kind: 'identify', id: 'lcx', label: 'Identify and hold on the LCX', region: 'LCX' },
      { kind: 'classify', id: 'grade', label: 'Grade the worst lesion' },
    ],
    answer: 'NORMAL',
    teaching:
      'The left main bifurcates into the LAD and LCX. In the LAO projection the two vessels separate cleanly, which is why it is the standard view for assessing a left main bifurcation.',
  },
  {
    id: 'coronary-2',
    label: 'Case 2',
    glyph: '◍',
    file: 'case2.glb',
    logTitle: 'CORONARY CASE 2 — MILD DISEASE',
    source: 'Coronary CTA reconstruction · mid-LAD stenosis',
    title: 'CASE 2 · MILD STENOSIS',
    brief:
      '65M, chest pain on exertion, referred to the cath lab. Identify the culprit vessel, find the lesion and grade it.',
    objectives: [
      { kind: 'view', id: 'view', label: 'Rotate to the LAO working view', ...LAO },
      { kind: 'identify', id: 'lad', label: 'Identify and hold on the LAD', region: 'LAD' },
      {
        kind: 'identify',
        id: 'lesion',
        label: 'Locate the stenosis zone',
        region: 'STENOSIS',
      },
      { kind: 'classify', id: 'grade', label: 'Grade the lesion' },
    ],
    answer: 'MILD',
    lesion: { vessel: 'LAD', at: 0.42, severity: 0.35 },
    teaching:
      'A mid-LAD lesion under 50% is managed medically, not with a stent. Anatomical severity alone does not justify revascularisation — ischaemia does.',
  },
  {
    id: 'coronary-3',
    label: 'Case 3',
    glyph: '◍',
    file: 'case3.glb',
    logTitle: 'CORONARY CASE 3 — ANOMALOUS RCA',
    source: 'Coronary CTA reconstruction · anomalous RCA origin',
    title: 'CASE 3 · SEVERE + ANOMALY',
    brief:
      '47M athlete, exertional syncope. CTA shows the RCA arising from the left coronary sinus with an interarterial course. Identify the vessel, find the lesion and grade it.',
    objectives: [
      { kind: 'view', id: 'view', label: 'Rotate to the RAO working view', ...RAO },
      {
        kind: 'identify',
        id: 'rca',
        label: 'Identify and hold on the anomalous RCA',
        region: 'RCA',
      },
      {
        kind: 'identify',
        id: 'lesion',
        label: 'Locate the stenosis zone',
        region: 'STENOSIS',
      },
      { kind: 'classify', id: 'grade', label: 'Grade the lesion' },
    ],
    answer: 'SEVERE',
    lesion: { vessel: 'RCA', at: 0.3, severity: 0.75 },
    anomalousRcaOrigin: true,
    teaching:
      'An RCA arising from the left sinus with an interarterial course is compressed between the aorta and pulmonary trunk during exertion — a recognised cause of sudden cardiac death in young athletes.',
  },
];

export function findCase(id: string | undefined): CoronaryCase | undefined {
  return CASES.find((c) => c.id === id);
}

/** Which regions a case exposes — the stenosis only exists if there is a lesion. */
export function caseRegions(def: CoronaryCase): RegionId[] {
  const base: RegionId[] = ['LAD', 'LCX', 'RCA'];
  return def.lesion ? [...base, 'STENOSIS'] : base;
}

/**
 * Coronary cases presented as specimens so they slot straight into the existing
 * organ switcher — the model selector is the same control the user already
 * knows, just with the case library appended.
 */
export const CORONARY_SPECIMENS: OrganDef[] = CASES.map((c) => ({
  id: c.id,
  label: c.label,
  glyph: c.glyph,
  url: asset(`models/coronary/${c.file}`),
  logTitle: c.logTitle,
  source: c.source,
  group: 'coronary',
  caseId: c.id,
}));
