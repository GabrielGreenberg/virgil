import { useCallback, useRef } from "react";
import { PanelId, Side, ViewPrefs } from "@/hooks/useViewPrefs";
import { PANEL_ICONS, panelLabel } from "./panel-icons";
import { scrollEntryIntoView } from "./layout-scroll";
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
  /** Strip clicks force-dock the panel — opens it in the gutter dock
   *  slot regardless of the panel's last-used mode. */
  openPanelDocked: (id: PanelId, side?: Side) => void;
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
      // "Open" = in any open form: docked into a slot, or floating.
      const isDocked = Object.values(prefs.dockSlots).includes(id);
      const isFloating = prefs.poppedOutPanels.includes(id);
      if (isDocked || isFloating) {
        closePopout(id);
        return;
      }
      // Strip clicks always open the panel in its gutter dock slot —
      // even if the user previously undocked it. This also resets the
      // panel's mode preference to "docked".
      openPanelDocked(id, side);

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
    [openPanelDocked, closePopout, prefs.poppedOutPanels, prefs.dockSlots, selections],
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
  if (!renderIcon) return null;
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

  const updateDropIndicator = useCallback((clientX: number, clientY: number) => {
    // Find which strip we're hovering
    const centerX = window.innerWidth / 2;
    const targetSide = clientX < centerX ? "left" : "right";
    const strips = document.querySelectorAll("[data-strip-side]");
    const targetStrip = Array.from(strips).find(
      (el) => (el as HTMLElement).dataset.stripSide === targetSide
    ) as HTMLElement | undefined;

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
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      // Clone the icon as ghost
      const ghost = document.createElement("div");
      ghost.id = "virgil-drag-ghost";
      ghost.style.cssText = `
        position: fixed; z-index: 9999; pointer-events: none;
        padding: 8px; border-radius: 8px;
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
    ghostRef.current?.remove();
    ghostRef.current = null;
    indicatorRef.current?.remove();
    indicatorRef.current = null;

    if (isDragging.current) {
      const centerX = window.innerWidth / 2;
      const toSide: Side = e.clientX < centerX ? "left" : "right";

      // Determine drop index by finding which button the cursor is nearest
      const targetStripSide = toSide;
      // Find the strip container for the target side
      const strips = document.querySelectorAll("[data-strip-side]");
      const targetStrip = Array.from(strips).find(
        (el) => (el as HTMLElement).dataset.stripSide === targetStripSide
      ) as HTMLElement | undefined;

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
      isDragging.current = false;
      pointerStart.current = null;
      // The drag consumed this press — mark it handled so the browser's
      // trailing click doesn't ALSO toggle the panel (backlog #7). Safe
      // because pointerdown re-arms the guard on the next press.
      handledByPointer.current = true;
      return;
    }

    pointerStart.current = null;
    handledByPointer.current = true;
    onClick();
  }, [side, onMove, panelId, onClick]);

  // `stripRef` is accepted for the caller's DOM attachment conventions but
  // not used here; kept to preserve the calling contract after extraction.
  void stripRef;

  return (
    <button
      ref={btnRef}
      data-panel-id={panelId}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={() => {
        if (!handledByPointer.current) {
          onClick();
        }
        handledByPointer.current = false;
      }}
      className="iconbtn-md iconbtn-toggle relative select-none"
      aria-pressed={active}
      data-hint={label}
    >
      {renderIcon(active)}
    </button>
  );
}
