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
 *      spec entirely (Safari, Firefox) or where it's been opted out of
 *      (Claude Preview iframe via `virgil:force-dev-storage`). Yields only
 *      a `File`; both backends then copy the bytes into `<paper>/figures/`.
 *
 * Both code paths converge on the unified `PickedFigureFile` contract
 * exported from `src/lib/storage-fsa.ts` and consumed by `importFigureFile`
 * through the storage facade. Callers don't branch on backend or browser.
 */

import { hasFsaSupport } from "@/lib/fsa-support";
import type { PickedFigureFile } from "@/lib/storage";

/** Mirror of `isDevStorage`'s detection, but framed as "can the FSA file
 *  picker reliably run from this user gesture?". Two extra constraints
 *  beyond `hasFsaSupport()`:
 *
 *  - **Iframe**: the FSA picker either silently swallows the gesture or
 *    throws a `SecurityError` inside an iframe (Claude Preview's headless
 *    Chromium is the recurring offender). `window.self !== window.top`
 *    is the standard test.
 *  - **Manual opt-out**: the same `virgil:force-dev-storage` localStorage
 *    flag that `src/lib/storage-mode.ts` honors. Keeps the picker choice
 *    aligned with the backend choice end-to-end so a forced-dev session
 *    doesn't try FSA paths that would never reach the FSA backend.
 */
function canUseFsaFilePicker(): boolean {
  if (!hasFsaSupport()) return false;
  if (typeof window === "undefined") return false;
  try {
    if (window.localStorage.getItem("virgil:force-dev-storage") === "1") {
      return false;
    }
  } catch {
    // localStorage access can throw under sandboxed iframes; fall through
    // to the iframe check.
  }
  if (window.self !== window.top) return false;
  return true;
}

const FSA_PICKER_TYPES: FilePickerAcceptType[] = [
  {
    description: "Image",
    accept: {
      "image/png": [".png"],
      "image/jpeg": [".jpg", ".jpeg"],
      "image/webp": [".webp"],
      "application/pdf": [".pdf"],
    },
  },
];

const HTML_INPUT_ACCEPT = ".png,.jpg,.jpeg,.webp,.pdf,image/png,image/jpeg,image/webp,application/pdf";

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
  if (canUseFsaFilePicker()) {
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
 * Cancellation detection: `<input type="file">` doesn't fire any event on
 * cancel. We resolve `null` once the document regains focus (signaling the
 * dialog closed) without a `change` having fired. Some browsers re-fire
 * the focus event before `change`, so we delay by a microtask to give
 * `change` a chance to win the race.
 */
function pickViaHiddenInput(): Promise<PickedFigureFile | null> {
  if (typeof document === "undefined") {
    return Promise.resolve(null);
  }
  return new Promise<PickedFigureFile | null>((resolve) => {
    const input = getOrCreateHiddenInput();
    let settled = false;
    const settle = (value: PickedFigureFile | null) => {
      if (settled) return;
      settled = true;
      input.removeEventListener("change", onChange);
      window.removeEventListener("focus", onFocus);
      // Reset so the same path can be picked twice in a row.
      input.value = "";
      resolve(value);
    };
    const onChange = () => {
      const file = input.files?.[0] ?? null;
      settle(file ? { file, handle: null } : null);
    };
    const onFocus = () => {
      // Window regained focus → dialog closed. Yield a microtask so the
      // `change` event (if a file was picked) lands first.
      setTimeout(() => settle(null), 0);
    };
    input.addEventListener("change", onChange);
    window.addEventListener("focus", onFocus);
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
