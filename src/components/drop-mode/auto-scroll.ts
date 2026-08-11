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
 * the controller to re-run its (throttled) hit-test at the unchanged pointer
 * position — so the drop indicator tracks the content sliding under the
 * cursor. The loop self-terminates the frame the pointer leaves the zone,
 * and the controller stops it on session teardown. Scope is deliberately
 * the main editor's container only (the far-target case this exists for);
 * hovering a card body's own scroller doesn't auto-scroll it.
 *
 * Cost: zero when idle (no listeners of its own, no timers); while
 * scrolling, one rect read + one scroll write + one re-hit-test request per
 * frame — bounded, gesture-scoped, and off every non-drag path.
 */

/** Pointer-to-edge distance that arms auto-scroll. */
const EDGE_ZONE_PX = 56;
/** Max scroll speed at the very edge, px per frame (~1080 px/s @60Hz). */
const MAX_SPEED_PX = 18;

let rafId = 0;
let scrollEl: HTMLElement | null = null;
let pointerY = 0;
let onFrame: (() => void) | null = null;

function deltaFor(el: HTMLElement, clientY: number): number {
  const rect = el.getBoundingClientRect();
  if (rect.height <= 0) return 0;
  const fromTop = clientY - rect.top;
  const fromBottom = rect.bottom - clientY;
  if (fromTop < EDGE_ZONE_PX) {
    if (el.scrollTop <= 0) return 0;
    // Eased: full speed at the edge, tapering to 0 at the zone boundary.
    const t = 1 - Math.max(0, fromTop) / EDGE_ZONE_PX;
    return -Math.ceil(MAX_SPEED_PX * t * t);
  }
  if (fromBottom < EDGE_ZONE_PX) {
    if (el.scrollTop >= el.scrollHeight - el.clientHeight) return 0;
    const t = 1 - Math.max(0, fromBottom) / EDGE_ZONE_PX;
    return Math.ceil(MAX_SPEED_PX * t * t);
  }
  return 0;
}

function tick() {
  rafId = 0;
  const el = scrollEl;
  if (!el || !onFrame) return;
  const delta = deltaFor(el, pointerY);
  if (delta === 0) return; // left the zone / hit the end — self-terminate
  el.scrollTop += delta;
  // Content moved under the parked pointer — the indicator must re-resolve.
  onFrame();
  rafId = requestAnimationFrame(tick);
}

/**
 * Feed a pointer move. `el` is the session's scroll container (resolved
 * once per session by the controller), `reHitTest` re-runs the controller's
 * throttled hit-test at the current pointer point.
 */
export function feedAutoScroll(
  el: HTMLElement | null,
  clientY: number,
  reHitTest: () => void,
): void {
  scrollEl = el;
  pointerY = clientY;
  onFrame = reHitTest;
  if (!el) return;
  if (!rafId && deltaFor(el, clientY) !== 0) {
    rafId = requestAnimationFrame(tick);
  }
}

/** Stop and forget — called from the controller's listener teardown, so
 *  every session end (commit, cancel, missed release) stops the loop. */
export function stopAutoScroll(): void {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  scrollEl = null;
  onFrame = null;
}
