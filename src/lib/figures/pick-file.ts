/**
 * Backend-agnostic figure-file picker.
 *
 * Dispatches between two underlying mechanisms based on runtime capability:
 *
 *   1. `window.showOpenFilePicker` (File System Access spec) — preferred
 *      when available. Yields a `FileSystemFileHandle`, which lets the FSA
 *      backend's `importFigureFile` short-circuit a same-folder pick via
 *      `docHandle.resolve(handle)` (no copy, just record the relative path).
 *
 *   2. `<input type="file">` — fallback for environments that lack the FSA
 *      spec entirely (Safari, Firefox), inside an iframe, or on the dev
 *      storage backend — `fsaPickerUsable()` in `storage-mode.ts` decides,
 *      beside the backend choice it follows. Yields only
 *      a `File`; both backends then copy the bytes into `<paper>/figures/`.
 *
 * Both code paths converge on the unified `PickedFigureFile` contract
 * exported from `src/lib/storage-fsa.ts` and consumed by `importFigureFile`
 * through the storage facade. Callers don't branch on backend or browser.
 */

import { fsaPickerUsable } from "@/lib/storage-mode";
import type { PickedFigureFile } from "@/lib/storage";
import { FIGURE_FORMATS, figureFormatFor } from "@/lib/figures/graphics-path";
import { transcodeImage } from "@/lib/figures/rasterize";

// Both accept lists DERIVE from the one figure-format census (task 1590) —
// this file spells no extension. A non-includable row (webp) stays pickable
// because `toIncludableFigure` transcodes it before it reaches the paper.
/** The picker's MIME → extensions map (exported for the census test). */
export const FIGURE_PICKER_ACCEPT: Record<`${string}/${string}`, `.${string}`[]> =
  FIGURE_FORMATS.reduce<Record<`${string}/${string}`, `.${string}`[]>>((acc, f) => {
    (acc[f.mime] ??= []).push(`.${f.ext}`);
    return acc;
  }, {});

const FSA_PICKER_TYPES: FilePickerAcceptType[] = [
  { description: "Image", accept: FIGURE_PICKER_ACCEPT },
];

export const HTML_INPUT_ACCEPT = [
  ...FIGURE_FORMATS.map((f) => `.${f.ext}`),
  ...new Set(FIGURE_FORMATS.map((f) => f.mime)),
].join(",");

/**
 * Make a picked file one pdfTeX can include (task 1590). A file whose format
 * the census marks `includable` passes through untouched (its handle kept, so
 * the FSA backend's in-folder short-circuit still applies). A non-includable
 * one is re-encoded to its `transcodeTo` format under `<stem>.<ext>` with NO
 * handle — the paper must reference the converted copy, never the original —
 * and then lands through `importFigureFile`'s usual dedupe / TeX-safe naming.
 * An extension the census does not know passes through (the picker never
 * offers one).
 */
export async function toIncludableFigure(
  picked: PickedFigureFile,
  transcode: (file: File, toMime: string) => Promise<Blob> = transcodeImage,
): Promise<PickedFigureFile> {
  const name = picked.file.name;
  const dot = name.lastIndexOf(".");
  const format = dot > 0 ? figureFormatFor(name.slice(dot + 1)) : null;
  if (!format || format.includable || !format.transcodeTo) return picked;
  const target = figureFormatFor(format.transcodeTo);
  if (!target) throw new Error(`[pick-file] no census row for .${format.transcodeTo}`);
  const blob = await transcode(picked.file, target.mime);
  const file = new File([blob], `${name.slice(0, dot)}.${target.ext}`, { type: target.mime });
  return { file, handle: null };
}

/**
 * Prompt the user to pick a single image / PDF for a figure block.
 *
 * Resolves to `null` when the user cancels (either by closing the FSA
 * picker, dismissing the `<input>` dialog, or aborting via Escape). Throws
 * on unexpected errors so the caller can surface them — `AbortError` is
 * mapped to `null` rather than a throw because cancellation is a normal
 * user action, not an exceptional condition.
 */
export async function pickFigureFile(): Promise<PickedFigureFile | null> {
  if (fsaPickerUsable()) {
    try {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: FSA_PICKER_TYPES,
      });
      if (!handle) return null;
      const file = await handle.getFile();
      return { file, handle };
    } catch (err) {
      if ((err as Error).name === "AbortError") return null;
      throw err;
    }
  }
  return pickViaHiddenInput();
}

/**
 * `<input type="file">` fallback. Creates (and reuses) a single hidden
 * input attached to the document body, calls `.click()` to open the native
 * file dialog, and resolves on `change`.
 *
 * Cancellation detection (task 1436): where the input fires the native
 * `cancel` event (Chrome 113+, Firefox 91+, Safari 16.4+), THAT is the cancel
 * — the window's `focus` is ignored, so a `change` arriving late can never
 * lose a race it should win. Only where `cancel` is unsupported does the
 * window regaining focus stand in for it, and then after a grace long enough
 * (`FOCUS_CANCEL_GRACE_MS`) that a `change` delivered more than one macrotask
 * after the focus still resolves the real file — the old `setTimeout(0)`
 * resolved `null` and dropped it.
 */
export const FOCUS_CANCEL_GRACE_MS = 1000;

function pickViaHiddenInput(): Promise<PickedFigureFile | null> {
  if (typeof document === "undefined") {
    return Promise.resolve(null);
  }
  return new Promise<PickedFigureFile | null>((resolve) => {
    const input = getOrCreateHiddenInput();
    const nativeCancel = "oncancel" in input;
    let settled = false;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    const settle = (value: PickedFigureFile | null) => {
      if (settled) return;
      settled = true;
      if (graceTimer !== null) clearTimeout(graceTimer);
      input.removeEventListener("change", onChange);
      input.removeEventListener("cancel", onCancel);
      window.removeEventListener("focus", onFocus);
      // Reset so the same path can be picked twice in a row.
      input.value = "";
      resolve(value);
    };
    const onChange = () => {
      const file = input.files?.[0] ?? null;
      settle(file ? { file, handle: null } : null);
    };
    const onCancel = () => settle(null);
    const onFocus = () => {
      // Window regained focus → the dialog probably closed. Wait out the
      // grace so a `change` the browser delivers after the focus lands first.
      if (graceTimer !== null) clearTimeout(graceTimer);
      graceTimer = setTimeout(() => settle(null), FOCUS_CANCEL_GRACE_MS);
    };
    input.addEventListener("change", onChange);
    if (nativeCancel) input.addEventListener("cancel", onCancel);
    else window.addEventListener("focus", onFocus);
    input.click();
  });
}

let _hiddenInput: HTMLInputElement | null = null;
function getOrCreateHiddenInput(): HTMLInputElement {
  if (_hiddenInput && _hiddenInput.isConnected) return _hiddenInput;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = HTML_INPUT_ACCEPT;
  input.multiple = false;
  // Visually offscreen rather than `display: none` so the click gesture
  // is honored on every browser. (Some Safari versions ignore clicks on
  // `display:none` inputs.)
  input.style.position = "fixed";
  input.style.left = "-9999px";
  input.style.top = "-9999px";
  input.style.opacity = "0";
  input.style.pointerEvents = "none";
  input.setAttribute("aria-hidden", "true");
  input.tabIndex = -1;
  document.body.appendChild(input);
  _hiddenInput = input;
  return input;
}
