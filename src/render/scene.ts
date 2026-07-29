import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Everything the user manipulates is parented here, never the scene itself. */
  pivot: THREE.Group;
  /** Camera-mounted light so the interior is lit once the camera dives inside. */
  headlamp: THREE.PointLight;
  /** Camera Z that frames the whole specimen; set by {@link frameSubject}. */
  framingDistance: number;
  /** Dollies the camera so a specimen of the given radius fills the frame. */
  frameSubject(radius: number): void;
  dispose(): void;
}

/**
 * Builds the WebGL stage: renderer, camera, lighting rig and the pivot group
 * that all anatomical models are parented to.
 *
 * `localClippingEnabled` is switched on here because the virtual dissection
 * feature (Phase 3) drives `material.clippingPlanes`, which is a no-op unless
 * the renderer opts in.
 */
export function createStage(container: HTMLElement): Stage {
  // Styles are injected asynchronously in dev, so the container can still be
  // zero-sized on this tick. Fall back to the window until layout settles; the
  // ResizeObserver below corrects the moment it does.
  const measure = () => ({
    width: container.clientWidth || window.innerWidth,
    height: container.clientHeight || window.innerHeight,
  });
  const initial = measure();

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    // Keeps the framebuffer readable after a draw so frames can be captured
    // for screenshots and demo stills.
    preserveDrawingBuffer: true,
  });
  renderer.setSize(initial.width, initial.height);
  // Cap at 2x: beyond that the fill cost buys nothing visible but costs frames
  // on the low-end hardware this platform targets.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // Lower exposure so highlights read as damp tissue sheen rather than blown-out
  // white — closer to how a real heart looks under theatre light. Adjustable
  // live from the settings panel.
  renderer.toneMappingExposure = 0.72;
  renderer.localClippingEnabled = true;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04070f);

  // Physically based materials need something to reflect. A generated room
  // probe costs no network request and keeps the platform fully offline, while
  // giving wet tissue the soft specular falloff that sells it as a specimen.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(
    42,
    initial.width / initial.height,
    // Near plane must be tiny: when the zoom dolly carries the camera inside the
    // mesh, interior walls sit only millimetres away and a large near plane
    // would clip them out of view.
    0.01,
    1000,
  );
  camera.position.set(0, 0, 4);
  scene.add(camera);

  const pivot = new THREE.Group();
  scene.add(pivot);

  scene.add(...buildLightingRig());

  // Headlamp travels with the camera. Outside the specimen it reads as a gentle
  // front fill; once the dolly pushes the camera through the surface it becomes
  // the only thing lighting the interior, so the inside of the heart is visible
  // rather than a black void.
  const headlamp = new THREE.PointLight(0xffe8e0, 0, 0, 1.1);
  camera.add(headlamp);

  const onResize = () => {
    const { width, height } = measure();
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  };
  window.addEventListener('resize', onResize);

  const observer = new ResizeObserver(onResize);
  observer.observe(container);

  const stage: Stage = {
    renderer,
    scene,
    camera,
    pivot,
    headlamp,
    framingDistance: 4,
    frameSubject(radius: number) {
      // Fit against whichever axis is tighter, then leave headroom so the
      // specimen never collides with the floating UI panels — and so there is
      // room to grow when the user zooms in.
      const vFov = THREE.MathUtils.degToRad(camera.fov);
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
      const fit = Math.max(
        radius / Math.sin(vFov / 2),
        radius / Math.sin(hFov / 2),
      );
      stage.framingDistance = fit * 1.12;
      camera.position.setZ(stage.framingDistance);
      camera.updateProjectionMatrix();
    },
    dispose() {
      observer.disconnect();
      window.removeEventListener('resize', onResize);
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };

  return stage;
}

/**
 * Soft three-point rig tuned for a natural, anatomical look rather than a glossy
 * hero render. Intensities are deliberately restrained so the specimen reads as
 * real cardiac tissue under even clinical light instead of a wet plastic prop
 * with blown-out highlights.
 */
function buildLightingRig(): THREE.Light[] {
  const ambient = new THREE.AmbientLight(0xa8c4d8, 0.5);

  const key = new THREE.DirectionalLight(0xfff3ec, 1.35);
  key.position.set(3, 4, 5);

  const fill = new THREE.DirectionalLight(0xbcd2ea, 0.6);
  fill.position.set(-4, 0, 2);

  // Gentle cool rim for form separation — not a showy edge glow.
  const rim = new THREE.DirectionalLight(0x9ec4e6, 0.55);
  rim.position.set(-2, 1, -5);

  // Lifts the underside so the inferior surface never goes fully black.
  const bounce = new THREE.DirectionalLight(0xffb3a3, 0.35);
  bounce.position.set(0, -4, 1);

  return [ambient, key, fill, rim, bounce];
}
