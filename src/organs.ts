import { asset } from './paths';
import { HEART_SEGMENTS, type SegmentDef } from './segments';

export interface OrganDef {
  id: string;
  /** Short label for the switcher button. */
  label: string;
  /** Icon glyph for the button. */
  glyph: string;
  url: string;
  /** Specimen-log heading shown when this organ is active. */
  logTitle: string;
  /** One-line provenance shown in the specimen log. */
  source: string;
  /** Optional switcher grouping, if the library ever grows enough to need one. */
  group?: string;
  /**
   * Framing multiplier, default 1. Auto-framing fits the bounding sphere, which
   * overstates how much of the frame a sparse, wiry specimen actually fills —
   * a vessel tree is mostly empty space. Values below 1 pull the camera closer.
   */
  fit?: number;
  /** Named regions voice navigation can fly to; absent means voice offers none. */
  segments?: SegmentDef[];
  /** Schematic interior model (chambers and septa) shown in x-ray mode. */
  interior?: string;
}

/**
 * The anatomical library. Heart is a high-fidelity textured asset; the lungs
 * are the author's own CT-scan segmentation, which is the point worth making at
 * the poster — the platform renders real patient-derived anatomy, not just
 * store-bought models.
 */
export const ORGANS: OrganDef[] = [
  {
    id: 'heart',
    label: 'Heart',
    glyph: '🫀',
    url: asset('models/heart.glb'),
    logTitle: 'CARDIAC SPECIMEN',
    source: 'High-fidelity textured cardiac model',
    segments: HEART_SEGMENTS,
    interior: asset('models/heart_interior.glb'),
  },
  {
    id: 'lungs',
    label: 'Lungs',
    glyph: '🫁',
    url: asset('models/lungs.glb'),
    logTitle: 'PULMONARY SPECIMEN',
    source: 'Segmented from CT — author’s own reconstruction',
  },
  {
    id: 'coronary',
    label: 'Coronary',
    glyph: '🩸',
    url: asset('models/coronary.glb'),
    logTitle: 'CORONARY SPECIMEN',
    source: 'LCA + RCA segmented from CTA — author’s own model',
    fit: 0.74,
  },
];
