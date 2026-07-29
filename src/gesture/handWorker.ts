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
 * and the wasm loads correctly. The CPU delegate is used because a worker GPU
 * context is finicky and, off the main thread, CPU latency is invisible.
 */

let landmarker: HandLandmarker | null = null;
const post = (msg: unknown, transfer?: Transferable[]) =>
  (self as DedicatedWorkerGlobalScope).postMessage(msg, transfer ?? []);

async function init(wasmPath: string, modelPath: string): Promise<void> {
  try {
    const vision = await FilesetResolver.forVisionTasks(wasmPath);
    landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: modelPath,
        delegate: 'CPU',
      },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.6,
    });
    post({ type: 'ready' });
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
