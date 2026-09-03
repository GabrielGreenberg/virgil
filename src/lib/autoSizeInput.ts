/**
 * Auto-sizes an `<input>` to its content by measuring text in a hidden `<span>`.
 *
 * ONE lazily-created sizer for the whole app, rather than one per call: the
 * measurement is a pure function of (font, letter-spacing, text), so a
 * per-instance span bought N nodes and nothing else — and a shared one is what
 * lets a PROGRAMMATIC value write re-measure without holding a handle on the
 * listener that set the field up.
 */

import type { ViewLifetime, ViewTimer } from "@/lib/tiptap/view-lifetime";

let sizer: HTMLSpanElement | null = null;

function getSizer(): HTMLSpanElement {
  if (sizer && document.body.contains(sizer)) return sizer;
  sizer = document.createElement("span");
  sizer.style.cssText =
    "position:absolute;visibility:hidden;white-space:pre;pointer-events:none;";
  document.body.appendChild(sizer);
  return sizer;
}

/**
 * Re-measure `input` and set its width, once.
 *
 * The listener `autoSizeInput` installs fires on `input` events, which a
 * programmatic `el.value = …` does NOT dispatch — so a field reconciled from
 * its source (`useFieldDraft`, task 532) would keep the width of the value it
 * no longer shows, and `CardTitleInput`'s `overflow-hidden text-ellipsis` would
 * CLIP the new title. Any code that writes `value` by hand calls this after.
 */
export function syncInputWidth(input: HTMLInputElement, minCh = 2): void {
  const span = getSizer();
  const cs = getComputedStyle(input);
  span.style.font = cs.font;
  span.style.letterSpacing = cs.letterSpacing;
  span.textContent = input.value || input.placeholder || "";
  input.style.width = Math.max(span.offsetWidth + 2, minCh * 8) + "px";
}

/**
 * Keep `input` sized to its content for as long as the returned cleanup has
 * not been called.
 *
 * The first measure runs in a FRAME (the input has to be in the DOM for the
 * font read), and a frame is a timer: it reads `getComputedStyle` and
 * `document.body` when it lands. A NodeView that mounts the input hands its
 * `ViewLifetime` in, so that frame is bounded by the view's teardown like every
 * other timer the view arms (task 548 — see `view-lifetime.ts`); a caller with
 * no view (a React field) gets the platform frame, cancelled by the cleanup.
 */
export function autoSizeInput(
  input: HTMLInputElement,
  minCh = 2,
  lifetime?: Pick<ViewLifetime, "requestAnimationFrame" | "clear">,
): () => void {
  const sync = () => syncInputWidth(input, minCh);
  input.addEventListener("input", sync);
  const frame = lifetime ? lifetime.requestAnimationFrame(sync) : requestAnimationFrame(sync);
  return () => {
    input.removeEventListener("input", sync);
    if (lifetime) lifetime.clear(frame as ViewTimer);
    else cancelAnimationFrame(frame as number);
  };
}
