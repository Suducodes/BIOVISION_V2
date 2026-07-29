/// <reference lib="webworker" />
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type { HandLandmarks } from './types';

/**
 * Hand-tracking worker (CLASSIC worker — see below).
 *
 * MediaPipe's `detectForVideo` is synchronous; on the main thread it stalls the
 * render loop for the length of every inference, which is the "laggy" jank the
 * demo suffered from. Running it here keeps the 3D view at a locked frame rate
 * regardless of inference cost. Frames arrive as transferred ImageBitmaps and
 * results return as plain landmark arrays.
 *
 * Why classic, not a module worker: MediaPipe loads its wasm glue with
 * `importScripts`, which only exists in classic workers. In a module worker it
 * falls back to a dynamic `import()` that Vite rewrites and mis-serves, giving
 * "Failed to fetch … vision_wasm_internal.js?import" (dev) or "ModuleFactory
 * not set" (build). Vite bundles this file into a single classic worker (the
 * Worker is constructed without `type: 'module'`), so `importScripts` is present
 * and the wasm loads correctly.
 *
 * Delegate: GPU inference is roughly 2x faster than CPU in this model (measured
 * ~15-22ms vs ~30-40ms on desktop; on constrained mobile silicon the gap
 * matters even more, since CPU WASM SIMD alone can land in the 60-100ms range
 * per inference — the dominant cost behind visible "hand lags a second behind"
 * lag). GPU is tried first; if the device/browser can't create a GPU delegate
 * in a worker, this transparently falls back to CPU so tracking still works,
 * just slower.
 */

let landmarker: HandLandmarker | null = null;
const post = (msg: unknown, transfer?: Transferable[]) =>
  (self as DedicatedWorkerGlobalScope).postMessage(msg, transfer ?? []);

async function createLandmarker(
  wasmPath: string,
  modelPath: string,
  delegate: 'GPU' | 'CPU',
): Promise<HandLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(wasmPath);
  return HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: modelPath, delegate },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.6,
    minTrackingConfidence: 0.6,
  });
}

/**
 * The GPU delegate's first inference pays a one-off shader-compilation cost —
 * multiple seconds, observed at ~2.2s during testing — that would otherwise
 * land on the user's first real gesture as a jarring stall. Paying it here, on
 * a throwaway blank frame before `ready` is posted, means it happens during the
 * "starting camera" wait instead.
 */
function warmUp(active: HandLandmarker): void {
  try {
    const blank = new OffscreenCanvas(224, 168);
    blank.getContext('2d')?.fillRect(0, 0, 224, 168);
    active.detectForVideo(blank, performance.now());
  } catch {
    // Best-effort; a failed warm-up frame just means the cost is paid later.
  }
}

async function init(wasmPath: string, modelPath: string): Promise<void> {
  try {
    try {
      landmarker = await createLandmarker(wasmPath, modelPath, 'GPU');
      warmUp(landmarker);
      post({ type: 'ready', delegate: 'GPU' });
    } catch (gpuError) {
      landmarker = await createLandmarker(wasmPath, modelPath, 'CPU');
      warmUp(landmarker);
      post({ type: 'ready', delegate: 'CPU', gpuError: String(gpuError) });
    }
  } catch (error) {
    post({ type: 'init-error', message: String(error) });
  }
}

type InboundMessage =
  | { type: 'init'; wasmPath: string; modelPath: string }
  | { type: 'frame'; bitmap: ImageBitmap; timestamp: number };

self.onmessage = async (event: MessageEvent<InboundMessage>) => {
  const msg = event.data;

  if (msg.type === 'init') {
    await init(msg.wasmPath, msg.modelPath);
    return;
  }

  if (msg.type === 'frame') {
    if (!landmarker) {
      msg.bitmap.close();
      return;
    }
    const t0 = performance.now();
    let hands: HandLandmarks[] = [];
    try {
      const result = landmarker.detectForVideo(msg.bitmap, msg.timestamp);
      hands = result.landmarks as HandLandmarks[];
    } catch {
      // Transient detect failures shouldn't wedge the pipeline; skip the frame.
    }
    msg.bitmap.close();
    post({ type: 'result', hands, timestamp: msg.timestamp, inferenceMs: performance.now() - t0 });
  }
};
