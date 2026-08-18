/**
 * Edge-zone auto-scroll for drop-mode sessions (perf Wave 2, P4).
 *
 * Before this, a content drag had NO auto-scroll: dragging a block toward a
 * target below the fold meant wheel-scrolling mid-gesture. This module lives
 * at the CONTROLLER level — the single chokepoint every pointer-driven
 * content drag routes through — so the lifted-overlay drag, card drop
 * button, inline-atom grab and stack pull all gain it uniformly, with no
 * per-producer wiring.
 *
 * Shape: the controller feeds every pointer move; while the pointer parks
 * inside the top/bottom edge zone of the MAIN editor's scroll container, a
 * self-sustaining RAF loop applies an eased per-frame scroll delta and asks
 * the controller to re-run its (frame-coalesced) hit-test — so the drop
 * indicator tracks the content sliding under the cursor. The loop
 * self-terminates the frame the pointer leaves the zone, and the controller
 * stops it on session teardown. Scope is deliberately the main editor's
 * container only (the far-target case this exists for); hovering a card
 * body's own scroller doesn't auto-scroll it.
 *
 * **Cost (task 351).** The arming test is PURE — it reads the container's
 * viewport band from the gesture snapshot (`move-geometry.ts`), never the DOM.
 * That is the whole point of the snapshot: `feedAutoScroll` runs on every RAW
 * pointer event (120–240 Hz), and it used to open with
 * `el.getBoundingClientRect()` — a forced layout per event, for a container
 * that cannot move while the pointer is held. The only live reads left are
 * `scrollTop` (read + write) inside the RAF `tick`, which is where the write
 * happens and so the one place a live value is required.
 *
 * The re-hit-test is REQUESTED, not run: `onFrame` schedules the controller's
 * coalesced pass, so this frame WRITES and the next frame READS. Calling the
 * hit-test inline here would put a forced-layout read immediately after our
 * own scroll write, once per frame, for a one-frame-fresher indicator nobody
 * can see.
 */

import type { ScrollTarget } from "./move-geometry";

/** Pointer-to-edge distance that arms auto-scroll. */
const EDGE_ZONE_PX = 56;
/** Max scroll speed at the very edge, px per frame (~1080 px/s @60Hz). */
const MAX_SPEED_PX = 18;

let rafId = 0;
let target: ScrollTarget | null = null;
let pointerY = 0;
let onFrame: (() => void) | null = null;

/**
 * Signed px-per-frame for a pointer at `clientY`, from the SNAPSHOTTED band.
 * Pure arithmetic — no DOM read, so it is safe on the raw-event path. Says
 * nothing about whether the container can still scroll that way; the range
 * limit is the `tick`'s business, because only a live `scrollTop` can answer it.
 */
export function edgeSpeedFor(t: ScrollTarget, clientY: number): number {
  const height = t.bottom - t.top;
  if (height <= 0) return 0;
  const fromTop = clientY - t.top;
  const fromBottom = t.bottom - clientY;
  // `Math.max(0, …)` keeps a pointer ABOVE / BELOW the container at full
  // speed rather than easing back off — the pre-351 behaviour, preserved.
  if (fromTop < EDGE_ZONE_PX) {
    const s = 1 - Math.max(0, fromTop) / EDGE_ZONE_PX;
    return -Math.ceil(MAX_SPEED_PX * s * s);
  }
  if (fromBottom < EDGE_ZONE_PX) {
    const s = 1 - Math.max(0, fromBottom) / EDGE_ZONE_PX;
    return Math.ceil(MAX_SPEED_PX * s * s);
  }
  return 0;
}

function tick() {
  rafId = 0;
  const t = target;
  if (!t || !onFrame) return;
  const speed = edgeSpeedFor(t, pointerY);
  if (speed === 0) return; // left the zone — self-terminate
  const el = t.el;
  // Read → write → (no read). The browser clamps the assignment at both ends
  // of the range, so reading it back is both cheaper and more accurate than
  // the pre-351 `scrollHeight - clientHeight` arithmetic, and it is what tells
  // us whether content actually moved.
  const before = el.scrollTop;
  el.scrollTop = before + speed;
  if (el.scrollTop !== before) onFrame();
  // Keep looping while the pointer is in the zone even at the end of the
  // range: the loop is one scrollTop read + one write, and terminating there
  // meant a pointer parked at the edge could never resume when the user
  // dragged back into scrollable content.
  rafId = requestAnimationFrame(tick);
}

/**
 * Feed a pointer move. `t` is the session's scroll target from the gesture
 * geometry snapshot (null = nothing to scroll), `reHitTest` SCHEDULES the
 * controller's coalesced hit-test pass.
 */
export function feedAutoScroll(
  t: ScrollTarget | null,
  clientY: number,
  reHitTest: () => void,
): void {
  target = t;
  pointerY = clientY;
  onFrame = reHitTest;
  if (!t) return;
  if (!rafId && edgeSpeedFor(t, clientY) !== 0) {
    rafId = requestAnimationFrame(tick);
  }
}

/** Stop and forget — called from the controller's listener teardown, so
 *  every session end (commit, cancel, missed release) stops the loop. */
export function stopAutoScroll(): void {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  target = null;
  onFrame = null;
}
