import { asset, absoluteAsset } from '../paths';
import type { HandLandmarks, TrackingFrame } from './types';

export interface TrackerHandle {
  /** The webcam element, exposed so a debug overlay can size itself to it. */
  video: HTMLVideoElement;
  /** Measured delivery rate of the camera, for diagnostics/telemetry. */
  cameraFps(): number;
  stop(): void;
}

interface WorkerResult {
  type: 'ready' | 'init-error' | 'result';
  message?: string;
  hands?: HandLandmarks[];
  timestamp?: number;
  inferenceMs?: number;
}

/**
 * Owns the webcam and marshals frames to the classic hand-tracking worker.
 *
 * The main thread only grabs the latest camera frame as an ImageBitmap and
 * transfers it (zero-copy) to the worker; heavy MediaPipe inference happens off
 * the main thread, so the render loop never blocks. A single-frame backpressure
 * flag drops frames while the worker is busy, keeping latency low rather than
 * building a queue.
 *
 * The worker is deliberately a *classic* worker (no `type: 'module'`): Vite
 * bundles it into one file where `importScripts` exists, which is the only
 * context MediaPipe's wasm loader works in.
 */
export async function startHandTracking(
  onFrame: (frame: TrackingFrame) => void,
): Promise<TrackerHandle> {
  // Loaded as a pre-bundled classic worker from a static path (not through
  // Vite's worker pipeline, which bundles classic workers only in a build and
  // not in dev). This IIFE is produced by `npm run build:worker`, so the same
  // off-main-thread tracking works identically in dev and production.
  const worker = new Worker(asset('handWorker.js'));

  await new Promise<void>((resolve, reject) => {
    const onMessage = (e: MessageEvent<WorkerResult>) => {
      if (e.data.type === 'ready') {
        worker.removeEventListener('message', onMessage);
        resolve();
      } else if (e.data.type === 'init-error') {
        worker.removeEventListener('message', onMessage);
        reject(new Error(e.data.message ?? 'hand-tracking worker init failed'));
      }
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', (e) => reject(new Error(e.message)), { once: true });
    // The worker resolves MediaPipe's wasm and model against its own location,
    // so it needs absolute URLs that already include the Pages base path.
    worker.postMessage({
      type: 'init',
      wasmPath: absoluteAsset('mediapipe/wasm'),
      modelPath: absoluteAsset('mediapipe/models/hand_landmarker.task'),
    });
  });

  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;

  // Lower resolution + an explicit frame rate: smaller frames are captured and
  // turned into bitmaps faster, and asking for 30 fps discourages the camera
  // from silently dropping to a laggy 15 fps under auto-exposure in dim light.
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: 480 },
      height: { ideal: 360 },
      frameRate: { ideal: 30, max: 30 },
      facingMode: 'user',
    },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();

  let running = true;
  let busy = false;
  let lastVideoTime = -1;

  // Rolling camera-frame-rate estimate so the UI can show whether the *camera*
  // (not the tracker) is the bottleneck.
  let lastFrameStamp = performance.now();
  let fpsEstimate = 0;

  worker.addEventListener('message', (e: MessageEvent<WorkerResult>) => {
    if (e.data.type !== 'result') return;
    busy = false;
    onFrame({
      hands: e.data.hands ?? [],
      timestamp: e.data.timestamp ?? performance.now(),
      inferenceMs: e.data.inferenceMs ?? 0,
    });
  });

  const pump = async () => {
    if (!running) return;

    if (video.currentTime !== lastVideoTime && video.readyState >= 2) {
      lastVideoTime = video.currentTime;

      const now = performance.now();
      const dt = now - lastFrameStamp;
      lastFrameStamp = now;
      if (dt > 0) fpsEstimate = fpsEstimate === 0 ? 1000 / dt : 0.85 * fpsEstimate + 0.15 * (1000 / dt);

      // Only dispatch when the worker is free; otherwise drop this frame.
      if (!busy) {
        busy = true;
        try {
          const bitmap = await createImageBitmap(video);
          worker.postMessage({ type: 'frame', bitmap, timestamp: now }, [bitmap]);
        } catch {
          busy = false;
        }
      }
    }

    if ('requestVideoFrameCallback' in video) {
      (video as HTMLVideoElement).requestVideoFrameCallback(() => void pump());
    } else {
      requestAnimationFrame(() => void pump());
    }
  };
  void pump();

  return {
    video,
    cameraFps: () => Math.round(fpsEstimate),
    stop() {
      running = false;
      stream.getTracks().forEach((track) => track.stop());
      worker.terminate();
    },
  };
}
