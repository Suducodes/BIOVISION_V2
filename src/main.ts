import * as THREE from 'three';
import './style.css';
import { createStage } from './render/scene';
import { loadAnatomicalModel } from './render/modelLoader';
import { disposeSpecimen } from './render/disposeSpecimen';
import { InteractionController } from './controller/interactionController';
import { attachMouseInput } from './input/mouseInput';
import { Hud } from './ui/hud';
import { StatusUi } from './ui/statusUi';
import { SettingsPanel } from './ui/settingsPanel';
import { startHandTracking, type TrackerHandle } from './gesture/handTracker';
import { GestureClassifier } from './gesture/gestureClassifier';
import { GestureMapper } from './gesture/gestureMapper';
import { HandOverlay } from './gesture/handOverlay';
import { GestureCoach } from './ui/gestureCoach';
import { heartbeat } from './render/heartbeat';
import type { GestureMode, HandLandmarks } from './gesture/types';
import { ORGANS, type OrganDef } from './organs';
import { buildOrganSwitcher, setActiveOrgan } from './ui/organSwitcher';
import { SurgiLearn, CORONARY_SPECIMENS } from './surgilearn';
import { loadCaseModel, type SpecimenModel } from './surgilearn/specimenLoader';
import { findCase } from './surgilearn/cases';
import { CatheterNav } from './surgilearn/catheter/catheterNav';
import { CatheterPanel } from './surgilearn/catheter/catheterPanel';
import { CatheterOverlay } from './surgilearn/catheter/catheterOverlay';
import { CatheterCue } from './surgilearn/catheter/catheterCue';

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
  const pointerToggle = document.getElementById('pointer-toggle') as HTMLButtonElement;

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
  let catheterNav: CatheterNav | undefined;
  let catheterPanel: CatheterPanel | undefined;
  let catheterToggle: HTMLButtonElement | undefined;

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
    catheterNav?.onSpecimenLoaded(caseDef, model.root);
    // Catheter navigation needs a coronary case — there is no vessel lumen to
    // steer through on the heart or lungs. Without this the button stays fully
    // opaque and silently does nothing on those specimens, which reads as a
    // broken control rather than an inapplicable one.
    if (catheterToggle) {
      catheterToggle.disabled = !caseDef;
      catheterToggle.title = caseDef
        ? 'Catheter navigation — steer a guidewire through the coronary lumen'
        : 'Catheter navigation — load a coronary case (Case 1–3) first';
    }
    if (caseDef) {
      catheterPanel?.setMission(
        caseDef.lesion
          ? `Navigate the ${caseDef.lesion.vessel} and cross the stenosis. Push your hand up to advance, down to withdraw; steer with left/right and tilt to stay centred — the wall doesn't forgive contact.`
          : `Navigate the LAD end to end and confirm it's clean. Push your hand up to advance, down to withdraw; steer with left/right and tilt to stay centred.`,
      );
    }
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
  // Catheter steering reads this instead of the EMA-smoothed set: CatheterNav
  // runs its own damping (STEER_SMOOTH_MS/ADVANCE_SMOOTH_MS), tuned against
  // raw input, so feeding it pre-smoothed landmarks stacks two filters and
  // shows up as steering lag with no extra stability to show for it.
  let latestRawHands: HandLandmarks[] = [];
  let latestMode: GestureMode = 'IDLE';
  let tracker: TrackerHandle | undefined;

  // Gesture vocabulary, shown beside the camera feed once tracking is live.
  // Mounted directly under the video (and its overlay buttons, which live in
  // their own positioned wrapper — see .tracker-video-wrap in style.css) so
  // the panel reads top to bottom as: what the camera sees → what the
  // system understands → controls.
  const gestureCoach = new GestureCoach(
    document.getElementById('tracker-panel')!,
    document.querySelector<HTMLElement>('.tracker-video-wrap')!,
  );

  // Catheter navigation — tracks the pivot's transform every frame (see
  // CatheterNav.syncToPivot; it can't simply be parented to the pivot, since
  // loadOrgan's pivot.clear() on every specimen switch would sweep it away).
  // Deliberately independent of EXPLORE/CHALLENGE mode: it runs on top of
  // whichever coronary case happens to be loaded.
  catheterNav = new CatheterNav(stage.scene);
  catheterNav.onSpecimenLoaded(findCase(SPECIMENS[0]!.caseId));
  const catheterOverlay = new CatheterOverlay(app);
  // Mounted inside the video wrapper so it sits over the camera feed itself,
  // scaling with it when focus mode enlarges the panel.
  const catheterCue = new CatheterCue(
    document.querySelector<HTMLElement>('.tracker-video-wrap')!,
  );
  // Focus mode clears the mission/dashboard/log panels out of the way — the
  // split view needs the whole screen, and those belong to the other modes.
  const setCatheterFocus = (on: boolean) => {
    document.body.classList.toggle('catheter-focus', on);
    if (on) catheterCue.show();
    else catheterCue.hide();
  };

  catheterPanel = new CatheterPanel(app, {
    onStart: () => {
      catheterNav!.start();
      catheterPanel!.showLive();
      setCatheterFocus(true);
    },
    onFinish: () => {
      const result = catheterNav!.finish();
      catheterPanel!.showResult(result);
      catheterOverlay.hide();
      setCatheterFocus(false);
    },
  });
  catheterPanel.hide();

  catheterToggle = document.createElement('button');
  catheterToggle.type = 'button';
  catheterToggle.className = 'sl-dash-button';
  catheterToggle.title = 'Catheter navigation — load a coronary case (Case 1–3) first';
  catheterToggle.textContent = '🧭';
  catheterToggle.disabled = !catheterNav.ready;
  catheterToggle.addEventListener('click', () => {
    if (catheterPanel!.visible) {
      catheterPanel!.hide();
      catheterOverlay.hide();
      catheterNav!.stop();
      setCatheterFocus(false);
    } else if (catheterNav!.ready) {
      catheterPanel!.reset();
      catheterPanel!.show();
    }
  });
  document.getElementById('hud')!.insertAdjacentElement('beforebegin', catheterToggle);

  // One hand normally drives GRAB (move + zoom) and the touchless identify
  // cursor at once — signals.indexTip feeds the hover probe every frame
  // regardless of mode, unconditionally, a few lines below. That means
  // pointing at a vessel to hold on it also drags/zooms the specimen out
  // from under the fingertip, which makes CHALLENGE mode's identify
  // objectives fight the manipulation pipeline instead of cooperating with
  // it. This toggle freezes manipulation the same way catheter-nav already
  // does while it's steering, so the hand can point without also moving
  // anything.
  let pointerOnly = false;
  pointerToggle.addEventListener('click', () => {
    pointerOnly = !pointerOnly;
    pointerToggle.setAttribute('aria-pressed', String(pointerOnly));
  });

  const enableGestures = async () => {
    enableButton.disabled = true;
    enableButton.textContent = 'STARTING CAMERA…';
    try {
      tracker = await startHandTracking((frame) => {
        const signals = classifier.classify(frame.hands);
        // Catheter navigation hijacks the tracked hand for steering the same
        // way pointer mode hijacks it for identifying — either one means the
        // hand's motion must not also drag/zoom the specimen at the same time.
        const suppressManipulation = pointerOnly || catheterNav!.active;
        if (!suppressManipulation) mapper.apply(signals);
        // The fingertip doubles as a touchless cursor for the challenge layer;
        // it never feeds back into the manipulation pipeline.
        surgilearn?.setGestureTip(signals.indexTip);
        // The classifier's smoothed skeleton, not the tracker's raw per-frame
        // output — catheter-nav steering benefits from the same EMA the
        // manipulation pipeline already relies on to feel stable.
        latestHands = classifier.smoothedHands;
        latestRawHands = frame.hands;
        // Frozen mode has no GRAB/ROTATE state of its own — showing the
        // gesture classifier's mode while manipulation is disabled would
        // read as active when it isn't.
        latestMode = suppressManipulation ? 'IDLE' : signals.mode;
        status.setMode(latestMode);
        gestureCoach.setMode(latestMode);
        hud.markTracking(frame.inferenceMs);
      });
      overlayRenderer = new HandOverlay(trackerCanvas, tracker.video);
      enableButton.classList.add('hidden');
      pointerToggle.classList.remove('hidden');
      gestureCoach.show();
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
      catheterNav,
      catheterPanel,
      renderOnce: () => stage.renderer.render(stage.scene, stage.camera),
    },
  });

  // Split-view rendering when catheter navigation is active: the same
  // renderer draws the scene twice into two halves of one canvas via
  // viewport/scissor, rather than standing up a second canvas — cheap, and
  // every DOM overlay (panels, HUD) keeps working unmodified since only the
  // WebGL draw itself is split.
  const MIN_SPLIT_WIDTH = 900;
  const canvasSize = new THREE.Vector2();

  // A living specimen, not a static model — see render/heartbeat.ts for the
  // envelope. Applied to the pivot so it carries through to whatever's
  // currently loaded without per-specimen wiring.
  const HEARTBEAT_SCALE = 0.028;
  // The pulse eases out the moment a hand is tracked, and back in when the
  // hand leaves. A specimen that keeps breathing while someone is trying to
  // hold a fingertip on a 5mm vessel is actively fighting them — the beat is
  // for the idle "this is alive" beat of the demo, not for while you work.
  let heartbeatGain = 1;
  const HEARTBEAT_FADE_PER_S = 4;

  const clock = new THREE.Clock();
  const renderLoop = () => {
    requestAnimationFrame(renderLoop);
    const delta = clock.getDelta();
    controller.update(delta);

    const handPresent = latestHands.length > 0;
    const gainTarget = handPresent ? 0 : 1;
    heartbeatGain += (gainTarget - heartbeatGain) * Math.min(1, HEARTBEAT_FADE_PER_S * delta);
    stage.pivot.scale.setScalar(
      1 + heartbeat(clock.elapsedTime) * HEARTBEAT_SCALE * heartbeatGain,
    );

    const catheterOn = catheterNav!.active;

    if (catheterOn) {
      // The hand now steers the catheter, not the specimen dolly — freeze the
      // overview camera wherever it was when navigation started rather than
      // letting a stale zoom target keep easing it toward the surface.
      catheterNav!.syncToPivot(stage.pivot);
    } else {
      // Map smoothed zoom onto the camera dolly. Eased so the last stretch —
      // the dive through the surface into the interior — slows down and
      // reads clearly.
      const z = controller.zoom;
      const eased = z * z * (3 - 2 * z); // smoothstep
      stage.camera.position.z = zoomFar + (zoomNear - zoomFar) * eased;
      // Fade the headlamp in as the camera approaches and enters the
      // specimen, so the interior is lit without washing out the exterior
      // beauty shot.
      stage.headlamp.intensity = 14 * eased;
      hud.setZoom(z);
    }

    // Runs after the controller so the challenge layer reads the same
    // orientation the frame is about to be drawn with.
    surgilearn?.update(delta * 1000);


    if (catheterOn || catheterPanel!.visible) {
      const primaryHand = latestRawHands[0];
      const completed = catheterNav!.update(primaryHand, delta * 1000, clock.elapsedTime);
      if (completed) {
        catheterPanel!.showResult(completed);
        catheterOverlay.hide();
        setCatheterFocus(false);
      } else if (catheterOn) {
        catheterPanel!.renderLive(catheterNav!.liveProgressPct, catheterNav!.liveWallContacts, catheterNav!.liveElapsedMs);
        catheterOverlay.show();
        catheterOverlay.setLesionMarker(catheterNav!.lesionAt);
        catheterOverlay.update(catheterNav!.liveProgressPct, catheterNav!.liveWallContact);
        // Cue goes quiet once the hand is actually inside the band the
        // advance/steer axes read from — same constants as catheterNav.
        const tip = primaryHand?.[8];
        catheterCue.setLocked(
          !!tip && tip.y > 0.16 && tip.y < 0.84 && tip.x > 0.28 && tip.x < 0.72,
        );
      }
    }

    stage.renderer.getSize(canvasSize);
    if (catheterOn && canvasSize.x >= MIN_SPLIT_WIDTH) {
      const halfW = Math.floor(canvasSize.x / 2);
      const rightW = canvasSize.x - halfW;

      stage.camera.aspect = halfW / canvasSize.y;
      stage.camera.updateProjectionMatrix();
      catheterNav!.camera.aspect = rightW / canvasSize.y;
      catheterNav!.camera.updateProjectionMatrix();

      stage.renderer.setScissorTest(true);
      stage.renderer.setViewport(0, 0, halfW, canvasSize.y);
      stage.renderer.setScissor(0, 0, halfW, canvasSize.y);
      stage.renderer.render(stage.scene, stage.camera);

      stage.renderer.setViewport(halfW, 0, rightW, canvasSize.y);
      stage.renderer.setScissor(halfW, 0, rightW, canvasSize.y);
      stage.renderer.render(stage.scene, catheterNav!.camera);

      stage.renderer.setScissorTest(false);
      stage.renderer.setViewport(0, 0, canvasSize.x, canvasSize.y);
    } else if (catheterOn) {
      // Too narrow to split legibly — the catheter view alone is more
      // useful than two illegible slivers.
      catheterNav!.camera.aspect = canvasSize.x / canvasSize.y;
      catheterNav!.camera.updateProjectionMatrix();
      stage.renderer.render(stage.scene, catheterNav!.camera);
    } else {
      stage.camera.aspect = canvasSize.x / canvasSize.y;
      stage.camera.updateProjectionMatrix();
      stage.renderer.render(stage.scene, stage.camera);
    }

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
