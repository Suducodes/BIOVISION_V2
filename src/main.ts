import * as THREE from 'three';
import './style.css';
import { createStage } from './render/scene';
import { loadAnatomicalModel } from './render/modelLoader';
import { InteractionController } from './controller/interactionController';
import { attachMouseInput } from './input/mouseInput';
import { Hud } from './ui/hud';
import { StatusUi } from './ui/statusUi';
import { SettingsPanel } from './ui/settingsPanel';
import { startHandTracking, type TrackerHandle } from './gesture/handTracker';
import { GestureClassifier } from './gesture/gestureClassifier';
import { GestureMapper } from './gesture/gestureMapper';
import { HandOverlay } from './gesture/handOverlay';
import type { GestureMode, HandLandmarks } from './gesture/types';
import { ORGANS, type OrganDef } from './organs';
import { buildOrganSwitcher } from './ui/organSwitcher';

async function boot(): Promise<void> {
  const viewport = document.getElementById('viewport')!;
  const overlay = document.getElementById('loading-overlay')!;
  const loadingText = document.getElementById('loading-text')!;
  const trackerCanvas = document.getElementById('tracker-canvas') as HTMLCanvasElement;
  const enableButton = document.getElementById('enable-camera') as HTMLButtonElement;

  const stage = createStage(viewport);
  const controller = new InteractionController(stage.pivot);
  const hud = new Hud();
  const status = new StatusUi();

  attachMouseInput(stage.renderer.domElement, controller);

  // Zoom is a camera dolly from the framing distance (whole specimen in view)
  // to a point deep inside the mesh; both ends depend on the loaded organ's
  // size, so they are recomputed on every swap.
  let zoomFar = stage.framingDistance;
  let zoomNear = 0.1;
  let switching = false;

  const loadOrgan = async (organ: OrganDef): Promise<void> => {
    if (switching) return;
    switching = true;
    overlay.classList.remove('hidden');
    loadingText.textContent = `Loading ${organ.label.toLowerCase()}…`;

    const model = await loadAnatomicalModel(organ.url, (fraction) => {
      loadingText.textContent = `Loading ${organ.label.toLowerCase()}… ${Math.round(fraction * 100)}%`;
    });

    // Swap the specimen and reset the view so each organ opens framed and level.
    stage.pivot.clear();
    stage.pivot.add(model.root);
    stage.frameSubject(model.radius);
    controller.reset();
    zoomFar = stage.framingDistance;
    zoomNear = model.radius * 0.06;

    status.setSpecimen(organ.logTitle, [
      ['Source', organ.source],
      ['Load', `${model.loadMs.toFixed(0)} ms`],
      ['Meshes', `${model.materials.length} part(s)`],
      ['Zoom', 'camera dives inside the specimen'],
    ]);
    console.info(
      `[bio-vision] ${organ.id} ready in ${model.loadMs.toFixed(0)} ms · ` +
        `${model.materials.length} material(s) · radius ${model.radius.toFixed(2)}`,
    );

    overlay.classList.add('hidden');
    switching = false;
  };

  status.setMode('IDLE');
  await loadOrgan(ORGANS[0]!);
  buildOrganSwitcher(ORGANS, ORGANS[0]!.id, (organ) => void loadOrgan(organ));

  // --- Gesture pipeline -------------------------------------------------
  // The mapper is driven at tracking cadence (~30 fps); the controller it
  // writes to is interpolated at render cadence (60 Hz) below. Latest tracking
  // output is stashed so the render loop paints the overlay smoothly without
  // waiting on inference.
  const classifier = new GestureClassifier();
  const mapper = new GestureMapper(controller);
  // Applies persisted calibration to the renderer, controller and mapper.
  new SettingsPanel(stage.renderer, controller, mapper);
  const cameraFpsEl = document.getElementById('camera-fps')!;
  let overlayRenderer: HandOverlay | undefined;
  let latestHands: HandLandmarks[] = [];
  let latestMode: GestureMode = 'IDLE';
  let tracker: TrackerHandle | undefined;

  const enableGestures = async () => {
    enableButton.disabled = true;
    enableButton.textContent = 'STARTING CAMERA…';
    try {
      tracker = await startHandTracking((frame) => {
        const signals = classifier.classify(frame.hands);
        mapper.apply(signals);
        latestHands = frame.hands;
        latestMode = signals.mode;
        status.setMode(signals.mode);
        hud.markTracking(frame.inferenceMs);
      });
      overlayRenderer = new HandOverlay(trackerCanvas, tracker.video);
      enableButton.classList.add('hidden');
    } catch (error) {
      console.error('[bio-vision] camera failed', error);
      enableButton.disabled = false;
      enableButton.textContent = 'CAMERA BLOCKED — RETRY';
    }
  };
  enableButton.addEventListener('click', enableGestures);

  // Debug handle for console inspection and single-stepping while the tab is
  // backgrounded (which suspends requestAnimationFrame).
  Object.assign(window, {
    __biovision: {
      stage,
      controller,
      loadOrgan,
      enableGestures,
      renderOnce: () => stage.renderer.render(stage.scene, stage.camera),
    },
  });

  const clock = new THREE.Clock();
  const renderLoop = () => {
    requestAnimationFrame(renderLoop);
    controller.update(clock.getDelta());

    // Map smoothed zoom onto the camera dolly. Eased so the last stretch — the
    // dive through the surface into the interior — slows down and reads clearly.
    const z = controller.zoom;
    const eased = z * z * (3 - 2 * z); // smoothstep
    stage.camera.position.z = zoomFar + (zoomNear - zoomFar) * eased;
    // Fade the headlamp in as the camera approaches and enters the specimen, so
    // the interior is lit without washing out the exterior beauty shot.
    stage.headlamp.intensity = 14 * eased;

    hud.setZoom(z);
    stage.renderer.render(stage.scene, stage.camera);
    overlayRenderer?.draw(latestHands, latestMode);
    hud.markRender();

    if (tracker) {
      const fps = tracker.cameraFps();
      cameraFpsEl.textContent = `${fps} fps`;
      // Below ~24 fps the camera itself is the bottleneck, not the tracker.
      cameraFpsEl.classList.toggle('low', fps > 0 && fps < 24);
    }
  };
  renderLoop();
}

boot().catch((error: unknown) => {
  console.error('[bio-vision] boot failed', error);
  const overlay = document.getElementById('loading-overlay')!;
  overlay.classList.add('error');
  overlay.classList.remove('hidden');
  document.getElementById('loading-text')!.textContent =
    error instanceof Error ? error.message : 'Failed to initialise Bio-Vision.';
});
