import type { InteractionController } from '../controller/interactionController';

/**
 * Development fallback so the platform can be worked on without a hand held up
 * to the webcam. The gesture pipeline drives the exact same controller API,
 * which keeps the two input paths honest about behaving identically.
 */
export function attachMouseInput(
  element: HTMLElement,
  controller: InteractionController,
): () => void {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const onDown = (e: PointerEvent) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    element.setPointerCapture(e.pointerId);
  };

  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    controller.rotateBy(
      (e.clientX - lastX) * 0.006,
      (e.clientY - lastY) * 0.006,
    );
    lastX = e.clientX;
    lastY = e.clientY;
  };

  const onUp = (e: PointerEvent) => {
    dragging = false;
    element.releasePointerCapture(e.pointerId);
  };

  // Dev fallback zoom: accumulate wheel ticks into the same 0..1 zoom the pinch
  // aperture drives, so scrolling in eventually dives inside the specimen.
  let wheelZoom = 0;
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    wheelZoom = Math.min(1, Math.max(0, wheelZoom + (e.deltaY > 0 ? -0.06 : 0.06)));
    controller.setZoom(wheelZoom);
  };

  element.addEventListener('pointerdown', onDown);
  element.addEventListener('pointermove', onMove);
  element.addEventListener('pointerup', onUp);
  element.addEventListener('wheel', onWheel, { passive: false });

  return () => {
    element.removeEventListener('pointerdown', onDown);
    element.removeEventListener('pointermove', onMove);
    element.removeEventListener('pointerup', onUp);
    element.removeEventListener('wheel', onWheel);
  };
}
