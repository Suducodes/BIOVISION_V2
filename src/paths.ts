/**
 * Base-aware asset URLs.
 *
 * In dev the app is served from `/`; on GitHub Pages it lives under
 * `/BIOVISION_V2/`. Vite exposes the active base as `import.meta.env.BASE_URL`,
 * so every runtime fetch/Worker/loader path is built through here rather than
 * hard-coded to `/…`, which would break under the Pages subpath.
 */
const BASE = import.meta.env.BASE_URL;

/** Relative asset URL, e.g. `asset('models/heart.glb')`. */
export function asset(path: string): string {
  return `${BASE}${path.replace(/^\//, '')}`;
}

/** Absolute asset URL — needed where a relative path can't resolve, e.g. a
 *  worker resolving MediaPipe's wasm against its own location. */
export function absoluteAsset(path: string): string {
  return new URL(asset(path), location.href).href;
}
