import { useCallback, useEffect, useRef } from "react";
import { PanelId, Side, ViewPrefs } from "@/hooks/useViewPrefs";
import { PANEL_ICONS, panelLabel } from "./panel-icons";
import { scrollEntryIntoView } from "./layout-scroll";
import { measureOmniGap } from "./panel-column";
import { paneStrip } from "./pane-dom";
import { onLayoutGestureSetChange } from "@/lib/pane-resize";
// The two pointer invariants every held gesture in the app takes from the ONE
// SSOT — imported, never re-derived (AGENTS.md "Pane-drag stability"; the
// census's no-twins allowlist is EMPTY).
import {
  isMissedRelease,
  isPrimaryDragStart,
} from "@/lib/pane-resize/pointer-invariants";
import type { SelectionsContextValue } from "./contexts/selections";
import { getPanelSelection } from "./panel-selection";

/**
 * Strip-icon click + move handlers.
 *
 * Always-float model: clicking a strip icon opens the panel as a
 * floating window at the column rect, or closes it if it's already open.
 * The dock-toggle / split-aware branches are gone.
 */
export function useStripHandlers(deps: {
  prefs: ViewPrefs;
  /** Strip clicks force-dock the panel — append it as a band at the
   *  bottom of the side's stack (evicting the LRU band when there's no
   *  room, gated by the measured omni gap). */
  openPanelDocked: (id: PanelId, side?: Side, freeSpacePx?: number) => void;
  closePopout: (id: PanelId) => void;
  movePanel: (id: PanelId, side: Side, index?: number) => void;
  selections: SelectionsContextValue;
}) {
  const { prefs, openPanelDocked, closePopout, movePanel, selections } = deps;

  const handleMove = useCallback(
    (draggedId: PanelId, toSide: Side, toIndex?: number) => {
      movePanel(draggedId, toSide, toIndex);
    },
    [movePanel],
  );

  const handleStripClick = useCallback(
    (id: PanelId, side: Side) => {
      // "Open" = in any open form: docked as a band on either side, or
      // floating.
      const isDocked =
        prefs.dockStack.left.includes(id) || prefs.dockStack.right.includes(id);
      const isFloating = prefs.poppedOutPanels.includes(id);
      if (isDocked || isFloating) {
        closePopout(id);
        return;
      }
      // Strip clicks always open the panel as a band on its side. Measure
      // the live omni gap below the docked stack so the open-time fit check
      // can evict the LRU band when there's no room.
      openPanelDocked(id, side, measureOmniGap(side));

      // If the panel has a selected card, scroll to it once the panel
      // mounts. Two rAFs so the list has time to render.
      const sel = getPanelSelection(id, selections);
      if (!sel) return;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const entry = document.querySelector(sel.selector) as HTMLElement | null;
          if (entry) scrollEntryIntoView(entry, { behavior: "instant", block: "start" });
        });
      });
    },
    [
      openPanelDocked,
      closePopout,
      prefs.poppedOutPanels,
      prefs.dockStack,
      selections,
    ],
  );

  return { handleStripClick, handleMove };
}

// --- Draggable Icon Strip Button ---
// Uses pointer events. Drags an icon ghost. Supports cross-side moves
// (via viewport center) and same-side reordering (via Y position).
//
// ## A bespoke held gesture owes the four obligations whole (task 439)
//
// AGENTS.md → "Pane-drag stability": a gesture the engine's
// `getValue/apply/commit(px)` shape genuinely doesn't fit may stay bespoke —
// but it inherits COALESCE, SNAPSHOT, COMMIT ONCE and the two POINTER
// INVARIANTS, and it *imports* the invariants rather than re-deriving them.
// This gesture took none of the four until task 439, and the census that
// exists to catch exactly that could not see it: `pane-drag-guardrail`
// discovered its population from WINDOW-level move listeners, and this gesture
// uses React element handlers plus `setPointerCapture`. (Task-404's lesson —
// discover a census's population by the QUESTION, not by the MECHANISM — one
// census over. The census now has an element-scoped population too.)
//
// What the two invariants buy here, concretely:
//   - `isPrimaryDragStart` — pre-439 `onPointerUp` fired for ANY button with no
//     start gate, so a RIGHT-press fell through to `onClick()` and toggled the
//     panel beside the context menu the same press opened.
//   - `isMissedRelease` — `pointerStart` was cleared only by events the BUTTON
//     received, so a press whose release the button never saw left the gesture
//     ARMED. `pointermove` fires on HOVER with no button held, so the user's
//     next pass over the icon crossed the 5px threshold, appended the fixed
//     z-9999 ghost and called `setPointerCapture` on a pointer with NOTHING
//     pressed — from then on every pointer event in the document retargeted
//     here, and the next click committed a `movePanel` nobody made.

/** One button's slot in a strip, as SNAPSHOT at the gesture edge. */
interface StripSlot {
  /** Which panel this slot renders. Carried rather than merely counted so a
   *  drop can name what it lands beside — the seam an index-space fix needs. */
  panelId: string;
  /** The indicator's rest edges (viewport px). */
  top: number;
  bottom: number;
  /** The midpoint the drop index compares the cursor against. */
  mid: number;
}

/** One side's strip, as snapshot at the gesture edge. */
interface StripSideGeometry {
  left: number;
  width: number;
  top: number;
  /** In the order `movePanel` indexes — i.e. with the dragged icon already
   *  filtered out on its OWN side, because `movePanel` removes the item before
   *  it splices. */
  slots: StripSlot[];
}

/**
 * THE strip drag's geometry — swept ONCE per gesture, never per move.
 *
 * A strip cannot reflow under a held pointer, so every rect the move path used
 * to read per raw pointermove (a `document` sweep for the strip, a
 * `querySelectorAll` for its buttons, a strip rect and a
 * `getBoundingClientRect()` PER BUTTON — all forced-layout reads at 120-240 Hz)
 * is a constant of the gesture. The one real invalidation is a window-resize
 * burst, which arrives on the `LayoutGestureBus` SET channel; the snapshot is
 * dropped there and RE-CAPTURED on demand through `geometry()`, so the hover
 * and the release can never answer from two different tables (the
 * false-affordance shape task 330's adversarial pass records).
 */
interface StripDragGeometry {
  /** The viewport split the side test uses — snapshotted with the rest so the
   *  hover and the commit resolve the side identically. */
  centerX: number;
  left: StripSideGeometry | null;
  right: StripSideGeometry | null;
}

function readStripSideGeometry(
  side: Side,
  draggedId: PanelId,
  isSameSide: boolean,
): StripSideGeometry | null {
  // Task 438 — the strip is a per-PANE marker. A document-global find-first
  // can answer with a hidden keep-alive pane's strip, whose every rect is
  // zero: the indicator lands at the viewport origin and the drop index is
  // counted off the WRONG pane's icons.
  const strip = paneStrip(side);
  if (!strip) return null;
  const rect = strip.getBoundingClientRect();
  const slots: StripSlot[] = [];
  for (const el of strip.querySelectorAll<HTMLElement>("[data-panel-id]")) {
    const id = el.dataset.panelId ?? "";
    // On the dragged icon's own side, skip it so the index the user is SHOWN
    // is counted over the same list `movePanel` splices into. Crossing sides,
    // the dragged button isn't in the target strip at all.
    if (isSameSide && id === draggedId) continue;
    const r = el.getBoundingClientRect();
    slots.push({
      panelId: id,
      top: r.top,
      bottom: r.bottom,
      mid: r.top + r.height / 2,
    });
  }
  return { left: rect.left, width: rect.width, top: rect.top, slots };
}

function readStripDragGeometry(
  draggedId: PanelId,
  fromSide: Side,
): StripDragGeometry {
  return {
    centerX: window.innerWidth / 2,
    left: readStripSideGeometry("left", draggedId, fromSide === "left"),
    right: readStripSideGeometry("right", draggedId, fromSide === "right"),
  };
}

/** Pure arithmetic over the snapshot — the ONE resolution both the hover
 *  indicator and the release commit read. */
function resolveStripDrop(
  geom: StripDragGeometry,
  clientX: number,
  clientY: number,
): { side: Side; index: number; sideGeom: StripSideGeometry | null } {
  const side: Side = clientX < geom.centerX ? "left" : "right";
  const sideGeom = geom[side];
  if (!sideGeom) return { side, index: 0, sideGeom: null };
  for (let i = 0; i < sideGeom.slots.length; i++) {
    if (clientY < sideGeom.slots[i].mid) return { side, index: i, sideGeom };
  }
  return { side, index: sideGeom.slots.length, sideGeom };
}

/** Where the indicator bar rests for a resolved drop. */
function stripIndicatorTop(sideGeom: StripSideGeometry, index: number): number {
  const { slots } = sideGeom;
  if (slots.length === 0) return sideGeom.top + 12;
  if (index >= slots.length) return slots[slots.length - 1].bottom + 2;
  return slots[index].top - 2;
}

export function StripButton({
  panelId,
  active,
  onClick,
  onMove,
  side,
  stripRef,
}: {
  panelId: PanelId;
  active: boolean;
  onClick: () => void;
  onMove: (draggedId: PanelId, toSide: Side, toIndex?: number) => void;
  side: Side;
  stripRef: React.RefObject<HTMLDivElement | null>;
}) {
  const renderIcon = PANEL_ICONS[panelId];
  const label = panelLabel(panelId);
  const btnRef = useRef<HTMLButtonElement>(null);
  /** Non-null iff THIS component armed the gesture — the press passed the
   *  primary-button start gate and its release has not been observed. */
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const isDragging = useRef(false);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const indicatorRef = useRef<HTMLDivElement | null>(null);
  const handledByPointer = useRef(false);

  // COALESCE: the live pointer, one queued frame, and the last values each
  // imperative channel actually wrote (the equality bail — a held pointer
  // re-reporting the same coordinate must write nothing at all).
  const livePointer = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const frameRef = useRef<number | null>(null);
  const appliedGhost = useRef<{ x: number; y: number } | null>(null);
  const appliedIndicator = useRef<{
    left: number;
    width: number;
    top: number;
  } | null>(null);

  // SNAPSHOT: the gesture's one geometry sweep, taken lazily so a bus edge can
  // drop it and BOTH readers re-capture (never a raw ref read on one side).
  const geomRef = useRef<StripDragGeometry | null>(null);
  const unsubscribeBusRef = useRef<(() => void) | null>(null);

  const geometry = useCallback((): StripDragGeometry => {
    let g = geomRef.current;
    if (!g) {
      g = readStripDragGeometry(panelId, side);
      geomRef.current = g;
    }
    return g;
  }, [panelId, side]);

  // Single teardown for every drag terminator (up / cancel / capture-loss /
  // missed release / unmount): cancel the queued frame FIRST (a bailed gesture
  // must not commit one frame behind itself — task 333's rule), reclaim the
  // body-appended ghost + drop-indicator nodes, drop the snapshot and its bus
  // subscription, and reset the drag latches. Idempotent — safe to call when
  // no drag is in flight.
  const cleanupDragArtifacts = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    unsubscribeBusRef.current?.();
    unsubscribeBusRef.current = null;
    ghostRef.current?.remove();
    ghostRef.current = null;
    indicatorRef.current?.remove();
    indicatorRef.current = null;
    appliedGhost.current = null;
    appliedIndicator.current = null;
    geomRef.current = null;
    isDragging.current = false;
    pointerStart.current = null;
  }, []);

  // A drag can be interrupted without an `onPointerUp` firing — a
  // `pointercancel` (browser takes the gesture over as a scroll/pinch, routine
  // on touch/pen) suppresses the trailing pointerup per spec, and an unmount
  // mid-drag never sees one either. Without this, the fixed z-9999
  // `#virgil-drag-ghost` stays frozen on `document.body` and the next drag-start
  // orphans it permanently. Reclaim it on unmount.
  useEffect(() => cleanupDragArtifacts, [cleanupDragArtifacts]);

  /** Paint the drop indicator from the SNAPSHOT — pure arithmetic, no DOM
   *  read, and every write equality-bailed. The bar moves by `transform`:
   *  the pre-439 element eased its `top`/`left`, i.e. a main-thread LAYOUT
   *  animation restarted on most frames of a drag through a dense strip, so
   *  the tree was never clean and every rect read in the app paid a forced
   *  flush (task 351's "the one thing that actually MOVES was moved by top"). */
  const updateDropIndicator = useCallback(
    (clientX: number, clientY: number) => {
      const { sideGeom, index } = resolveStripDrop(geometry(), clientX, clientY);

      if (!sideGeom) {
        indicatorRef.current?.remove();
        indicatorRef.current = null;
        appliedIndicator.current = null;
        return;
      }

      let ind = indicatorRef.current;
      if (!ind) {
        ind = document.createElement("div");
        ind.id = "virgil-drop-indicator";
        ind.style.cssText = `
          position: fixed; left: 0; top: 0; z-index: 9998; pointer-events: none;
          height: 2px; background: var(--drag-highlight); border-radius: 1px;
          will-change: transform; transition: transform 0.1s ease;
        `;
        document.body.appendChild(ind);
        indicatorRef.current = ind;
        appliedIndicator.current = null;
      }

      const left = sideGeom.left + 4;
      const width = sideGeom.width - 8;
      const top = stripIndicatorTop(sideGeom, index);
      const prev = appliedIndicator.current;
      if (prev && prev.left === left && prev.width === width && prev.top === top) {
        return;
      }
      appliedIndicator.current = { left, width, top };
      // `width` is the one layout property left, and it changes only when the
      // gesture crosses to the other strip — behind the same equality bail.
      ind.style.width = `${width}px`;
      ind.style.transform = `translate3d(${left}px, ${top}px, 0)`;
    },
    [geometry],
  );

  /** The ONE coalesced frame: at most one per animation frame, reading the
   *  LIVE pointer rather than the coordinate that scheduled it. */
  const applyFrame = useCallback(() => {
    frameRef.current = null;
    if (!isDragging.current) return;
    const { x, y } = livePointer.current;
    const ghost = ghostRef.current;
    if (ghost) {
      const gx = x - 18;
      const gy = y - 18;
      const prev = appliedGhost.current;
      if (!prev || prev.x !== gx || prev.y !== gy) {
        appliedGhost.current = { x: gx, y: gy };
        ghost.style.transform = `translate3d(${gx}px, ${gy}px, 0)`;
      }
    }
    updateDropIndicator(x, y);
  }, [updateDropIndicator]);

  const scheduleFrame = useCallback(() => {
    if (frameRef.current !== null) return; // a frame is already queued
    frameRef.current = requestAnimationFrame(applyFrame);
  }, [applyFrame]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Start gate, IMPORTED from the engine's SSOT (never re-derived — the
    // census's no-twins allowlist is empty). A right- or middle-press arms
    // nothing, so `onPointerUp` below finds no armed gesture and the panel
    // does not toggle beside the context menu the same press opens.
    if (!isPrimaryDragStart(e)) return;
    pointerStart.current = { x: e.clientX, y: e.clientY };
    livePointer.current = { x: e.clientX, y: e.clientY };
    isDragging.current = false;
    handledByPointer.current = false;
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!pointerStart.current) return;
      // Missed-release failsafe — BEFORE this event's coordinate is read, so a
      // stale coordinate can never be incorporated. A hover satisfies it by
      // construction (`buttons === 0`), which is what kills the phantom drag.
      if (isMissedRelease(e)) {
        cleanupDragArtifacts();
        return;
      }
      const dx = e.clientX - pointerStart.current.x;
      const dy = e.clientY - pointerStart.current.y;
      if (!isDragging.current && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
        isDragging.current = true;
        // Capture on the STABLE button element, not `e.target` — during a move
        // `e.target` is the inner <svg>/<path>, so capturing (and its implicit
        // release) would retarget to a descendant.
        btnRef.current?.setPointerCapture(e.pointerId);
        // A window-resize burst is the one real invalidation of a snapshot
        // taken under a held pointer. The bus publishes membership changes,
        // never frames (≤2 per gesture), so it needs no kind filter: dropping
        // the snapshot is idempotent, and both readers go through `geometry()`.
        geomRef.current = null;
        unsubscribeBusRef.current = onLayoutGestureSetChange(() => {
          geomRef.current = null;
        });
        // Clone the icon as ghost
        const ghost = document.createElement("div");
        ghost.id = "virgil-drag-ghost";
        ghost.style.cssText = `
          position: fixed; left: 0; top: 0; z-index: 9999; pointer-events: none;
          padding: 8px; border-radius: var(--pod-radius);
          background: white; border: 1px solid var(--border);
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          opacity: 0.95; display: flex; align-items: center; justify-content: center;
          color: var(--accent); will-change: transform;
        `;
        // Copy the SVG from the button
        const svg = btnRef.current?.querySelector("svg");
        if (svg) {
          const clone = svg.cloneNode(true) as SVGElement;
          clone.setAttribute("stroke", "var(--accent)");
          clone.setAttribute("width", "18");
          clone.setAttribute("height", "18");
          ghost.appendChild(clone);
        }
        // Seed the transform on the creating event so the ghost never paints a
        // frame at the viewport origin.
        const gx = e.clientX - 18;
        const gy = e.clientY - 18;
        ghost.style.transform = `translate3d(${gx}px, ${gy}px, 0)`;
        appliedGhost.current = { x: gx, y: gy };
        document.body.appendChild(ghost);
        ghostRef.current = ghost;
      }
      if (isDragging.current) {
        livePointer.current = { x: e.clientX, y: e.clientY };
        scheduleFrame();
      }
    },
    [cleanupDragArtifacts, scheduleFrame],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      // Read the latches before teardown resets them. `armed` is the gate the
      // start check earns: only a gesture THIS component armed may click or
      // commit, so a right-press (which never armed) falls through to nothing.
      const armed = pointerStart.current !== null;
      const wasDragging = isDragging.current;
      // Resolve the drop from the SAME snapshot the hover indicator painted —
      // what the hover OFFERS is what the commit ACCEPTS, by construction
      // rather than by two sweeps agreeing.
      const drop = wasDragging
        ? resolveStripDrop(geometry(), e.clientX, e.clientY)
        : null;
      cleanupDragArtifacts();

      if (!armed) return;

      if (wasDragging && drop) {
        onMove(panelId, drop.side, drop.sideGeom ? drop.index : undefined);
        // The drag consumed this press — mark it handled so the browser's
        // trailing click doesn't ALSO toggle the panel (backlog #7). Safe
        // because pointerdown re-arms the guard on the next press.
        handledByPointer.current = true;
        return;
      }

      handledByPointer.current = true;
      onClick();
    },
    [cleanupDragArtifacts, geometry, onMove, panelId, onClick],
  );

  // `stripRef` is accepted for the caller's DOM attachment conventions but
  // not used here; kept to preserve the calling contract after extraction.
  void stripRef;

  // Bail-out AFTER all hooks (react-hooks/rules-of-hooks: hook order must be
  // unconditional). Never truthy for a real strip panel today — even `blank`
  // maps to `() => null` — but a future icon-less panel id would otherwise
  // change hook order and crash.
  if (!renderIcon) return null;

  return (
    <button
      ref={btnRef}
      data-panel-id={panelId}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      // A `pointercancel` (browser co-opts the gesture as scroll/pinch, routine
      // on touch/pen) suppresses the trailing `pointerup` per spec, and a
      // capture loss likewise strands the drag — both must run the same teardown
      // so the fixed z-9999 ghost/indicator can't be orphaned on document.body.
      onPointerCancel={cleanupDragArtifacts}
      onLostPointerCapture={cleanupDragArtifacts}
      onClick={() => {
        if (!handledByPointer.current) {
          onClick();
        }
        handledByPointer.current = false;
      }}
      // `touch-none` (touch-action: none) stops the browser pre-empting the drag
      // as scroll in the first place, so `pointercancel` fires far less often.
      className="iconbtn-md iconbtn-toggle relative select-none touch-none"
      aria-pressed={active}
      // `data-hint` drives the CSS tooltip; `aria-label` gives the icon-only
      // button an accessible name (the SVG carries no title/text of its own).
      aria-label={label}
      data-hint={label}
    >
      {/* Decorative: the button's name comes from `aria-label` above. */}
      <span aria-hidden="true" className="contents">
        {renderIcon(active)}
      </span>
    </button>
  );
}
