// Engine-managed drag shield — a singleton full-viewport overlay mounted for
// the duration of a pane-resize gesture. Pointer CAPTURE is the primary event
// guarantee (the captured handle receives the whole stream regardless of what
// the pointer is over); the shield exists to block what capture cannot: iframe
// hover/hit-testing (the pdf.js viewer swallowing the cursor), text selection,
// and cursor flicker from elements under the pointer. It also owns the gesture
// cursor and `user-select:none` on <body>, restoring both on unmount.
//
// Only `usePaneResizeHandle` mounts/unmounts it, on the gesture edges — never
// per frame. Both entry points are idempotent so a double begin/end can't leak
// a second overlay or clobber the saved body styles.

import { DROP_INDICATOR_Z } from "@/floats/float-policy";

let shield: HTMLDivElement | null = null;
// Body inline styles as they were at mount, restored verbatim on unmount so a
// gesture can't erase a cursor/user-select someone else set.
let prevBodyUserSelect = "";
let prevBodyCursor = "";

export type DragShieldCursor = "col-resize" | "row-resize";

/** Mount (or retarget the cursor of) the singleton shield. Lazy — the div is
 *  created on first use per gesture and holds no state between gestures. */
export function mountDragShield(cursor: DragShieldCursor): void {
  // SSR-safe: the engine only calls this from pointer handlers, but guard so
  // an accidental server call is inert rather than a crash.
  if (typeof document === "undefined") return;
  if (!shield) {
    shield = document.createElement("div");
    shield.setAttribute("data-pane-drag-shield", "");
    shield.setAttribute("aria-hidden", "true");
    const s = shield.style;
    s.position = "fixed";
    // Explicit edges rather than the `inset` shorthand (jsdom's CSSOM doesn't
    // expand `inset`, and the tests assert the resolved edges).
    s.top = "0";
    s.right = "0";
    s.bottom = "0";
    s.left = "0";
    // The drop-mode indicator tier: above floats/menus/iframes, below the
    // modal scrim — the same "transient full-gesture overlay" class.
    s.zIndex = String(DROP_INDICATOR_Z);
    s.background = "transparent";
    // Must be hit-testable itself — that's the whole point.
    s.pointerEvents = "auto";
    prevBodyUserSelect = document.body.style.userSelect;
    prevBodyCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.appendChild(shield);
  }
  // Shield cursor covers the viewport; body cursor is belt-and-suspenders for
  // the instant before the shield paints.
  shield.style.cursor = cursor;
  document.body.style.cursor = cursor;
}

/** Remove the shield and restore the body styles. Idempotent. */
export function unmountDragShield(): void {
  if (!shield) return;
  shield.remove();
  shield = null;
  document.body.style.userSelect = prevBodyUserSelect;
  document.body.style.cursor = prevBodyCursor;
  prevBodyUserSelect = "";
  prevBodyCursor = "";
}

/** Probe for tests/diagnostics. */
export function isDragShieldMounted(): boolean {
  return shield !== null;
}
