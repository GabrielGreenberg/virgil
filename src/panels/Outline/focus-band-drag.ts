"use client";

import { useCallback, useEffect, useRef } from "react";
import { isMissedRelease, isPrimaryDragStart } from "@/lib/pane-resize/pointer-invariants";

/**
 * Focus-band drag commit decision (task 113).
 *
 * On mouseup the FocusBand drag commits its single snapBoundary write only if
 * the dragged edge actually landed on a different row than the one it STARTED
 * on. The baseline is the dragged edge's OWN committed block index — not the
 * opposite (fixed) edge's. Comparing against the fixed edge (the original bug)
 * silently dropped the standard shrink gesture: dragging an edge onto the
 * opposite edge's row (pending === fixed) read as "not moved", so the range
 * never shrank and the collapsed transient rect stayed painted.
 *
 * Pure so the decision is unit-testable independent of DOM measurement.
 */
export function resolveDragCommit({
  edge,
  pendingBlockIndex,
  startBlockIndex,
  endBlockIndex,
}: {
  edge: "top" | "bottom";
  /** Row the dragged edge is snapped to at release; null = no mousemove ran. */
  pendingBlockIndex: number | null;
  /** Committed range at drag start. */
  startBlockIndex: number;
  endBlockIndex: number;
}): { commit: false } | { commit: true; blockIndex: number } {
  const draggedBlockIndex = edge === "top" ? startBlockIndex : endBlockIndex;
  if (pendingBlockIndex == null || pendingBlockIndex === draggedBlockIndex) {
    return { commit: false };
  }
  return { commit: true, blockIndex: pendingBlockIndex };
}

/** A candidate snap row, measured once at mousedown. */
export interface FocusBandRow {
  blockIndex: number;
  top: number;
  mid: number;
  bottom: number;
}

/** Live drag state — the mousedown snapshot plus the row the edge is on now. */
interface FocusBandDragState {
  edge: "top" | "bottom";
  rows: FocusBandRow[];
  /** Pixel position of the edge that stays put for the whole gesture. */
  fixedPx: number;
  /** The committed range at mousedown (the commit baseline — task 113). */
  startBlockIndex: number;
  endBlockIndex: number;
  /** Row the dragged edge is snapped to right now; null = no move ran. */
  pendingBlockIndex: number | null;
}

export interface FocusBandEdgeDragOptions {
  /** The outline's scroll container — cursor Y is resolved against it. */
  getScrollContainer: () => HTMLElement | null;
  /** False while Focus mode is locked or nothing can be committed. */
  enabled: boolean;
  /** Candidate snap rows, measured fresh at each mousedown. */
  measureRows: () => FocusBandRow[];
  /** The band's current rect, for capturing the fixed edge's pixel. */
  getBand: () => { top: number; height: number } | null;
  /** The committed range at mousedown. */
  getRange: () => { startBlockIndex: number; endBlockIndex: number };
  /** Minimum band height so a drag past the opposite edge can't invert it. */
  minPx: number;
  /** Paint the transient (uncommitted) rect. */
  setBand: (rect: { top: number; height: number }) => void;
  /** Toggle the band's CSS transition — off mid-drag so it tracks the cursor. */
  setAnimated: (animated: boolean) => void;
  /** Restore the authoritative rect after an end that did NOT commit. */
  restore: () => void;
  /** Called on both gesture edges. The owner parks this in a ref and reads
   *  it in `measure()` to bail while a gesture is live — pushed out rather
   *  than returned so the owner's `measure` can also BE `restore`. */
  setDragging: (dragging: boolean) => void;
  onSnapBoundary?: (edge: "top" | "bottom", blockIndex: number) => void;
}

/**
 * The FocusBand's edge-drag gesture (task 185).
 *
 * Extracted out of `OutlinePanel` so the gesture is a named unit with ONE end
 * path that unit tests can drive at the DOM level. It stays bespoke rather
 * than moving onto `usePaneResizeHandle` on purpose: this is a snap-to-row
 * *selection* gesture, not a pane divider — there is no px value to
 * `apply()`/`commit()`, only a transient rect and a single committed block
 * index, so the engine's shape does not fit.
 *
 * What it DOES take from the engine is the pair of pointer invariants every
 * gesture needs (`../../lib/pane-resize/pointer-invariants`):
 *
 *  - a **primary-button start gate**, so a right-press can't begin a drag
 *    whose mouseup the context menu then eats;
 *  - a **missed-release failsafe** — a mousemove arriving with the primary
 *    button up means the release happened where we never saw it (over the PDF
 *    iframe, outside the window). Before this, the gesture stayed live: the
 *    band ghost-tracked a released pointer and the user's NEXT CLICK ran the
 *    mouseup handler, committing an `onSnapBoundary` boundary they never
 *    chose. That durable, unrequested state write is the bug.
 *
 * Every exit — mouseup, failsafe, and unmount/disable mid-gesture — runs the
 * same `endDrag`, which is the only code that nulls the drag state and clears
 * the body cursor/selection stamp. Mid-drag stays a purely LOCAL overlay
 * gesture (CHIP B): the rect is driven from the mousedown snapshot, RAF-
 * throttled, with no parent state or disk write until the single commit.
 */
export function useFocusBandEdgeDrag(options: FocusBandEdgeDragOptions): {
  startDrag: (edge: "top" | "bottom") => (e: React.MouseEvent) => void;
} {
  // Latest options by ref so the document listeners never go stale while the
  // effect stays off the drag path (same discipline as the engine's specRef).
  // Refreshed from an effect rather than during render: every consumer of it
  // is event- or RAF-driven, so it is never read before the commit that
  // refreshed it.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const dragRef = useRef<FocusBandDragState | null>(null);
  // Non-null exactly while the listeners are mounted. mousedown refuses to
  // start a gesture without them — a drag with no end path alive would stamp
  // the body cursor and never clear it.
  const endDragRef = useRef<((mode: "commit" | "detach") => void) | null>(null);

  const { enabled } = options;

  useEffect(() => {
    if (!enabled) return;

    let rafId: number | null = null;
    let lastY = 0;

    // Snap the dragged edge to the nearest row and repaint the transient rect.
    const flush = () => {
      rafId = null;
      const drag = dragRef.current;
      if (!drag) return;
      const { minPx, setBand } = optionsRef.current;
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < drag.rows.length; i++) {
        const dist = Math.abs(lastY - drag.rows[i].mid);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      }
      const row = drag.rows[bestIdx];
      if (!row) return;
      drag.pendingBlockIndex = row.blockIndex;
      // Transient rect against the fixed edge. Clamp so the band never inverts
      // or collapses (consistent with snapBoundary's 1-row clamp).
      if (drag.edge === "top") {
        const newTop = Math.min(row.top, drag.fixedPx - minPx);
        setBand({ top: newTop, height: drag.fixedPx - newTop });
      } else {
        const newBottom = Math.max(row.bottom, drag.fixedPx + minPx);
        setBand({ top: drag.fixedPx, height: newBottom - drag.fixedPx });
      }
    };

    /**
     * THE single end path. `commit` runs the normal release decision;
     * `detach` (unmount / Focus mode locked mid-gesture) tears down without
     * writing anything.
     */
    const endDrag = (mode: "commit" | "detach") => {
      const drag = dragRef.current;
      if (!drag) return;
      const { onSnapBoundary, restore, setAnimated, setDragging } = optionsRef.current;

      // Flush a frame that's already queued so the commit sees the row the
      // band is actually painted on — a drag released inside the same frame
      // as its last move would otherwise commit a stale (or null) row. The
      // MISSED-RELEASE caller never reaches here with a ghost coordinate: it
      // bails before touching `lastY`, so any pending frame carries the last
      // position the button was genuinely held at.
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
        if (mode === "commit") flush();
      }

      const decision =
        mode === "commit"
          ? resolveDragCommit({
              edge: drag.edge,
              pendingBlockIndex: drag.pendingBlockIndex,
              startBlockIndex: drag.startBlockIndex,
              endBlockIndex: drag.endBlockIndex,
            })
          : ({ commit: false } as const);

      dragRef.current = null;
      setDragging(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setAnimated(true);

      if (decision.commit) {
        // After this lands, focusState updates and the (now un-guarded)
        // measure() recomputes the authoritative rect — which matches the
        // transient rect we already painted (same snapped row → same offsetTop/
        // offsetHeight), so there is no visible jump.
        onSnapBoundary?.(drag.edge, decision.blockIndex);
      } else {
        // No commit → focusState is untouched, so nothing re-runs measure()
        // for us (the MO fires on childList only). Restore the authoritative
        // rect ourselves — the mid-drag transient rect may still be painted
        // (drag state is cleared, so measure() no longer bails).
        restore();
      }
    };
    endDragRef.current = endDrag;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      // Missed-release failsafe FIRST — end HERE, before this event's
      // coordinate is read, so the band can't ghost-track a pointer with no
      // button held. Ahead of the container lookup on purpose: a gesture whose
      // container went away still has to be endable.
      if (isMissedRelease(e)) {
        endDrag("commit");
        return;
      }
      const container = optionsRef.current.getScrollContainer();
      if (!container) return;
      const rect = container.getBoundingClientRect();
      lastY = e.clientY - rect.top + container.scrollTop;
      if (rafId === null) rafId = requestAnimationFrame(flush);
    };

    const handleMouseUp = () => endDrag("commit");

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      // Unmounting (or locking Focus mode) mid-gesture must not leave the
      // body stamped `ns-resize`/`user-select: none` with no listener left
      // alive to clear it.
      endDrag("detach");
      endDragRef.current = null;
    };
  }, [enabled]);

  const startDrag = useCallback(
    (edge: "top" | "bottom") => (e: React.MouseEvent) => {
      // Primary button only — a right-press must not start a gesture whose
      // mouseup the context menu can eat. Gate BEFORE preventDefault so the
      // context menu still behaves normally.
      if (!isPrimaryDragStart(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const { measureRows, getBand, getRange, setAnimated, setDragging } = optionsRef.current;
      const band = getBand();
      if (!band || !endDragRef.current) return;
      const rows = measureRows();
      if (rows.length === 0) return;
      // The OPPOSITE edge stays put for the whole drag. Capture its pixel
      // position from the current band rect so the transient rect references
      // it, plus the full committed range so the moved-check on commit
      // compares the dragged edge against its OWN row (task 113).
      const fixedPx = edge === "top" ? band.top + band.height : band.top;
      const range = getRange();
      dragRef.current = {
        edge,
        rows,
        fixedPx,
        startBlockIndex: range.startBlockIndex,
        endBlockIndex: range.endBlockIndex,
        pendingBlockIndex: null,
      };
      setDragging(true);
      document.body.style.cursor = "ns-resize";
      document.body.style.userSelect = "none";
      // Disable transitions during drag so the band tracks the cursor.
      setAnimated(false);
    },
    [],
  );

  return { startDrag };
}
