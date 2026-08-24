import { useCallback, useEffect, useRef } from "react";
import { PanelId, Side, ViewPrefs } from "@/hooks/useViewPrefs";
import { PANEL_ICONS, panelLabel } from "./panel-icons";
import { scrollEntryIntoView } from "./layout-scroll";
import { measureOmniGap } from "./panel-column";
import { paneStrip } from "./pane-dom";
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
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const isDragging = useRef(false);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const handledByPointer = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    pointerStart.current = { x: e.clientX, y: e.clientY };
    isDragging.current = false;
    handledByPointer.current = false;
  }, []);

  const indicatorRef = useRef<HTMLDivElement | null>(null);

  // Single teardown for every drag terminator (up / cancel / capture-loss /
  // unmount): reclaim the body-appended ghost + drop-indicator nodes and reset
  // the drag latches. Idempotent — safe to call when no drag is in flight.
  const cleanupDragArtifacts = useCallback(() => {
    ghostRef.current?.remove();
    ghostRef.current = null;
    indicatorRef.current?.remove();
    indicatorRef.current = null;
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

  const updateDropIndicator = useCallback((clientX: number, clientY: number) => {
    // Find which strip we're hovering
    const centerX = window.innerWidth / 2;
    const targetSide = clientX < centerX ? "left" : "right";
    // Task 438 — the strip is a per-PANE marker. A document-global find-first
    // can answer with a hidden keep-alive pane's strip, whose every rect is
    // zero: the indicator lands at the viewport origin and the drop index is
    // counted off the WRONG pane's icons.
    const targetStrip = paneStrip(targetSide) ?? undefined;

    if (!targetStrip) {
      indicatorRef.current?.remove();
      indicatorRef.current = null;
      return;
    }

    // Ensure indicator element exists
    if (!indicatorRef.current) {
      const ind = document.createElement("div");
      ind.id = "virgil-drop-indicator";
      ind.style.cssText = `
        position: fixed; z-index: 9998; pointer-events: none;
        height: 2px; background: var(--drag-highlight); border-radius: 1px;
        transition: top 0.1s ease, left 0.1s ease;
      `;
      document.body.appendChild(ind);
      indicatorRef.current = ind;
    }

    const allBtns = Array.from(targetStrip.querySelectorAll("[data-panel-id]"));
    const isSameSide = targetSide === side;
    // On same side, skip the dragged button so indicator matches movePanel's index
    const buttons = isSameSide
      ? allBtns.filter((el) => (el as HTMLElement).dataset.panelId !== panelId)
      : allBtns;
    const stripRect = targetStrip.getBoundingClientRect();
    const ind = indicatorRef.current;

    // Set horizontal position/width to match strip
    ind.style.left = `${stripRect.left + 4}px`;
    ind.style.width = `${stripRect.width - 8}px`;

    if (buttons.length === 0) {
      ind.style.top = `${stripRect.top + 12}px`;
      return;
    }

    // Find the gap the cursor is nearest to
    for (let i = 0; i < buttons.length; i++) {
      const rect = buttons[i].getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (clientY < midY) {
        ind.style.top = `${rect.top - 2}px`;
        return;
      }
    }
    // After last button
    const lastRect = buttons[buttons.length - 1].getBoundingClientRect();
    ind.style.top = `${lastRect.bottom + 2}px`;
  }, [side, panelId]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!pointerStart.current) return;
    const dx = e.clientX - pointerStart.current.x;
    const dy = e.clientY - pointerStart.current.y;
    if (!isDragging.current && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
      isDragging.current = true;
      // Capture on the STABLE button element, not `e.target` — during a move
      // `e.target` is the inner <svg>/<path>, so capturing (and its implicit
      // release) would retarget to a descendant.
      btnRef.current?.setPointerCapture(e.pointerId);
      // Clone the icon as ghost
      const ghost = document.createElement("div");
      ghost.id = "virgil-drag-ghost";
      ghost.style.cssText = `
        position: fixed; z-index: 9999; pointer-events: none;
        padding: 8px; border-radius: var(--pod-radius);
        background: white; border: 1px solid var(--border);
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        opacity: 0.95; display: flex; align-items: center; justify-content: center;
        color: var(--accent);
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
      document.body.appendChild(ghost);
      ghostRef.current = ghost;
    }
    if (isDragging.current) {
      if (ghostRef.current) {
        ghostRef.current.style.left = `${e.clientX - 18}px`;
        ghostRef.current.style.top = `${e.clientY - 18}px`;
      }
      updateDropIndicator(e.clientX, e.clientY);
    }
  }, [updateDropIndicator]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    // Read the drag latch before teardown resets it, then run the same single
    // teardown every terminator shares.
    const wasDragging = isDragging.current;
    cleanupDragArtifacts();

    if (wasDragging) {
      const centerX = window.innerWidth / 2;
      const toSide: Side = e.clientX < centerX ? "left" : "right";

      // Determine drop index by finding which button the cursor is nearest
      const targetStripSide = toSide;
      // Find the strip container for the target side
      // Task 438 — per-PANE marker; see `updateDropIndicator` above. The
      // hover and the commit must read the SAME strip, or the index the user
      // was shown is not the index that lands.
      const targetStrip = paneStrip(targetStripSide) ?? undefined;

      let toIndex: number | undefined;
      if (targetStrip) {
        const allButtons = Array.from(targetStrip.querySelectorAll("[data-panel-id]"));
        const isSameSide = toSide === side;
        // When dropping on the same side, skip the dragged button to match
        // movePanel's index (it filters the item out before splicing).
        // When crossing sides, the dragged button isn't in the target strip.
        const buttons = isSameSide
          ? allButtons.filter((el) => (el as HTMLElement).dataset.panelId !== panelId)
          : allButtons;
        const dropY = e.clientY;
        toIndex = buttons.length; // default: end
        for (let i = 0; i < buttons.length; i++) {
          const rect = buttons[i].getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          if (dropY < midY) {
            toIndex = i;
            break;
          }
        }
      }

      onMove(panelId, toSide, toIndex);
      // The drag consumed this press — mark it handled so the browser's
      // trailing click doesn't ALSO toggle the panel (backlog #7). Safe
      // because pointerdown re-arms the guard on the next press.
      handledByPointer.current = true;
      return;
    }

    handledByPointer.current = true;
    onClick();
  }, [cleanupDragArtifacts, side, onMove, panelId, onClick]);

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
