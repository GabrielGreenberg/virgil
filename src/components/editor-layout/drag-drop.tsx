import { useCallback, useRef } from "react";
import { PanelId, Side, Half, ViewPrefs } from "@/hooks/useViewPrefs";
import { PANEL_ICONS, panelLabel } from "./panel-icons";

/**
 * Strip-icon click + move handlers.
 *
 * - `handleStripClick` routes a click to the focused half when the side
 *   is split, otherwise behaves like togglePanel.
 * - `handleMove` forwards a drag reorder to movePanel.
 *
 * Takes deps explicitly rather than reading from EditorLayoutCtx so it
 * can be called from the shell (the shell is the provider, so it can't
 * consume the context it supplies).
 */
export function useStripHandlers(deps: {
  prefs: ViewPrefs;
  focusedHalfLeft: Half;
  focusedHalfRight: Half;
  togglePanel: (id: PanelId) => void;
  movePanel: (id: PanelId, side: Side, index?: number) => void;
  setActiveHalf: (side: Side, half: Half, id: PanelId) => void;
}) {
  const {
    prefs,
    focusedHalfLeft,
    focusedHalfRight,
    togglePanel,
    movePanel,
    setActiveHalf,
  } = deps;

  const handleMove = useCallback(
    (draggedId: PanelId, toSide: Side, toIndex?: number) => {
      movePanel(draggedId, toSide, toIndex);
    },
    [movePanel],
  );

  const handleStripClick = useCallback(
    (id: PanelId, side: Side) => {
      const split =
        side === "left" ? prefs.activeLeftBottom != null : prefs.activeRightBottom != null;
      if (!split) {
        togglePanel(id);
        return;
      }
      const focused = side === "left" ? focusedHalfLeft : focusedHalfRight;
      const currentInFocus =
        side === "left"
          ? focused === "top"
            ? prefs.activeLeft
            : prefs.activeLeftBottom
          : focused === "top"
            ? prefs.activeRight
            : prefs.activeRightBottom;
      // Toggling: clicking the icon for what's already in the focused half
      // closes it (sets that half to "blank" — we never want a null half
      // when split).
      const next: PanelId = currentInFocus === id ? "blank" : id;
      setActiveHalf(side, focused, next);
    },
    [
      togglePanel,
      setActiveHalf,
      prefs.activeLeft,
      prefs.activeRight,
      prefs.activeLeftBottom,
      prefs.activeRightBottom,
      focusedHalfLeft,
      focusedHalfRight,
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
  badge,
  stripRef,
}: {
  panelId: PanelId;
  active: boolean;
  onClick: () => void;
  onMove: (draggedId: PanelId, toSide: Side, toIndex?: number) => void;
  side: Side;
  badge?: boolean;
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
        height: 2px; background: var(--accent); border-radius: 1px;
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
      className={`p-1.5 rounded transition-colors relative select-none ${
        active ? "text-[var(--accent)] bg-[var(--accent-light)] shadow-[inset_0_0_0_1px_rgba(124,94,60,0.3)]" : "text-[var(--muted)] hover:bg-surface-muted-strong hover:text-ink-body"
      }`}
      title={label}
    >
      {renderIcon(active)}
      {badge && (
        <div className="absolute top-1 right-1 w-1.5 h-1.5 bg-[var(--accent)] rounded-full" />
      )}
    </button>
  );
}
