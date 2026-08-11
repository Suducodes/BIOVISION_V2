import * as THREE from 'three';
import './style.css';
import { createStage } from './render/scene';
import { loadAnatomicalModel } from './render/modelLoader';
import { disposeSpecimen } from './render/disposeSpecimen';
import { GhostHand } from './render/ghostHand';
import { unprojectLandmark } from './render/unprojectLandmark';
import { InteractionController } from './controller/interactionController';
import { attachMouseInput } from './input/mouseInput';
import { Hud } from './ui/hud';
import { StatusUi } from './ui/statusUi';
import { SettingsPanel } from './ui/settingsPanel';
import { startHandTracking, type TrackerHandle } from './gesture/handTracker';
import { GestureClassifier } from './gesture/gestureClassifier';
import { GestureMapper } from './gesture/gestureMapper';
import { HandOverlay } from './gesture/handOverlay';
import { LM, type GestureMode, type HandLandmarks } from './gesture/types';
import { ORGANS, type OrganDef } from './organs';
import { buildOrganSwitcher, setActiveOrgan } from './ui/organSwitcher';
import { SurgiLearn, CORONARY_SPECIMENS } from './surgilearn';
import { loadCaseModel, type SpecimenModel } from './surgilearn/specimenLoader';
import { findCase } from './surgilearn/cases';
import { TraceChallenge } from './surgilearn/trace/traceChallenge';
import { TracePanel } from './surgilearn/trace/tracePanel';

// The anatomical library plus the SurgiLearn coronary case library. Appending
// rather than replacing keeps the original two specimens exactly where the
// EMBC demo left them, and makes the switcher itself the model selector.
const SPECIMENS: OrganDef[] = [...ORGANS, ...CORONARY_SPECIMENS];

async function boot(): Promise<void> {
  const app = document.getElementById('app')!;
  const viewport = document.getElementById('viewport')!;
  const topBar = document.getElementById('top-bar')!;
  const overlay = document.getElementById('loading-overlay')!;
  const loadingText = document.getElementById('loading-text')!;
  const trackerCanvas = document.getElementById('tracker-canvas') as HTMLCanvasElement;
  const enableButton = document.getElementById('enable-camera') as HTMLButtonElement;
  const hologramToggle = document.getElementById('hologram-toggle') as HTMLButtonElement;

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
  let surgilearn: SurgiLearn | undefined;

  const loadOrgan = async (organ: OrganDef): Promise<void> => {
    if (switching) return;
    switching = true;
    overlay.classList.remove('hidden');
    loadingText.textContent = `Loading ${organ.label.toLowerCase()}…`;

    const onProgress = (fraction: number) => {
      loadingText.textContent = `Loading ${organ.label.toLowerCase()}… ${Math.round(fraction * 100)}%`;
    };

    // Coronary cases go through the SurgiLearn loader, which falls back to the
    // procedural arterial tree when the GLB has not been supplied yet.
    const caseDef = findCase(organ.caseId);
    const model: SpecimenModel = caseDef
      ? await loadCaseModel(caseDef, organ.url, onProgress)
      : { ...(await loadAnatomicalModel(organ.url, onProgress)), origin: 'glb' };

    // Swap the specimen and reset the view so each organ opens framed and level.
    // `clear()` only detaches the outgoing children from the scene graph — it
    // never frees their GPU buffers — so every mesh under the pivot (the old
    // specimen, and any SurgiLearn colliders/proxies parented alongside it)
    // must be disposed explicitly first, or geometries and textures accumulate
    // on every switch for the life of the session.
    for (const child of stage.pivot.children) disposeSpecimen(child);
    stage.pivot.clear();
    stage.pivot.add(model.root);
    stage.frameSubject(model.radius);
    controller.reset();
    zoomFar = stage.framingDistance;
    zoomNear = model.radius * 0.06;

    const provenance =
      model.origin === 'procedural'
        ? 'procedural coronary tree (no GLB supplied)'
        : organ.source;

    status.setSpecimen(organ.logTitle, [
      ['Source', provenance],
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

    surgilearn?.onSpecimenLoaded(organ, model.root, model.origin);
  };

  status.setMode('IDLE');
  await loadOrgan(SPECIMENS[0]!);
  buildOrganSwitcher(SPECIMENS, SPECIMENS[0]!.id, (organ) => void loadOrgan(organ));

  // --- SurgiLearn simulation layer --------------------------------------
  // Purely additive: it observes the stage and owns its own panels, and every
  // piece of challenge state lives inside it, so EXPLORE mode is the original
  // platform untouched.
  surgilearn = new SurgiLearn({
    stage,
    root: app,
    topBar,
    async requestSpecimen(id: string) {
      const specimen = SPECIMENS.find((s) => s.id === id);
      if (!specimen) return;
      setActiveOrgan(id);
      await loadOrgan(specimen);
    },
  });
  // The first specimen loaded before the layer existed, so hand it over now.
  surgilearn.onSpecimenLoaded(SPECIMENS[0]!, stage.pivot.children[0]!, 'glb');

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

  // The holographic tracked-hand — camera-relative, not pivot-relative, so
  // rotating the specimen never rotates the hand hovering over it.
  const ghostHand = new GhostHand(stage.scene);

  // The Steady Hand psychomotor trace challenge — tracks the pivot's
  // transform (see TraceChallenge.syncToPivot; it can't simply be parented
  // to the pivot, since loadOrgan's pivot.clear() on every specimen switch
  // would sweep it away), so the guide path rotates with whatever specimen
  // is loaded. Deliberately independent of EXPLORE/CHALLENGE mode: it runs
  // on top of whichever specimen happens to be on screen.
  const traceChallenge = new TraceChallenge(stage.scene);
  const tracePanel = new TracePanel(app, {
    onStart: () => {
      traceChallenge.start();
      tracePanel.showLive();
    },
    onFinish: () => {
      const result = traceChallenge.finish();
      tracePanel.showResult(result);
    },
  });
  tracePanel.hide();

  const traceToggle = document.createElement('button');
  traceToggle.type = 'button';
  traceToggle.className = 'sl-dash-button';
  traceToggle.title = 'Steady Hand — psychomotor trace challenge';
  traceToggle.textContent = '🎯';
  traceToggle.addEventListener('click', () => {
    if (tracePanel.visible) {
      tracePanel.hide();
      traceChallenge.stop();
    } else {
      tracePanel.reset();
      tracePanel.show();
    }
  });
  document.getElementById('hud')!.insertAdjacentElement('beforebegin', traceToggle);
  const fingerWorld = new THREE.Vector3();

  // Decouples "a hand is visible" from "the hand is manipulating the
  // specimen". Without this, simply holding a hand up to admire the hologram
  // also drags/zooms the organ — the manipulation model maps hand position
  // straight onto specimen position unconditionally, by design (see
  // interactionController.ts), so there was previously no way to hold the
  // hand still to inspect it without the organ following along.
  let hologramOnly = false;
  hologramToggle.addEventListener('click', () => {
    hologramOnly = !hologramOnly;
    hologramToggle.setAttribute('aria-pressed', String(hologramOnly));
  });

  const enableGestures = async () => {
    enableButton.disabled = true;
    enableButton.textContent = 'STARTING CAMERA…';
    try {
      tracker = await startHandTracking((frame) => {
        const signals = classifier.classify(frame.hands);
        if (!hologramOnly) mapper.apply(signals);
        // The fingertip doubles as a touchless cursor for the challenge layer;
        // it never feeds back into the manipulation pipeline.
        surgilearn?.setGestureTip(signals.indexTip);
        latestHands = frame.hands;
        // Frozen mode has no GRAB/ROTATE state of its own — showing the
        // gesture classifier's mode while manipulation is disabled would
        // read as active when it isn't.
        latestMode = hologramOnly ? 'IDLE' : signals.mode;
        status.setMode(latestMode);
        hud.markTracking(frame.inferenceMs);
      });
      overlayRenderer = new HandOverlay(trackerCanvas, tracker.video);
      enableButton.classList.add('hidden');
      hologramToggle.classList.remove('hidden');
      document.getElementById('tracker-delegate')!.textContent = tracker.delegate;
      console.info(`[bio-vision] hand tracking using ${tracker.delegate} delegate`);
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
      surgilearn,
      ghostHand,
      traceChallenge,
      tracePanel,
      renderOnce: () => stage.renderer.render(stage.scene, stage.camera),
    },
  });

  const clock = new THREE.Clock();
  const renderLoop = () => {
    requestAnimationFrame(renderLoop);
    const delta = clock.getDelta();
    controller.update(delta);

    // Map smoothed zoom onto the camera dolly. Eased so the last stretch — the
    // dive through the surface into the interior — slows down and reads clearly.
    const z = controller.zoom;
    const eased = z * z * (3 - 2 * z); // smoothstep
    stage.camera.position.z = zoomFar + (zoomNear - zoomFar) * eased;
    // Fade the headlamp in as the camera approaches and enters the specimen, so
    // the interior is lit without washing out the exterior beauty shot.
    stage.headlamp.intensity = 14 * eased;

    hud.setZoom(z);
    // Runs after the controller so the challenge layer reads the same
    // orientation the frame is about to be drawn with.
    surgilearn?.update(delta * 1000);
    // Primary hand only, matching the single-hand scope of the first pass —
    // undefined (no hand tracked, or tracking not enabled) hides the group.
    ghostHand.update(latestHands[0], stage.camera, stage.pivot);

    if (traceChallenge.active || tracePanel.visible) {
      traceChallenge.syncToPivot(stage.pivot);
      const primaryHand = latestHands[0];
      let fingerPos: THREE.Vector3 | null = null;
      if (primaryHand) {
        const hoverDistance = Math.max(
          0.4,
          stage.camera.position.distanceTo(stage.pivot.position) * 0.55,
        );
        fingerPos = unprojectLandmark(primaryHand[LM.INDEX_TIP]!, stage.camera, hoverDistance, fingerWorld);
      }
      const completed = traceChallenge.update(fingerPos, delta * 1000, clock.elapsedTime);
      if (completed) tracePanel.showResult(completed);
      else if (traceChallenge.active) tracePanel.renderLive(traceChallenge.liveAccuracyPct, traceChallenge.liveElapsedMs);
    }

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
