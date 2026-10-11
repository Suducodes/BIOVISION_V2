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
import { attachDropzone, looksLikeGlb } from './ui/dropzone';
import { PedalController } from './input/pedalController';
import { BlePedalController } from './input/blePedalController';
import { SegmentHighlighter } from './render/segmentHighlight';
import { HeartInterior } from './render/heartInterior';
import { HEARTBEAT_CYCLE_S } from './render/heartbeat';
import { VoiceNavigator } from './voice/voiceNavigator';
import { matchCommand, type Vocabulary } from './voice/commandMatcher';
import { Narrator } from './voice/narrator';
import { VoiceDirector } from './voice/voiceDirector';
import { VoicePanel } from './ui/voicePanel';
import { CaptionCard } from './ui/captionCard';
import { AtlasLabels } from './ui/atlasLabels';
import type { SegmentDef } from './segments';

async function boot(): Promise<void> {
  const app = document.getElementById('app')!;
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

  // Voice navigation state. The panel is built up front because loadOrgan
  // refreshes its part chips; the director that acts on commands is wired
  // further down, once the gesture mapper it cooperates with exists.
  let activeOrgan: OrganDef = ORGANS[0]!;
  let activeSegments: SegmentDef[] = [];
  let highlighter: SegmentHighlighter | null = null;
  let interior: HeartInterior | null = null;
  let director: VoiceDirector | undefined;
  const voicePanel = new VoicePanel(
    {
      onToggleListening: () => voiceToggle(),
      onChip: (id) => director?.pick(id),
      onMode: (mode) => director?.toggleMode(mode),
      onTyped: (text) => runText(text),
      onLanguage: (lang) => voice.setLanguage(lang),
    },
    VoiceNavigator.isSupported(),
  );
  const caption = new CaptionCard((id) => (id.startsWith('say:') ? runText(id.slice(4)) : director?.pick(id)));
  const labels = new AtlasLabels((id) => director?.pick(id));

  const loadOrgan = async (organ: OrganDef): Promise<void> => {
    if (switching) return;
    switching = true;
    overlay.classList.remove('hidden', 'error');
    loadingText.textContent = `Loading ${organ.label.toLowerCase()}…`;

    const onProgress = (fraction: number) => {
      loadingText.textContent = `Loading ${organ.label.toLowerCase()}… ${Math.round(fraction * 100)}%`;
    };

    try {
      const model = await loadAnatomicalModel(organ.url, onProgress);

      // Swap the specimen and reset the view so each organ opens framed and
      // level. `clear()` only detaches the outgoing children from the scene
      // graph — it never frees their GPU buffers — so every mesh under the
      // pivot must be disposed explicitly first, or geometries and textures
      // accumulate on every switch for the life of the session.
      interior?.dispose();
      interior = null;
      for (const child of stage.pivot.children) disposeSpecimen(child);
      highlighter?.dispose();
      highlighter = null;
      stage.pivot.clear();
      stage.pivot.add(model.root);
      stage.frameSubject(model.radius * (organ.fit ?? 1));
      controller.reset();
      zoomFar = stage.framingDistance;
      zoomNear = model.radius * 0.06;

      // Give the new specimen its named segments, if it has any.
      activeOrgan = organ;
      activeSegments = organ.segments ?? [];
      if (activeSegments.length > 0) {
        highlighter = new SegmentHighlighter(model.root, stage.pivot, activeSegments);
      }
      // The schematic interior is a separate small model; it streams in after
      // the specimen is already on screen, and is dropped if the user has
      // switched away by the time it arrives.
      if (organ.interior) {
        const forOrgan = organ;
        void HeartInterior.load(organ.interior)
          .then((loaded) => {
            if (activeOrgan !== forOrgan || interior) {
              loaded.dispose();
              return;
            }
            interior = loaded;
            stage.pivot.add(loaded.group);
            loaded.setFlow(director?.flow ?? false);
          })
          .catch((error: unknown) => console.warn('[bio-vision] interior failed to load', error));
      }
      voicePanel.setSegments(activeSegments);
      voicePanel.setActive(null);
      voicePanel.setFocus(null);
      director?.onSpecimenChanged();

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
    } catch (error) {
      // A dropped file is arbitrary user input — far likelier to be
      // malformed or simply not a glTF than the app's own bundled assets
      // ever were, so this needs a real failure path. Without it, an error
      // here left `switching` stuck true forever, silently disabling every
      // future specimen switch for the rest of the session.
      console.error(`[bio-vision] failed to load ${organ.label}`, error);
      overlay.classList.remove('hidden');
      overlay.classList.add('error');
      loadingText.textContent =
        error instanceof Error
          ? `Couldn't load ${organ.label}: ${error.message}`
          : `Couldn't load ${organ.label}.`;
      setTimeout(() => overlay.classList.add('hidden'), 2500);
    } finally {
      switching = false;
    }
  };

  status.setMode('IDLE');
  await loadOrgan(ORGANS[0]!);
  buildOrganSwitcher(ORGANS, ORGANS[0]!.id, (organ) => void loadOrgan(organ));

  // --- Drag-and-drop GLB loader -------------------------------------------
  // Reuses loadOrgan as-is: a dropped file just becomes an OrganDef-shaped
  // object whose url is a blob: URL, so the exact same lazy-load/dispose
  // path the built-in organs use already covers it — no special case needed
  // anywhere else in the app.
  attachDropzone(
    app,
    document.getElementById('drop-control')!,
    document.getElementById('drop-file-input') as HTMLInputElement,
    (file) => {
      if (!looksLikeGlb(file)) {
        loadingText.textContent = `"${file.name}" doesn't look like a .glb/.gltf file.`;
        overlay.classList.remove('hidden');
        overlay.classList.add('error');
        setTimeout(() => overlay.classList.add('hidden'), 2000);
        return;
      }
      const url = URL.createObjectURL(file);
      void loadOrgan({
        id: 'custom',
        label: file.name.replace(/\.(glb|gltf)$/i, ''),
        glyph: '📦',
        url,
        logTitle: 'CUSTOM SPECIMEN',
        source: `Dropped: ${file.name}`,
      }).finally(() => {
        // Safe the instant loadOrgan resolves or rejects: GLTFLoader has
        // already fully fetched the bytes behind the blob URL by then, so
        // revoking it doesn't race the load.
        URL.revokeObjectURL(url);
        setActiveOrgan('custom');
      });
    },
  );

  // --- Gesture pipeline -------------------------------------------------
  // The mapper is driven at tracking cadence (~30 fps); the controller it
  // writes to is interpolated at render cadence (60 Hz) below. Latest tracking
  // output is stashed so the render loop paints the overlay smoothly without
  // waiting on inference.
  const classifier = new GestureClassifier();
  const mapper = new GestureMapper(controller);
  // Applies persisted calibration to the renderer, controller and mapper.
  new SettingsPanel(stage.renderer, controller, mapper);

  // --- Voice navigation ---------------------------------------------------
  // Say a segment's name and the specimen turns to it, centres it, and flies
  // the camera in. Every move goes through the controller's ordinary damped
  // targets, so it is as smooth as a gesture and a hand takes over seamlessly.

  // Zoom is a smoothstep dolly (see the render loop); to land the camera a given
  // distance from the anchor, run that mapping backwards.
  const zoomForDistance = (distance: number): number => {
    const eased = Math.min(1, Math.max(0, (zoomFar - distance) / (zoomFar - zoomNear)));
    // Inverse of t²(3 − 2t).
    return 0.5 - Math.sin(Math.asin(1 - 2 * eased) / 3);
  };

  const narrator = new Narrator({ onSentence: (text) => caption.setSentence(text) });
  director = new VoiceDirector({
    controller,
    mapper,
    panel: voicePanel,
    caption,
    narrator,
    labels,
    parts: () => activeSegments,
    highlighter: () => highlighter,
    interior: () => interior,
    zoomForDistance,
    switchOrgan: (id) => {
      const organ = ORGANS.find((o) => o.id === id);
      if (!organ) return;
      setActiveOrgan(organ.id);
      void loadOrgan(organ);
    },
    activeOrganId: () => activeOrgan.id,
  });
  director.onSpecimenChanged();

  const vocabulary = (): Vocabulary => ({
    targets: activeSegments.map((s) => ({ id: s.id, label: s.label, aliases: s.aliases })),
    organs: ORGANS.map((o) => ({ id: o.id, label: o.label })),
  });

  let greeted = false;
  const voice = new VoiceNavigator({
    vocabulary,
    context: () => director!.context(),
    isSpeaking: () => narrator.speaking,
    onCommand: (match, heard) => director!.handle(match, heard),
    onHeard: (text, final) => {
      voicePanel.setHeard(text);
      caption.setHeard(text, final);
    },
    onState: (state, detail) => {
      voicePanel.setState(state, detail);
      if (state === 'listening' && !greeted) {
        greeted = true;
        void narrator.say('Listening. Name any part of the heart, or say help.');
      }
    },
  });

  voice.setLanguage(voicePanel.language);

  /**
   * Typed commands, chip phrases and the debug hook all run through the same
   * matcher and director as speech, so the type-in box is a full alternative
   * to the microphone, not a lesser one.
   */
  function runText(text: string): void {
    const match = matchCommand(text, vocabulary(), director!.context());
    if (match) {
      director!.handle(match, text);
      return;
    }
    caption.setKicker('NOT RECOGNISED');
    caption.setHeard(text, true);
    caption.setSentence('No part or command found in that. Say help for ideas.');
    caption.setSentence(null);
  }

  function voiceToggle(): void {
    if (voice.listening) voice.stop();
    else voice.start();
  }
  // Keyboard: V toggles the microphone, / jumps to the type-in box. Ignored
  // while typing, so the letters still reach the box.
  window.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'v' || event.key === 'V') voiceToggle();
    if (event.key === '/') {
      event.preventDefault();
      voicePanel.expand();
      document.getElementById('voice-typed')?.focus();
    }
  });
  const cameraFpsEl = document.getElementById('camera-fps')!;
  let overlayRenderer: HandOverlay | undefined;
  let latestHands: HandLandmarks[] = [];
  let latestMode: GestureMode = 'IDLE';
  let tracker: TrackerHandle | undefined;

  // Gesture vocabulary, shown beside the camera feed once tracking is live.
  const gestureCoach = new GestureCoach(
    document.getElementById('tracker-panel')!,
    document.querySelector<HTMLElement>('.tracker-video-wrap')!,
  );

  // --- Wireless foot-pedal --------------------------------------------
  // A dead-man's switch, the same convention as a real electrocautery or
  // fluoroscopy pedal: gesture control is live only while the pedal is
  // actually held down, not flipped on by one press and left running.
  // Defaults to *off* for exactly the same reason a real one does — hands
  // near the camera shouldn't drive anything until the surgeon deliberately
  // commits a foot to it. The on-screen button is the fallback for when the
  // pedal isn't connected, and matches the same hold-not-toggle behaviour
  // (pointerdown/up, not click) so all three input paths never disagree
  // about what "control" means for the same boolean. Neither path touches
  // the tracking pipeline itself — the render loop and MediaPipe inference
  // keep running at their own cadence regardless; this only gates whether
  // the controller acts on what they produce.
  //
  // BLE (blePedalController.ts) is the primary pedal transport — it's a
  // direct link that never touches the venue's WiFi, so it survives the
  // kind of flaky conference network that would otherwise take the pedal
  // down mid-demo. WiFi (pedalController.ts) stays as a fallback for
  // browsers without Web Bluetooth support (Safari, Firefox). Only one
  // transport is meant to be live at a time — connecting either one tears
  // the other down first, so they can't fight over the same boolean.
  const handtrackIndicator = document.getElementById('handtrack-indicator')!;
  const handtrackToggleButton = document.getElementById('handtrack-toggle') as HTMLButtonElement;
  const handtrackSwitch = document.getElementById('handtrack-switch') as HTMLInputElement;
  const pedalIndicator = document.getElementById('pedal-indicator')!;
  const pedalConnectBleButton = document.getElementById('pedal-connect-ble') as HTMLButtonElement;
  const pedalIpInput = document.getElementById('pedal-ip') as HTMLInputElement;
  const pedalConnectButton = document.getElementById('pedal-connect') as HTMLButtonElement;

  let handTrackingEnabled = false;
  const renderHandTrackState = () => {
    handtrackIndicator.textContent = handTrackingEnabled ? '● GESTURE LIVE' : '● GESTURE PAUSED';
    handtrackIndicator.className = `handtrack-indicator ${handTrackingEnabled ? 'live' : 'paused'}`;
    // Keeps the switch honest even when the pedal or hold-button is what
    // actually changed the state — it always shows what's really live, not
    // just what it was last set to.
    handtrackSwitch.checked = handTrackingEnabled;
  };
  const setHandTracking = (on: boolean) => {
    if (on === handTrackingEnabled) return;
    handTrackingEnabled = on;
    renderHandTrackState();
  };
  renderHandTrackState(); // sync the DOM to the real default before any input arrives

  // "ALWAYS ON" — a plain latch for desk testing without the pedal, so
  // gesture control doesn't require holding anything down. It writes to the
  // same boolean as the pedal and the hold-button, so whichever one fires
  // last wins; that's fine, since this switch is meant to be used *instead*
  // of the physical inputs, not alongside them mid-demo.
  handtrackSwitch.addEventListener('change', () => setHandTracking(handtrackSwitch.checked));

  handtrackToggleButton.addEventListener('pointerdown', () => setHandTracking(true));
  handtrackToggleButton.addEventListener('pointerup', () => setHandTracking(false));
  // A pointer that leaves the button (or gets cancelled by the OS/browser)
  // while still down must release too, or the button can get stuck "on"
  // with nothing left to fire the up event.
  handtrackToggleButton.addEventListener('pointerleave', () => setHandTracking(false));
  handtrackToggleButton.addEventListener('pointercancel', () => setHandTracking(false));

  type PedalTransport = 'ble' | 'wifi';
  const renderPedalState = (state: 'offline' | 'connecting' | 'live', transport?: PedalTransport) => {
    const suffix = transport ? ` (${transport === 'ble' ? 'BT' : 'WiFi'})` : '';
    pedalIndicator.textContent =
      state === 'live'
        ? `PEDAL LIVE${suffix}`
        : state === 'connecting'
          ? `PEDAL CONNECTING…${suffix}`
          : 'PEDAL OFFLINE';
    pedalIndicator.className = `pedal-indicator ${state}`;
  };

  const pedal = new PedalController({
    onPressChange: setHandTracking,
    onConnectionChange: (connected) => renderPedalState(connected ? 'live' : 'connecting', 'wifi'),
  });
  const blePedal = new BlePedalController({
    onPressChange: setHandTracking,
    onConnectionChange: (connected) => renderPedalState(connected ? 'live' : 'connecting', 'ble'),
  });

  if (!BlePedalController.isSupported()) {
    pedalConnectBleButton.disabled = true;
    pedalConnectBleButton.title = 'This browser has no Web Bluetooth support — use Chrome/Edge, or the WiFi fallback below.';
  }

  pedalConnectBleButton.addEventListener('click', () => {
    pedal.disconnect(); // only one transport live at a time
    renderPedalState('connecting', 'ble');
    void blePedal.connect();
  });

  pedalConnectButton.addEventListener('click', () => {
    const ip = pedalIpInput.value.trim();
    blePedal.disconnect(); // only one transport live at a time
    if (!ip) {
      // disconnect()'s own onConnectionChange(false) fires synchronously and
      // would otherwise map straight to 'connecting' — render 'offline'
      // after it, not before, so this really is the final state shown.
      pedal.disconnect();
      renderPedalState('offline');
      return;
    }
    renderPedalState('connecting', 'wifi');
    pedal.connect(ip);
  });

  // Reconnect to whatever WiFi IP worked last time, without requiring a
  // click — the pedal is meant to just be live when the demo laptop boots.
  // BLE can't auto-connect this way (Web Bluetooth requires a fresh user
  // gesture the first time each page load), so it always needs one click.
  const savedPedalIp = PedalController.savedIp();
  if (savedPedalIp) {
    pedalIpInput.value = savedPedalIp;
    renderPedalState('connecting', 'wifi');
    pedal.connect(savedPedalIp);
  }

  const enableGestures = async () => {
    enableButton.disabled = true;
    enableButton.textContent = 'STARTING CAMERA…';
    try {
      tracker = await startHandTracking((frame) => {
        const signals = classifier.classify(frame.hands);
        if (handTrackingEnabled) mapper.apply(signals);
        latestHands = classifier.smoothedHands;
        // Frozen mode has no GRAB/ROTATE state of its own — showing the
        // gesture classifier's mode while manipulation is disabled would
        // read as active when it isn't.
        latestMode = handTrackingEnabled ? signals.mode : 'IDLE';
        status.setMode(latestMode);
        gestureCoach.setMode(latestMode);
        hud.markTracking(frame.inferenceMs);
      });
      overlayRenderer = new HandOverlay(trackerCanvas, tracker.video);
      enableButton.classList.add('hidden');
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
      director,
      narrator,
      // Run a transcript through the same matcher and director as speech, so
      // voice behaviour can be exercised without a microphone.
      say: (text: string) => {
        const match = matchCommand(text, vocabulary(), director!.context());
        if (match) director!.handle(match, text);
        return match;
      },
      // The recogniser's own path, interim/final handling and echo guard included.
      hear: (text: string, final = true) => voice.inject(text, final),
      get highlighter() {
        return highlighter;
      },
      get interior() {
        return interior;
      },
      pedal,
      blePedal,
      setHandTracking,
      get handTrackingEnabled() {
        return handTrackingEnabled;
      },
      renderOnce: () => stage.renderer.render(stage.scene, stage.camera),
      // Steps the simulation; only the last frame is drawn, so a long step
      // never queues hundreds of frames of GPU work at once.
      tick: (frames = 1, delta = 1 / 60) => {
        for (let i = 0; i < frames; i++) tick(delta, i === frames - 1);
      },
    },
  });

  // A living specimen, not a static model — see render/heartbeat.ts for the
  // envelope. Applied to the pivot so it carries through to whatever's
  // currently loaded without per-specimen wiring.
  const HEARTBEAT_SCALE = 0.028;
  // The pulse eases out the moment a hand is tracked, and back in when the
  // hand leaves. A specimen that keeps breathing while someone is trying to
  // hold a fingertip still is actively fighting them — the beat is for the
  // idle "this is alive" moment, not for while you work.
  let heartbeatGain = 1;
  const HEARTBEAT_FADE_PER_S = 4;

  const clock = new THREE.Clock();
  // The heartbeat runs on its own clock so voice can slow or stop it without
  // slowing anything else.
  let beatTime = 0;
  let elapsed = 0;
  // One frame of everything. Split from the rAF loop so a backgrounded tab
  // (where rAF is suspended) can still be stepped from the console.
  function tick(delta: number, draw = true): void {
    elapsed += delta;
    const handPresent = latestHands.length > 0;
    if (director?.spinning && !handPresent) controller.rotateBy(delta * 0.45, 0);
    controller.update(delta);
    highlighter?.update(delta, elapsed);

    const beatDelta = delta * (director?.beatRate ?? 1);
    beatTime += beatDelta;
    const phase = (beatTime % HEARTBEAT_CYCLE_S) / HEARTBEAT_CYCLE_S;
    if (interior) {
      interior.setReveal(highlighter?.xray ?? 0);
      interior.update(beatDelta, phase, elapsed);
    }
    labels.update(delta, stage.camera, stage.pivot, highlighter?.xray ?? 0, director?.focusedId ?? null);

    const gainTarget = handPresent ? 0 : 1;
    heartbeatGain += (gainTarget - heartbeatGain) * Math.min(1, HEARTBEAT_FADE_PER_S * delta);
    stage.pivot.scale.setScalar(
      1 + heartbeat(beatTime) * HEARTBEAT_SCALE * heartbeatGain,
    );

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

    const size = stage.renderer.getSize(new THREE.Vector2());
    stage.camera.aspect = size.x / size.y;
    stage.camera.updateProjectionMatrix();
    if (draw) stage.renderer.render(stage.scene, stage.camera);

    overlayRenderer?.draw(latestHands, latestMode);
    hud.markRender();

    if (tracker) {
      const fps = tracker.cameraFps();
      cameraFpsEl.textContent = `${fps} fps`;
      // Below ~24 fps the camera itself is the bottleneck, not the tracker.
      cameraFpsEl.classList.toggle('low', fps > 0 && fps < 24);
    }
  }
  const renderLoop = () => {
    requestAnimationFrame(renderLoop);
    tick(Math.min(clock.getDelta(), 0.1));
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
