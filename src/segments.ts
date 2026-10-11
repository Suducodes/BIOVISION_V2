import type { ChamberId, SeptumId, ValveId } from './anatomy/heartInteriorData';
import { CHAMBER_CENTROIDS, SEPTUM_CENTROIDS, VALVES } from './anatomy/heartInteriorData';

export type Vec3 = readonly [number, number, number];

/**
 * The heart shell is built from 13 separate surface pieces (edge-connected
 * components of the mesh). Each piece is a real anatomical boundary — the aorta
 * is its own piece, so is the pulmonary trunk — which makes them hard borders:
 * a part only ever claims vertices on the pieces it lists. Pieces are told apart
 * at runtime by their centroid, so nothing depends on the order they load in.
 */
export const HEART_PIECES = {
  leftHeart: [0.129, -0.226, -0.236],
  rightAtrium: [-0.321, 0.411, -0.112],
  anteriorWall: [-0.014, -0.429, 0.303],
  aorta: [0.146, 0.709, -0.098],
  pulmonaryTrunk: [0.346, 0.466, 0.154],
  rightPA: [-0.146, 0.739, -0.178],
  svcCap: [-0.391, 0.914, 0.201],
  lpaCap: [0.634, 0.428, -0.001],
  descCap: [0.422, 0.588, -0.489],
  lccaCap: [0.308, 0.984, -0.248],
  rpaCap: [-0.374, 0.872, -0.081],
  bctCap: [0.12, 0.994, -0.085],
  lsaCap: [0.404, 0.921, -0.423],
} as const satisfies Record<string, Vec3>;

export type PieceName = keyof typeof HEART_PIECES;

export type InteriorId = ChamberId | SeptumId | ValveId;

/**
 * A named part of a specimen that voice, taps and labels can go to.
 *
 * Surface parts own a share of the mesh: every vertex is weighed against the
 * part's `sites` (hand-placed points, found by ray-casting the mesh in the
 * browser, or vessel centreline points), but only on the `pieces` the part
 * claims. Inside parts own no surface; they light up the schematic interior.
 *
 * Coordinates are in the specimen's normalised model space (centred, longest
 * axis 2 units) with the pivot at rest, so the same numbers hold on any screen.
 * These are teaching regions, not a clinical parcellation.
 */
export interface SegmentDef {
  id: string;
  /** Name shown in the interface and spoken back. */
  label: string;
  /** Where it sits in the panel. */
  group: 'chamber' | 'vessel' | 'inside';
  /**
   * Full phrases that can be said, lower-case. Matched on word boundaries with
   * a small typo allowance, so recogniser slips like "ventical" still land.
   */
  aliases: string[];
  /** Point the camera flies to. */
  anchor: Vec3;
  /** Unit vector from the anchor toward where the camera should sit. */
  view: Vec3;
  /** Camera distance to the anchor once focused, in world units. */
  distance: number;
  /** Surface parts: the shell pieces this part may claim. */
  pieces?: PieceName[];
  /** Surface parts: points that pull vertices of those pieces into this part. */
  sites?: Vec3[];
  /** The schematic interior structure this part lights up, if any. */
  interior?: InteriorId;
  /** Inside parts are only visible with the shell see-through. */
  needsXray?: boolean;
  /** Atlas colour. */
  color: string;
  /** Spoken and captioned when the part is focused. One or two plain sentences. */
  blurb: string;
}

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};

/**
 * The cardiac parts: 18 on the surface and 6 inside. Left and right follow the
 * patient, not the viewer — the right atrium sits on the left of the screen in
 * the standard anterior view.
 */
export const HEART_SEGMENTS: SegmentDef[] = [
  // --- Chambers and surface landmarks -----------------------------------
  {
    id: 'ra',
    label: 'Right atrium',
    group: 'chamber',
    aliases: ['right atrium', 'right atrial', 'right atria', 'ra', 'r a'],
    anchor: [-0.452, 0.181, 0.374],
    view: [0.119, -0.048, 0.992],
    distance: 1.9,
    pieces: ['rightAtrium'],
    sites: [[-0.452, 0.181, 0.374], [-0.516, 0, 0.351], [-0.443, 0.059, -0.455], [-0.58, 0.15, -0.05]],
    interior: 'ra',
    color: '#6c8cff',
    blurb:
      'The right atrium. It collects oxygen-poor blood from the body and passes it down through the tricuspid valve. The sinoatrial node, the heart’s natural pacemaker, sits in its wall.',
  },
  {
    id: 'rauricle',
    label: 'Right auricle',
    group: 'chamber',
    aliases: ['right auricle', 'right atrial appendage', 'right appendage'],
    anchor: [-0.292, 0.4, 0.301],
    view: [0.075, -0.103, 0.992],
    distance: 1.5,
    pieces: ['rightAtrium'],
    sites: [[-0.292, 0.4, 0.301], [-0.277, 0.472, 0.209]],
    color: '#9aa8ff',
    blurb: 'The right auricle, an ear-shaped pouch of the right atrium that overlaps the root of the aorta.',
  },
  {
    id: 'rv',
    label: 'Right ventricle',
    group: 'chamber',
    aliases: ['right ventricle', 'right ventricular', 'rv', 'r v'],
    anchor: [-0.115, -0.231, 0.536],
    view: [0.032, 0.064, 0.997],
    distance: 2.2,
    pieces: ['anteriorWall', 'leftHeart'],
    sites: [[-0.115, -0.231, 0.536], [-0.238, -0.505, 0.433], [0, 0.117, 0.487], [-0.343, -0.429, -0.412], [-0.576, -0.249, 0.25]],
    interior: 'rv',
    color: '#3d5bd9',
    blurb:
      'The right ventricle. It forms most of the front of the heart and pumps blood to the lungs. Its wall is thin, because the lungs are a low-pressure circuit.',
  },
  {
    id: 'la',
    label: 'Left atrium',
    group: 'chamber',
    aliases: ['left atrium', 'left atrial', 'left atria', 'la', 'l a'],
    anchor: [0.029, 0.322, -0.484],
    view: [-0.032, -0.044, -0.999],
    distance: 2.0,
    pieces: ['leftHeart'],
    sites: [[0.116, 0.16, -0.512], [0.029, 0.322, -0.484], [0.2, 0.4, -0.35]],
    interior: 'la',
    color: '#ff7fa8',
    blurb:
      'The left atrium, the most posterior chamber. It receives oxygen-rich blood from the lungs through the pulmonary veins and passes it through the mitral valve.',
  },
  {
    id: 'lauricle',
    label: 'Left auricle',
    group: 'chamber',
    aliases: ['left auricle', 'left atrial appendage', 'left appendage'],
    anchor: [0.49, 0.262, 0.057],
    view: [-0.119, -0.063, 0.991],
    distance: 1.5,
    pieces: ['leftHeart'],
    sites: [[0.49, 0.262, 0.057]],
    color: '#ffa3c4',
    blurb: 'The left auricle, the ear-shaped appendage of the left atrium. In atrial fibrillation, clots tend to form here.',
  },
  {
    id: 'lv',
    label: 'Left ventricle',
    group: 'chamber',
    aliases: ['left ventricle', 'left ventricular', 'lv', 'l v'],
    anchor: [0.411, -0.243, 0.34],
    view: norm([0.45, 0.05, 0.89]),
    distance: 2.2,
    pieces: ['anteriorWall', 'leftHeart'],
    sites: [[0.411, -0.243, 0.34], [0.568, -0.229, -0.229], [0.088, -0.381, -0.477], [0.367, -0.52, 0.323], [0.507, -0.063, 0.186]],
    interior: 'lv',
    color: '#e0313f',
    blurb:
      'The left ventricle, the heart’s main pump. Its wall is about three times thicker than the right’s, because it drives blood around the whole body.',
  },
  {
    id: 'apex',
    label: 'Apex',
    group: 'chamber',
    aliases: ['apex', 'cardiac apex', 'apex of the heart', 'tip of the heart'],
    anchor: [0.158, -0.915, 0.199],
    view: norm([0.1, -0.45, 0.89]),
    distance: 1.7,
    pieces: ['anteriorWall', 'leftHeart'],
    sites: [[0.158, -0.915, 0.199], [0.175, -0.926, -0.178]],
    color: '#b23cff',
    blurb: 'The apex, formed by the left ventricle. It lies behind the fifth left intercostal space, where the apex beat is felt.',
  },

  // --- Great vessels --------------------------------------------------------
  {
    id: 'svc',
    label: 'Superior vena cava',
    group: 'vessel',
    aliases: ['superior vena cava', 'vena cava', 'svc', 's v c', 'superior venacava'],
    anchor: [-0.318, 0.762, 0.173],
    view: [0.078, -0.188, 0.979],
    distance: 1.5,
    pieces: ['rightAtrium', 'svcCap'],
    sites: [[-0.318, 0.762, 0.173], [-0.368, 0.888, 0.247], [-0.391, 0.914, 0.201], [-0.29, 0.7, 0.02]],
    color: '#4f7bff',
    blurb: 'The superior vena cava. It returns oxygen-poor blood from the head, neck and arms to the right atrium.',
  },
  {
    id: 'ascAorta',
    label: 'Ascending aorta',
    group: 'vessel',
    aliases: ['ascending aorta', 'aortic root', 'root of the aorta', 'aorta', 'ascending'],
    anchor: [-0.133, 0.407, 0.375],
    view: [0.035, -0.107, 0.994],
    distance: 1.6,
    pieces: ['aorta'],
    sites: [[-0.133, 0.407, 0.375], [-0.1, 0.44, 0.12], [-0.04, 0.54, 0.15], [0, 0.62, 0.12]],
    color: '#ff5a4f',
    blurb:
      'The ascending aorta, rising from the left ventricle. The coronary arteries, which feed the heart muscle itself, branch from its root.',
  },
  {
    id: 'arch',
    label: 'Aortic arch',
    group: 'vessel',
    aliases: ['aortic arch', 'arch of the aorta', 'arch of aorta', 'arch'],
    anchor: [0.164, 0.8, 0.045],
    view: norm([-0.04, 0.3, 0.95]),
    distance: 1.7,
    pieces: ['aorta'],
    sites: [[0.04, 0.7, 0.07], [0.11, 0.74, -0.03], [0.18, 0.74, -0.13], [0.23, 0.75, -0.22]],
    color: '#ff7a45',
    blurb:
      'The aortic arch. Three great arteries leave its upper surface: the brachiocephalic trunk, the left common carotid and the left subclavian.',
  },
  {
    id: 'bct',
    label: 'Brachiocephalic trunk',
    group: 'vessel',
    aliases: ['brachiocephalic trunk', 'brachiocephalic artery', 'brachiocephalic', 'innominate artery', 'innominate'],
    anchor: [0.134, 0.939, -0.048],
    view: [-0.03, -0.2, 0.979],
    distance: 1.5,
    pieces: ['aorta', 'bctCap'],
    sites: [[0.15, 0.85, -0.08], [0.14, 0.93, -0.08], [0.12, 0.994, -0.085]],
    color: '#ffa040',
    blurb: 'The brachiocephalic trunk, first branch of the arch. It splits into the right subclavian and right common carotid arteries.',
  },
  {
    id: 'lcca',
    label: 'Left common carotid',
    group: 'vessel',
    aliases: ['left common carotid artery', 'left common carotid', 'left carotid', 'common carotid', 'carotid artery', 'carotid'],
    anchor: [0.285, 0.932, -0.204],
    view: [-0.05, -0.2, 0.978],
    distance: 1.5,
    pieces: ['aorta', 'lccaCap'],
    sites: [[0.27, 0.86, -0.22], [0.3, 0.94, -0.25], [0.308, 0.984, -0.248]],
    color: '#ffc04a',
    blurb: 'The left common carotid artery, carrying blood up the neck to the head and brain.',
  },
  {
    id: 'lsa',
    label: 'Left subclavian',
    group: 'vessel',
    aliases: ['left subclavian artery', 'left subclavian', 'subclavian artery', 'subclavian'],
    anchor: [0.389, 0.879, -0.361],
    view: [-0.08, -0.21, 0.975],
    distance: 1.5,
    pieces: ['aorta', 'lsaCap'],
    sites: [[0.36, 0.82, -0.37], [0.39, 0.88, -0.4], [0.404, 0.921, -0.423]],
    color: '#ffd96b',
    blurb: 'The left subclavian artery, the last branch of the arch, supplying the left arm.',
  },
  {
    id: 'descAorta',
    label: 'Descending aorta',
    group: 'vessel',
    aliases: ['descending aorta', 'thoracic aorta', 'descending'],
    anchor: [0.317, 0.628, -0.544],
    view: [-0.086, -0.171, -0.981],
    distance: 1.7,
    pieces: ['aorta', 'descCap'],
    sites: [[0.3, 0.7, -0.33], [0.36, 0.64, -0.41], [0.422, 0.589, -0.489]],
    color: '#ff6a7a',
    blurb: 'The descending aorta. It runs down through the chest and abdomen to supply the lower body.',
  },
  {
    id: 'pt',
    label: 'Pulmonary trunk',
    group: 'vessel',
    aliases: ['pulmonary trunk', 'pulmonary artery', 'main pulmonary artery'],
    anchor: [0.059, 0.301, 0.45],
    view: [-0.016, -0.081, 0.997],
    distance: 1.6,
    pieces: ['pulmonaryTrunk'],
    sites: [[0.12, 0.37, 0.29], [0.2, 0.43, 0.22], [0.29, 0.47, 0.15], [0.059, 0.301, 0.45]],
    color: '#3fa7ff',
    blurb: 'The pulmonary trunk. It carries oxygen-poor blood out of the right ventricle and divides into the two pulmonary arteries.',
  },
  {
    id: 'lpa',
    label: 'Left pulmonary artery',
    group: 'vessel',
    aliases: ['left pulmonary artery', 'left pulmonary'],
    anchor: [0.549, 0.447, 0.155],
    view: [-0.135, -0.11, 0.985],
    distance: 1.5,
    pieces: ['pulmonaryTrunk', 'lpaCap'],
    sites: [[0.45, 0.48, 0.1], [0.55, 0.47, 0.05], [0.634, 0.428, 0]],
    color: '#41d1ff',
    blurb: 'The left pulmonary artery, carrying blood to the left lung.',
  },
  {
    id: 'rpa',
    label: 'Right pulmonary artery',
    group: 'vessel',
    aliases: ['right pulmonary artery', 'right pulmonary'],
    anchor: [-0.156, 0.73, -0.243],
    view: [0.039, -0.184, -0.982],
    distance: 1.6,
    pieces: ['rightPA', 'rpaCap'],
    sites: [[-0.156, 0.73, -0.243], [-0.146, 0.739, -0.178], [-0.374, 0.872, -0.081]],
    color: '#5be3e0',
    blurb: 'The right pulmonary artery. It passes behind the ascending aorta to reach the right lung.',
  },
  {
    id: 'pv',
    label: 'Pulmonary veins',
    group: 'vessel',
    aliases: ['pulmonary veins', 'pulmonary vein'],
    anchor: [0.288, 0.311, -0.542],
    view: norm([0.1, -0.05, -0.99]),
    distance: 1.8,
    pieces: ['leftHeart', 'rightAtrium'],
    sites: [[0.288, 0.311, -0.542], [0.338, 0.32, -0.502], [-0.288, 0.216, -0.543]],
    color: '#e05ad8',
    blurb: 'The pulmonary veins, usually four, bringing oxygen-rich blood back from the lungs into the left atrium.',
  },

  // --- Inside (schematic) ---------------------------------------------------
  valve('tricuspid', 'Tricuspid valve', ['tricuspid valve', 'tricuspid', 'right atrioventricular valve', 'right av valve'],
    norm([-0.29, 0.47, 0.83]), 1.65, '#ffe9b0',
    'The tricuspid valve, with three leaflets, between the right atrium and right ventricle. It snaps shut as the ventricles contract, so blood cannot flow backwards.'),
  valve('pulmonary', 'Pulmonary valve', ['pulmonary valve', 'pulmonic valve', 'pulmonic'],
    norm([0.28, 0.54, 0.79]), 1.55, '#ffe9b0',
    'The pulmonary valve, three half-moon cusps at the exit of the right ventricle. They open as the ventricle contracts.'),
  valve('mitral', 'Mitral valve', ['mitral valve', 'mitral', 'bicuspid valve', 'bicuspid', 'left atrioventricular valve'],
    norm([0.71, 0.54, 0.45]), 1.65, '#ffe9b0',
    'The mitral valve, the only valve with two leaflets, between the left atrium and left ventricle. Its closing, with the tricuspid’s, makes the first heart sound.'),
  valve('aortic', 'Aortic valve', ['aortic valve'],
    norm([-0.19, 0.4, 0.89]), 1.55, '#ffe9b0',
    'The aortic valve. Its three cusps open as the left ventricle contracts, then close; that closure is part of the second heart sound.'),
  {
    id: 'ivs',
    label: 'Interventricular septum',
    group: 'inside',
    aliases: ['interventricular septum', 'ventricular septum', 'septum between the ventricles'],
    anchor: SEPTUM_CENTROIDS.ivs,
    view: norm([-0.7, 0.28, 0.65]),
    distance: 1.7,
    interior: 'ivs',
    needsXray: true,
    color: '#ff9e8a',
    blurb:
      'The interventricular septum, the muscular wall between the two ventricles. A hole here, a ventricular septal defect, is one of the most common heart defects at birth.',
  },
  {
    id: 'ias',
    label: 'Interatrial septum',
    group: 'inside',
    aliases: ['interatrial septum', 'atrial septum', 'septum between the atria'],
    anchor: SEPTUM_CENTROIDS.ias,
    view: norm([-0.92, -0.12, 0.37]),
    distance: 1.5,
    interior: 'ias',
    needsXray: true,
    color: '#ff9e8a',
    blurb: 'The interatrial septum. Before birth an opening in it, the foramen ovale, lets blood bypass the lungs; it normally seals after birth.',
  },
];

function valve(
  id: ValveId,
  label: string,
  aliases: string[],
  view: Vec3,
  distance: number,
  color: string,
  blurb: string,
): SegmentDef {
  return {
    id: id === 'pulmonary' ? 'pulmonaryValve' : id === 'aortic' ? 'aorticValve' : id,
    label,
    group: 'inside',
    aliases,
    anchor: VALVES[id].centre,
    view,
    distance,
    interior: id,
    needsXray: true,
    color,
    blurb,
  };
}

/** Where to fly for a part's chamber cast when the shell is see-through. */
export function insideFocus(part: SegmentDef): { anchor: Vec3; distance: number } | null {
  const id = part.interior;
  if (id === 'ra' || id === 'rv' || id === 'la' || id === 'lv') {
    return { anchor: CHAMBER_CENTROIDS[id], distance: 1.9 };
  }
  return null;
}

/**
 * The circulation, in the order blood meets each part — the route of the
 * guided tour. Each stop says what the blood is doing there.
 */
export const BLOOD_ROUTE: Array<{ id: string; line: string }> = [
  { id: 'svc', line: 'Oxygen-poor blood from the upper body enters through the superior vena cava.' },
  { id: 'ra', line: 'It pools in the right atrium.' },
  { id: 'tricuspid', line: 'The tricuspid valve opens, and the blood drops into the right ventricle.' },
  { id: 'rv', line: 'The right ventricle contracts. The tricuspid valve slams shut behind it.' },
  { id: 'pulmonaryValve', line: 'Blood is pushed out through the pulmonary valve.' },
  { id: 'pt', line: 'Up the pulmonary trunk, which splits in two.' },
  { id: 'lpa', line: 'The pulmonary arteries carry it to the lungs, where it picks up oxygen.' },
  { id: 'pv', line: 'Now bright red, it returns through the pulmonary veins.' },
  { id: 'la', line: 'Into the left atrium.' },
  { id: 'mitral', line: 'Through the mitral valve.' },
  { id: 'lv', line: 'The left ventricle, the strongest chamber, gathers it for the big push.' },
  { id: 'aorticValve', line: 'It contracts, forcing the aortic valve open.' },
  { id: 'ascAorta', line: 'Blood surges up the ascending aorta.' },
  { id: 'arch', line: 'Around the arch, where the head and arms get their supply.' },
  { id: 'descAorta', line: 'And down the descending aorta, to the rest of the body. That is one full circuit, in about a minute.' },
];
