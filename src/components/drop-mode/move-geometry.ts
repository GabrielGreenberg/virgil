/**
 * move-geometry.ts — the content drag's ONE geometry sweep.
 *
 * > **A continuous gesture snapshots at its EDGE and answers per-move
 * > questions as arithmetic.** Every geometry the move path needs that cannot
 * > change while the pointer is held is captured once, read through ONE lazy
 * > door, and dropped on the gesture's end edge — so a raw `mousemove` costs
 * > no DOM measurement at all, and the coalesced frame pays a stated constant.
 *
 * This is the content-drag half of the rule `FloatingPanel`'s `readMoveGeometry`
 * states for the float move (task 330) and `focus-band-drag` states for the
 * Outline band (task 334). The drop-mode controller was the sibling that never
 * took it: per RAW pointer event it ran `deltaFor`'s
 * `scrollEl.getBoundingClientRect()` (a forced layout for a container that
 * cannot move under a held pointer), and roughly every fourth event it ran the
 * whole hit-test INLINE in the event handler — with React's indicator commit
 * landing between two of its own reads. Write → read → write per event, which
 * is task 330's diagnosis verbatim, one module over.
 *
 * Two things live here, and each is a value that is **constant for the
 * gesture** unless something the bus can see invalidates it:
 *
 *  - `scroll` — the session's scroll container and its viewport BAND. The
 *    container's own box does not move when its content scrolls, so the
 *    auto-scroll edge-zone test is pure arithmetic against it; only the
 *    `scrollTop` write path (one frame, in `auto-scroll.ts`) still touches
 *    the DOM.
 *  - `contentSpanFor(el)` — a block's HORIZONTAL content extent
 *    (`resolveContentEdges`), memoized per element for the gesture.
 *
 * **The span memo is HORIZONTAL-ONLY, and that is load-bearing rather than
 * tidy.** Auto-scroll moves content vertically under a parked pointer, so a
 * cached `.top` would be stale within one frame — while `.left` / `.width` are
 * unaffected by vertical scroll and cannot change without a reflow, which a
 * drag does not cause. A consumer that needs a vertical number must read it
 * live (the hit-test's one threaded block rect); nothing may take a Y from
 * here. The stored value is therefore the pair, not the `ContentEdges` record,
 * so there is no `.top` to reach for.
 *
 * Invalidation is the bus's SET channel — the same edge `FloatingPanel`
 * listens to, for the same reason and with the same fail-safe shape: a
 * window-resize burst is the one real invalidation of a snapshot taken under a
 * held pointer, dropping it is idempotent, and BOTH readers go through the
 * lazy door so a drop between the last move and the release re-captures rather
 * than answering `null`.
 */

import { resolveContentEdges } from "@/text-objects/block-frame";
import { onLayoutGestureSetChange } from "@/lib/pane-resize";

/** The session's scroll container plus its viewport band, snapshotted. */
export interface ScrollTarget {
  /** The element whose `scrollTop` the auto-scroll loop writes. */
  el: HTMLElement;
  /** Viewport y of the container's top edge at capture time. */
  top: number;
  /** Viewport y of the container's bottom edge at capture time. */
  bottom: number;
}

/** A block's horizontal content extent. Deliberately NOT `ContentEdges` — see
 *  the header: nothing vertical may be cached for a gesture that auto-scrolls. */
export interface ContentSpan {
  left: number;
  width: number;
}

export interface MoveGeometry {
  /** Null when the session has no resolvable scroll container (a card-body
   *  drag, a detached editor) — auto-scroll is then inert, as before. */
  scroll: ScrollTarget | null;
}

/** Resolver installed at the gesture's begin edge; null while disarmed. */
let resolveScrollEl: (() => HTMLElement | null) | null = null;
let snapshot: MoveGeometry | null = null;
let spans: WeakMap<HTMLElement, ContentSpan> | null = null;
let unsubscribeBus: (() => void) | null = null;

/**
 * Arm the door for one gesture. `getScrollEl` is called at most once per
 * capture (lazily, on first read) rather than here, because a producer can
 * begin a session while its editor's view is still settling — the same reason
 * the controller resolved the container lazily before this module existed.
 */
export function armMoveGeometry(getScrollEl: () => HTMLElement | null): void {
  resolveScrollEl = getScrollEl;
  snapshot = null;
  spans = new WeakMap();
  unsubscribeBus?.();
  // Membership edges only — never per frame, ≤2 fires per gesture — so no kind
  // filter is needed: dropping the snapshot is idempotent whatever the edge
  // was, and the lazy door re-captures on the next read.
  unsubscribeBus = onLayoutGestureSetChange(() => {
    snapshot = null;
    spans = new WeakMap();
  });
}

/** Drop everything. Called from the controller's ONE listener teardown, so no
 *  session ending (commit, cancel, missed release) can leak a stale snapshot
 *  into the next gesture. */
export function disarmMoveGeometry(): void {
  resolveScrollEl = null;
  snapshot = null;
  spans = null;
  unsubscribeBus?.();
  unsubscribeBus = null;
}

/** THE gesture's geometry, captured on demand. Both readers enter here. */
export function readMoveGeometry(): MoveGeometry {
  let g = snapshot;
  if (!g) {
    const el = resolveScrollEl?.() ?? null;
    let scroll: ScrollTarget | null = null;
    if (el) {
      const rect = el.getBoundingClientRect();
      // A zero-height container (a hidden keep-alive pane, a detached node)
      // is not a scroll target — treating it as one would put every pointer Y
      // inside both edge zones at once.
      if (rect.height > 0) {
        scroll = { el, top: rect.top, bottom: rect.bottom };
      }
    }
    g = { scroll };
    snapshot = g;
  }
  return g;
}

/**
 * A block's horizontal content extent, memoized for the gesture. Falls through
 * to a direct read when no gesture is armed, so every non-drag caller (and
 * every unit test that calls the placement builders directly) behaves exactly
 * as it did.
 */
export function contentSpanFor(el: HTMLElement): ContentSpan {
  const cache = spans;
  const hit = cache?.get(el);
  if (hit) return hit;
  const edges = resolveContentEdges(el);
  const span: ContentSpan = {
    left: edges.contentLeft,
    width: edges.contentWidth,
  };
  cache?.set(el, span);
  return span;
}

/** TEST-ONLY: is the door armed, and has it captured? */
export function __moveGeometryState(): { armed: boolean; captured: boolean } {
  return { armed: resolveScrollEl !== null, captured: snapshot !== null };
}
