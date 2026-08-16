"use client";

import { useState, useRef, useCallback } from "react";
import {
  isMissedRelease,
  isPrimaryDragStart,
} from "@/lib/pane-resize/pointer-invariants";

interface Position {
  x: number;
  y: number;
}

/**
 * The gesture's clamp bounds — how far the panel's top-left may travel before
 * its far edge leaves the viewport. Captured ONCE on the gesture edge, exactly
 * as `FloatingPanel`'s `MoveGeometry` is (AGENTS.md "Pane-drag stability", the
 * SNAPSHOT obligation): `offsetWidth`/`offsetHeight` are forced-layout reads,
 * and a dialog's size and the viewport are gesture-invariant, so reading them
 * inside the RAF body made every frame a write → read → write.
 *
 * Stated residual, shared with FloatingPanel's snapshot: a viewport change
 * MID-gesture (an OS window resize while the dialog is held) leaves these
 * stale for the rest of the drag. The clamp only decides how far off-screen
 * the panel may be pushed, so the cost is a slightly wrong ceiling for one
 * gesture, and the next press re-captures.
 */
interface DragBounds {
  maxX: number;
  maxY: number;
}

/**
 * Makes a panel draggable by its header/handle.
 * Position starts as null (CSS centering), becomes {x,y} after first drag.
 *
 * Bespoke by shape (a 2D float move has no `getValue/apply/commit(px)` value
 * for `usePaneResizeHandle`), never by discipline: it takes both pointer
 * invariants from the engine's own SSOT, coalesces its writes to ≤1 per frame,
 * snapshots its geometry at the gesture edge, and ends through ONE path.
 */
export function useDragPosition() {
  const [position, setPosition] = useState<Position | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const offsetRef = useRef<Position>({ x: 0, y: 0 });
  const rafRef = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const panel = panelRef.current;
    if (!panel || !isPrimaryDragStart(e)) return;

    const rect = panel.getBoundingClientRect();
    offsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    draggingRef.current = true;

    // THE gesture's one geometry sweep (see `DragBounds`).
    const bounds: DragBounds = {
      maxX: window.innerWidth - panel.offsetWidth,
      maxY: window.innerHeight - panel.offsetHeight,
    };

    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";

    /** The ONE end path — every ending (release, missed release) enters here,
     *  so no ending can skip the chrome teardown or leave a queued frame that
     *  would commit a coordinate after the gesture is over. */
    const endGesture = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    function handleMouseMove(ev: MouseEvent) {
      // Missed-release failsafe (the engine's own predicate, task 185): the
      // primary button is up, so the release happened somewhere we never
      // observed — over the compiled-PDF iframe, outside the window, eaten by
      // a context menu, or let go while a second button is chorded. End HERE
      // and do NOT incorporate this event's coordinate: the dialog would
      // otherwise stay glued to the cursor and commit on the user's next
      // click. `endGesture` cancels the queued frame, so no stray coordinate
      // survives it either.
      if (isMissedRelease(ev)) {
        endGesture();
        return;
      }
      const x = ev.clientX - offsetRef.current.x;
      const y = ev.clientY - offsetRef.current.y;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        // Pure arithmetic over the gesture's snapshot — no DOM reads.
        setPosition({
          x: Math.max(0, Math.min(x, bounds.maxX)),
          y: Math.max(0, Math.min(y, bounds.maxY)),
        });
      });
    }

    function handleMouseUp() {
      endGesture();
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }, []);

  return { position, onMouseDown, panelRef, isDraggingRef: draggingRef };
}
