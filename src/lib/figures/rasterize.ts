// Rasterize a figure source (PNG/JPG/WebP/PDF) to a screen-resolution WebP
// blob. Heavy lifting:
//   - PDF: dynamic-import pdfjs-dist, render page 1 onto an OffscreenCanvas
//   - raster: createImageBitmap → OffscreenCanvas resize
//
// `pdfjs-dist` is intentionally not a static import — papers with only
// raster figures pay zero bundle cost.

export class RasterizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RasterizeError";
  }
}

/** Target raster width in CSS pixels × device pixel ratio. We give 1.5×
 *  headroom for browser zoom; the editor column is ~720px wide so a
 *  default of ~2200 is enough at 2× dpr. */
function defaultTargetWidthPx(): number {
  const dpr =
    typeof window !== "undefined" && window.devicePixelRatio
      ? window.devicePixelRatio
      : 1.5;
  const cssWidth = 720;
  return Math.round(cssWidth * dpr * 1.5);
}

/** Encode an OffscreenCanvas to a WebP blob. */
async function encodeWebp(canvas: OffscreenCanvas): Promise<Blob> {
  return canvas.convertToBlob({ type: "image/webp", quality: 0.85 });
}

/** Resize a raster source onto an OffscreenCanvas at the target width
 *  (preserving aspect ratio). */
async function rasterizeRaster(
  bytes: ArrayBuffer,
  ext: string,
  targetWidthPx: number,
): Promise<Blob> {
  // The browser deduces type from the blob — but be explicit so file
  // sniffing doesn't trip on stripped headers.
  const mime =
    ext === "jpg" || ext === "jpeg"
      ? "image/jpeg"
      : ext === "png"
        ? "image/png"
        : ext === "webp"
          ? "image/webp"
          : "application/octet-stream";
  const blob = new Blob([bytes], { type: mime });
  const bitmap = await createImageBitmap(blob);
  const aspect = bitmap.height / bitmap.width;
  // Don't upscale — if the source is smaller than target, render at native.
  const renderW = Math.min(targetWidthPx, bitmap.width);
  const renderH = Math.round(renderW * aspect);
  const canvas = new OffscreenCanvas(renderW, renderH);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new RasterizeError("OffscreenCanvas 2D context unavailable");
  }
  ctx.drawImage(bitmap, 0, 0, renderW, renderH);
  bitmap.close();
  return encodeWebp(canvas);
}

// pdfjs-dist module is cached at module scope; subsequent figures reuse it.
let pdfjsModulePromise: Promise<typeof import("pdfjs-dist")> | null = null;
function loadPdfjs(): Promise<typeof import("pdfjs-dist")> {
  if (!pdfjsModulePromise) {
    pdfjsModulePromise = import("pdfjs-dist").then((mod) => {
      // The worker is shipped as a separate file. We use the bundled
      // worker URL — Next.js with Turbopack copies `pdfjs-dist`'s
      // pdf.worker.min.mjs as an asset; we resolve it via new URL().
      // If the worker URL can't be resolved (Node, tests), fall back
      // to running on the main thread (workerSrc="" disables the worker).
      try {
        const workerUrl = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        );
        mod.GlobalWorkerOptions.workerSrc = workerUrl.toString();
      } catch {
        mod.GlobalWorkerOptions.workerSrc = "";
      }
      return mod;
    });
  }
  return pdfjsModulePromise;
}

/** Render page 1 of a PDF to a WebP raster at target width.
 *
 *  Uses a regular HTMLCanvasElement (not OffscreenCanvas) because pdfjs's
 *  rendering pipeline relies on `requestAnimationFrame` ticks against
 *  the canvas's owning window; a detached OffscreenCanvas can starve
 *  the render task indefinitely. We attach the canvas to the document
 *  out of view, render, then encode to WebP. */
async function rasterizePdf(bytes: ArrayBuffer, targetWidthPx: number): Promise<Blob> {
  const pdfjs = await loadPdfjs();
  // pdfjs mutates the input ArrayBuffer; clone so the cache can re-use it.
  const data = bytes.slice(0);
  const loadingTask = pdfjs.getDocument({ data });
  const pdf = await loadingTask.promise;
  let canvas: HTMLCanvasElement | null = null;
  try {
    const page = await pdf.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = targetWidthPx / baseViewport.width;
    const viewport = page.getViewport({ scale });
    canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    // Attach off-screen so rAF ticks fire. `visibility: hidden` keeps
    // layout flow undisturbed and the canvas painting-suppressed.
    canvas.style.cssText =
      "position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none";
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new RasterizeError("Canvas 2D context unavailable");
    await page.render({
      canvasContext: ctx,
      viewport,
    }).promise;
    return await new Promise<Blob>((resolve, reject) => {
      canvas!.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new RasterizeError("toBlob failed"))),
        "image/webp",
        0.85,
      );
    });
  } finally {
    if (canvas) canvas.remove();
    await pdf.destroy();
  }
}

/** Public entry: dispatch on extension. Unknown extensions throw. */
export async function rasterizeFigure(
  bytes: ArrayBuffer,
  ext: string,
  targetWidthPx: number = defaultTargetWidthPx(),
): Promise<Blob> {
  const norm = ext.toLowerCase();
  if (norm === "pdf") return rasterizePdf(bytes, targetWidthPx);
  if (norm === "png" || norm === "jpg" || norm === "jpeg" || norm === "webp") {
    return rasterizeRaster(bytes, norm, targetWidthPx);
  }
  throw new RasterizeError(`Unsupported figure format: .${ext}`);
}
