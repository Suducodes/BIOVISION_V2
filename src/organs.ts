import { asset } from './paths';

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
  },
  {
    id: 'lungs',
    label: 'Lungs',
    glyph: '🫁',
    url: asset('models/lungs.glb'),
    logTitle: 'PULMONARY SPECIMEN',
    source: 'Segmented from CT — author’s own reconstruction',
  },
];
