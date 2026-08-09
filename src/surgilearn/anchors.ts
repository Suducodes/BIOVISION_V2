import type { RegionId } from './cases';

/**
 * Region anchors — how a patient-derived specimen gets its vessels labelled.
 *
 * A coronary CTA segmentation arrives as one unnamed mesh in patient
 * coordinates, usually fragmented into dozens of disconnected islands. Nothing
 * in the file says which island is the LAD, and no heuristic recovers it
 * reliably: measured against `case_182`, reference centrelines fitted to the
 * bounding box landed on the real surface 0% / 0% / 11% of the time. Guessing
 * would bake an anatomical error into a teaching tool.
 *
 * So a region on a real specimen is a point a clinician placed, expressed in
 * the pivot's local space — the normalised frame every model is fitted into on
 * load, longest axis = 2 units. That frame, rather than the mesh's own, is what
 * keeps an anchor meaningful: a scan's native coordinates are raw scanner
 * millimetres with an arbitrary origin. Anchors authored in the app land in
 * localStorage immediately; paste them into `cases.ts` to make them permanent.
 */

export interface Anchor {
  /** Position in the normalised pivot space (longest model axis = 2 units). */
  at: [number, number, number];
  /** Hit radius in the same units. Roughly a fingertip's worth of tolerance. */
  radius?: number;
}

export type AnchorSet = Partial<Record<RegionId, Anchor>>;

export const DEFAULT_ANCHOR_RADIUS = 0.16;

const STORAGE_KEY = 'surgilearn.anchors.v1';

type Persisted = Record<string, AnchorSet>;

function load(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Persisted) : {};
  } catch {
    return {};
  }
}

function save(data: Persisted): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* private mode — anchors just won't survive the session */
  }
}

/** Anchors authored in the app for one case, if any. */
export function loadAnchors(caseId: string): AnchorSet | undefined {
  const set = load()[caseId];
  return set && Object.keys(set).length > 0 ? set : undefined;
}

export function saveAnchor(caseId: string, region: RegionId, anchor: Anchor): void {
  const data = load();
  data[caseId] = { ...data[caseId], [region]: anchor };
  save(data);
}

export function clearAnchors(caseId: string): void {
  const data = load();
  delete data[caseId];
  save(data);
}

/** Source snippet ready to paste into a case definition in `cases.ts`. */
export function toSource(caseId: string, anchors: AnchorSet): string {
  const rows = Object.entries(anchors)
    .map(([region, a]) => {
      const [x, y, z] = a!.at.map((v) => v.toFixed(3));
      const radius = a!.radius ? `, radius: ${a!.radius}` : '';
      return `    ${region}: { at: [${x}, ${y}, ${z}]${radius} },`;
    })
    .join('\n');
  return `// ${caseId}\n  regionAnchors: {\n${rows}\n  },`;
}
