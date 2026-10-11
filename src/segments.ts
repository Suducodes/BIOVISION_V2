export type Vec3 = readonly [number, number, number];

/**
 * A named region of a specimen that voice navigation can fly to.
 *
 * The cardiac model is a single unnamed mesh, so segments are not part of the
 * file: each is a hand-placed surface anchor, found by ray-casting the mesh in
 * the browser, plus the view direction the anchor was picked from. Every
 * coordinate is in the specimen's normalised model space — the frame the
 * loader produces (centred, longest axis 2 units) with the pivot at rest — so
 * the same numbers hold on any screen.
 *
 * These are approximate teaching regions, not a clinical parcellation: a vertex
 * belongs to whichever segment has the nearest site, so the borders between
 * chambers are straight Voronoi cuts rather than true anatomical boundaries.
 */
export interface SegmentDef {
  id: string;
  /** Name shown in the interface. */
  label: string;
  /**
   * What can be said, lower-case. Matched on word boundaries with a small typo
   * allowance, so recogniser slips like "ventical" still land.
   */
  aliases: string[];
  /** Point the camera flies to. */
  anchor: Vec3;
  /** Unit vector from the anchor toward where the camera should sit. */
  view: Vec3;
  /** Extra surface samples that help this segment claim its share of the mesh. */
  sites?: Vec3[];
  /** Camera distance to the anchor once focused, in world units. */
  distance: number;
}

/**
 * Eight regions of the cardiac specimen: four-chamber anatomy, the apex and the
 * great vessels. Left and right follow the patient, not the viewer — the
 * right atrium sits on the left of the screen in the standard anterior view.
 */
export const HEART_SEGMENTS: SegmentDef[] = [
  {
    id: 'svc',
    label: 'Superior vena cava',
    aliases: ['superior vena cava', 'vena cava', 'svc', 's v c'],
    anchor: [-0.315, 0.803, 0.206],
    view: [0.078, -0.199, 0.977],
    sites: [[-0.228, 0.637, 0.138]],
    distance: 1.5,
  },
  {
    id: 'aorta',
    label: 'Aorta',
    aliases: ['aorta', 'aortic arch', 'ascending aorta', 'aortic'],
    anchor: [0.039, 0.712, 0.211],
    view: [-0.01, -0.178, 0.984],
    sites: [
      [0.297, 0.649, -0.518],
      [0.352, 0.782, -0.404],
      [0.38, 0.842, -0.417],
      [0.032, 0.828, 0.083],
    ],
    distance: 1.6,
  },
  {
    id: 'pa',
    label: 'Pulmonary artery',
    aliases: ['pulmonary artery', 'pulmonary trunk', 'pulmonary'],
    anchor: [0.337, 0.403, 0.272],
    view: [-0.086, -0.103, 0.991],
    sites: [[0.583, 0.424, -0.067]],
    distance: 1.6,
  },
  {
    id: 'ra',
    label: 'Right atrium',
    aliases: ['right atrium', 'right atrial'],
    anchor: [-0.367, 0.232, 0.395],
    view: [0.097, -0.062, 0.993],
    sites: [[-0.464, 0, 0.368]],
    distance: 1.9,
  },
  {
    id: 'rv',
    label: 'Right ventricle',
    aliases: ['right ventricle', 'right ventricular'],
    anchor: [-0.225, -0.196, 0.509],
    view: [0.062, 0.054, 0.997],
    sites: [[-0.343, -0.429, -0.412]],
    distance: 2.2,
  },
  {
    id: 'lv',
    label: 'Left ventricle',
    aliases: ['left ventricle', 'left ventricular'],
    anchor: [0.366, -0.287, 0.367],
    view: [-0.096, 0.075, 0.992],
    sites: [
      [0.285, -0.425, -0.444],
      [0.507, -0.063, 0.186],
    ],
    distance: 2.2,
  },
  {
    id: 'apex',
    label: 'Apex',
    aliases: ['apex', 'cardiac apex', 'apex of the heart'],
    anchor: [0.122, -0.904, 0.212],
    view: [-0.03, 0.224, 0.974],
    distance: 1.7,
  },
  {
    id: 'la',
    label: 'Left atrium',
    aliases: ['left atrium', 'left atrial'],
    anchor: [0.055, 0.337, -0.477],
    view: [-0.015, -0.092, -0.996],
    sites: [
      [0.45, 0.213, 0.199],
      [-0.281, 0.22, -0.543],
      [0.285, 0.313, -0.541],
    ],
    distance: 2.2,
  },
];
