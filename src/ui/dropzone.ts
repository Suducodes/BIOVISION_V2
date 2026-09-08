/**
 * Drag-and-drop GLB loader.
 *
 * The whole viewport is a drop target (rejecting anywhere close is the kind
 * of finicky UX nobody wants mid-demo), with a full-screen highlight while
 * something's being dragged over it so it's obvious the drop will land. A
 * small persistent control gives it a discoverable, deliberate home too —
 * click it for a normal file picker, or just drag straight onto the page.
 */
export function attachDropzone(
  container: HTMLElement,
  control: HTMLElement,
  fileInput: HTMLInputElement,
  onFile: (file: File) => void,
): void {
  const overlay = document.createElement('div');
  overlay.id = 'drop-overlay';
  overlay.innerHTML = '<span>DROP TO VIEW</span>';
  container.append(overlay);

  let dragDepth = 0; // dragenter/dragleave fire on every child crossed, not just the container

  const show = () => overlay.classList.add('active');
  const hide = () => {
    dragDepth = 0;
    overlay.classList.remove('active');
  };

  const isFileDrag = (e: DragEvent) =>
    !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');

  container.addEventListener('dragenter', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth++;
    show();
  });
  container.addEventListener('dragover', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault(); // required, or the browser refuses the drop entirely
  });
  container.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) hide();
  });
  container.addEventListener('drop', (e) => {
    e.preventDefault();
    hide();
    const file = e.dataTransfer?.files[0];
    if (file) onFile(file);
  });

  control.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) onFile(file);
    fileInput.value = ''; // so dropping/picking the same file twice still fires 'change'
  });
}

/** Loosely — real GLBs can have almost any MIME type or none at all over
 *  drag-and-drop, so the extension is the only reliable signal. */
export function looksLikeGlb(file: File): boolean {
  return /\.(glb|gltf)$/i.test(file.name);
}
