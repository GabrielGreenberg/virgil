"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { DockSlotKey, PanelId } from "@/hooks/useViewPrefs";
import {
  setDockDragTarget,
  findDockTargetByPanelProximity,
} from "@/components/editor-layout/dock-drag";

interface FloatingPanelProps {
  /** Panel id this shell hosts. Required for dock-aware mounts; optional
   *  for non-panel uses (cards, dialogs) that always float. */
  panelId?: PanelId;
  /** "docked" mounts the panel inside the side gutter's dock slot via
   *  portal; "floating" mounts it at document.body. Defaults to
   *  "floating" so non-panel callers don't need to opt in. */
  mode?: "docked" | "floating";
  /** When mode==='docked', identifies which slot to portal into. */
  slotKey?: DockSlotKey | null;
  children: ReactNode;
  initialX: number;
  initialY: number;
  initialWidth: number;
  initialHeight: number;
  zIndex: number;
  onChange: (pos: { x: number; y: number; width: number; height: number }) => void;
  /** Required for panels that can dock; omitted for non-dockable
   *  callers (cards, dialogs). */
  onUndock?: (initialFloatRect: { x: number; y: number; width: number; height: number }) => void;
  /** Called on mouseup when a floating panel is released within
   *  redock proximity of a dock slot — fires only when an auto-dock
   *  target was active at the moment of release (i.e. the user could
   *  already see the dock outline). Receives the slot key the parent
   *  should redock into. */
  onMaybeRedock?: (slotKey: DockSlotKey) => void;
  /** Provides current split state per side. Used during drag to
   *  hit-test the cursor against the right slot half. The shell only
   *  needs to ask once per move. */
  getSplitState?: () => { left: boolean; right: boolean };
  onFocus?: () => void;
}

/**
 * A panel host that renders either inside a gutter dock slot
 * (mode==='docked') or as a free-floating window (mode==='floating').
 *
 * Drag-to-undock: when docked, the header strip is a drag surface. On
 * mousedown the dock-slot's "socket" outline appears (a black rectangle
 * at the slot's original geometry); on first cursor movement the panel
 * undocks (mode → 'floating') and follows the cursor as a floating
 * window. The same React component instance owns the drag, so the
 * gesture is continuous across the mode flip — no re-grab.
 *
 * Drag-to-redock: while a floating panel is being dragged, releasing
 * the cursor over a gutter dock slot redocks the panel. (Currently
 * handled by a parent: this shell forwards the mouseup event so a
 * containing layout component can decide whether to redock.)
 */
export default function FloatingPanel({
  panelId,
  mode = "floating",
  slotKey = null,
  children,
  initialX,
  initialY,
  initialWidth,
  initialHeight,
  zIndex,
  onChange,
  onUndock,
  onMaybeRedock,
  getSplitState,
  onFocus,
}: FloatingPanelProps) {
  const [pos, setPos] = useState({
    x: initialX,
    y: initialY,
    width: initialWidth,
    height: initialHeight,
  });
  const rootRef = useRef<HTMLDivElement>(null);
  // Drag state covers both move and resize gestures. While docked, only
  // "move" can start (header drag → undock). While floating, both are
  // available. The same ref is used across mode flips so the gesture is
  // continuous when undocking.
  const dragStateRef = useRef<
    | {
        mode: "move";
        startX: number;
        startY: number;
        // When the gesture starts in the docked slot, origX/origY are
        // the *docked* rect's top-left in viewport coords; on first
        // mousemove we trigger onUndock(...) using these values. After
        // undock they continue to drive the floating-pos delta math
        // (since pos has been seeded with the same values via
        // initialX/Y → setPos sync).
        origX: number;
        origY: number;
        // True until we've called onUndock() and flipped to floating.
        // First mousemove past 0px in this state triggers undock.
        pendingUndock: boolean;
        socketSlot: DockSlotKey | null;
        // Lift-off "ghost": the panel's docked rect captured at
        // mousedown. While the user is dragging away from this source
        // slot (or hovering back over it), we keep this small outline
        // showing instead of swelling to the source dock's full frame.
        // Only when the cursor approaches a *different* dock do we
        // switch to that dock's full-frame "set-down" outline.
        sourceGhost: { slotKey: DockSlotKey; rect: { left: number; top: number; width: number; height: number } } | null;
      }
    | { mode: "resize"; startX: number; startY: number; origW: number; origH: number }
    | null
  >(null);
  const latestPosRef = useRef(pos);
  latestPosRef.current = pos;
  // Latest callbacks/mode in a ref so the move/up effect can install
  // listeners once and stay stable across renders. Avoids tearing down
  // and re-binding window listeners on every prop change, and keeps
  // the hooks dep array a fixed length even when optional props
  // (onMaybeRedock) are sometimes omitted.
  const handlersRef = useRef({ onChange, onUndock, onMaybeRedock, getSplitState, mode });
  handlersRef.current = { onChange, onUndock, onMaybeRedock, getSplitState, mode };

  // Sync local pos when the parent's float rect changes (e.g. on
  // undock the parent calls onUndock which writes a new floatPosition;
  // re-rendered props bring the new initial values down to us).
  // Skipping this would leave the floating panel stuck at the docked
  // rect's pre-undock position even though prefs say otherwise.
  useEffect(() => {
    setPos({ x: initialX, y: initialY, width: initialWidth, height: initialHeight });
  }, [initialX, initialY, initialWidth, initialHeight]);

  // Window-level move/up listeners. Both modes share these — only the
  // body of the move handler differs based on dragStateRef contents.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const s = dragStateRef.current;
      if (!s) return;
      e.preventDefault();
      if (s.mode === "move") {
        const dx = e.clientX - s.startX;
        const dy = e.clientY - s.startY;
        if (s.pendingUndock) {
          // Threshold = 0px: any motion undocks. Per the spec the dock
          // socket outline is already showing from mousedown, and the
          // panel separates the moment the cursor leaves dead-still.
          if (dx === 0 && dy === 0) return;
          // Compute the initial floating rect: same width/height as the
          // docked geometry, translated by the cursor delta so the panel
          // header tracks the cursor exactly.
          const initialFloatRect = {
            x: s.origX + dx,
            y: s.origY + dy,
            width: latestPosRef.current.width,
            height: latestPosRef.current.height,
          };
          // Flip the gesture into a normal floating-move: from now on,
          // origX/Y stay anchored to the docked rect's top-left and the
          // pos updates flow through normally on subsequent mousemoves.
          s.pendingUndock = false;
          handlersRef.current.onUndock?.(initialFloatRect);
          // We've already moved this frame — apply it immediately so
          // there's no visible single-frame lag.
          setPos((p) => ({ ...p, x: initialFloatRect.x, y: initialFloatRect.y }));
          return;
        }
        const maxX = window.innerWidth - 60;
        const maxY = window.innerHeight - 40;
        const nx = Math.max(-latestPosRef.current.width + 60, Math.min(maxX, s.origX + dx));
        const ny = Math.max(0, Math.min(maxY, s.origY + dy));
        setPos((p) => ({ ...p, x: nx, y: ny }));
        // Update the dock-drag target so the outline previews where
        // the float would redock if released. Two outline modes:
        //  - Lift-off ghost (drag started from docked): keep showing
        //    the small source rect captured at mousedown, even while
        //    the panel is dragging out. Only switch when the cursor
        //    is near a *different* dock (then show that dock's full
        //    set-down frame).
        //  - Pure set-down (drag started floating): show the proximity
        //    target's full dock frame on match, else clear.
        const splitState =
          handlersRef.current.getSplitState?.() ?? { left: false, right: false };
        const panelRect = {
          x: nx,
          y: ny,
          width: latestPosRef.current.width,
          height: latestPosRef.current.height,
        };
        const proximity = findDockTargetByPanelProximity(panelRect, splitState);
        if (proximity && proximity.slotKey !== s.sourceGhost?.slotKey) {
          // A *different* dock is the candidate — show its full frame.
          setDockDragTarget(proximity);
        } else if (s.sourceGhost) {
          // Either no proximity or proximity matched the source slot:
          // keep the small lift-off ghost showing.
          setDockDragTarget(s.sourceGhost);
        } else {
          // No source (drag started floating); just track proximity.
          setDockDragTarget(proximity);
        }
      } else {
        const dw = e.clientX - s.startX;
        const dh = e.clientY - s.startY;
        const nw = Math.max(240, Math.min(900, s.origW + dw));
        const nh = Math.max(200, Math.min(window.innerHeight - 40, s.origH + dh));
        setPos((p) => ({ ...p, width: nw, height: nh }));
      }
    };
    const onUp = () => {
      const s = dragStateRef.current;
      if (!s) return;
      const wasFloatingMove =
        s.mode === "move" && !s.pendingUndock && handlersRef.current.mode === "floating";
      // Fresh proximity test for the redock target — the displayed
      // outline may be the lift-off "source ghost" even when the panel
      // isn't actually near any dock, so we can't reuse it as the
      // redock signal. Only a real proximity hit redocks.
      let dropTarget: ReturnType<typeof findDockTargetByPanelProximity> = null;
      if (wasFloatingMove) {
        const splitState =
          handlersRef.current.getSplitState?.() ?? { left: false, right: false };
        dropTarget = findDockTargetByPanelProximity(
          {
            x: latestPosRef.current.x,
            y: latestPosRef.current.y,
            width: latestPosRef.current.width,
            height: latestPosRef.current.height,
          },
          splitState,
        );
      }
      if (s.mode === "move") {
        setDockDragTarget(null);
      }
      dragStateRef.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      handlersRef.current.onChange(latestPosRef.current);
      if (wasFloatingMove && handlersRef.current.onMaybeRedock && dropTarget) {
        handlersRef.current.onMaybeRedock(dropTarget.slotKey);
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // Header mousedown — same handler in both modes. While docked, also
  // light up the dock socket outline.
  const onHeaderMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (
      target.closest(
        "button, input, textarea, select, a, [contenteditable='true'], [draggable='true'], [data-no-window-drag]",
      )
    ) {
      return;
    }
    let origX = pos.x;
    let origY = pos.y;
    const pendingUndock = mode === "docked";
    let dockedRect: DOMRect | null = null;
    if (pendingUndock && rootRef.current) {
      // Use the live docked rect rather than `pos` (which is stale for
      // docked mode — we don't track pos there).
      dockedRect = rootRef.current.getBoundingClientRect();
      origX = dockedRect.left;
      origY = dockedRect.top;
    }
    const socketSlot = pendingUndock ? slotKey : null;
    const sourceGhost = (socketSlot && dockedRect)
      ? {
          slotKey: socketSlot,
          rect: {
            left: dockedRect.left,
            top: dockedRect.top,
            width: dockedRect.width,
            height: dockedRect.height,
          },
        }
      : null;
    if (sourceGhost) {
      // Body-portaled outline at the docked rect — captured once at
      // mousedown so it doesn't shift around when the slot DOM changes
      // shape after the panel undocks.
      setDockDragTarget(sourceGhost);
    }
    dragStateRef.current = {
      mode: "move",
      startX: e.clientX,
      startY: e.clientY,
      origX,
      origY,
      pendingUndock,
      socketSlot,
      sourceGhost,
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";
    e.preventDefault();
  };

  const onResizeMouseDown = (e: React.MouseEvent) => {
    dragStateRef.current = {
      mode: "resize",
      startX: e.clientX,
      startY: e.clientY,
      origW: pos.width,
      origH: pos.height,
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "nwse-resize";
    e.preventDefault();
    e.stopPropagation();
  };

  // Resolve portal target — body for floating, dock-slot anchor for
  // docked. Looked up via useLayoutEffect so the DOM is committed
  // before we try to query for the slot anchor.
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (typeof document === "undefined") return;
    if (mode === "floating") {
      setTarget(document.body);
      return;
    }
    if (!slotKey) {
      setTarget(null);
      return;
    }
    // The slot anchor is rendered by PanelColumn whenever a panel id is
    // assigned to the slot — should always exist by the time we render.
    const el = document.querySelector<HTMLElement>(`[data-dock-slot="${slotKey}"]`);
    setTarget(el);
    if (!el) {
      // Fallback — body-portal so the panel is visible somewhere even
      // if the gutter happens to be missing the anchor. Not expected.
      setTarget(document.body);
    }
  }, [mode, slotKey]);

  if (typeof document === "undefined" || !target) return null;

  // Container style differs by mode. Docked: render in the slot's
  // normal flow with the pod styling on this container (not the slot)
  // — so when the panel's content is shorter than the dock frame, the
  // visible pod itself shrinks to that content height instead of
  // leaving an empty manilla band below it. min-height keeps an empty
  // panel from collapsing below ~2 cards' worth.
  // Floating: positioned via fixed left/top and explicit w/h.
  const containerStyle: React.CSSProperties =
    mode === "docked"
      ? {
          position: "relative",
          width: "100%",
          minHeight: 200,
          // height: auto — content drives sizing.
          background: "var(--pod-panel, #f3f0eb)",
          borderRadius: "var(--pod-radius, 8px)",
          border: "var(--pod-border, 1px solid #e5e2dd)",
          boxShadow: "var(--pod-shadow-light)",
          zIndex,
        }
      : {
          position: "fixed",
          left: pos.x,
          top: pos.y,
          width: pos.width,
          height: pos.height,
          zIndex,
          background: "var(--pod-panel, #f3f0eb)",
          borderRadius: "var(--pod-radius, 8px)",
          border: "var(--pod-border, 1px solid #e5e2dd)",
          boxShadow:
            "0 10px 30px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10)",
        };

  return createPortal(
    <div
      ref={rootRef}
      data-floating-panel="true"
      data-panel-shell-mode={mode}
      data-panel-shell-id={panelId}
      className="flex flex-col overflow-hidden"
      style={containerStyle}
      onMouseDown={onFocus}
    >
      <div
        onMouseDown={onHeaderMouseDown}
        style={{ cursor: "grab" }}
        className="flex flex-col min-h-0 flex-1"
      >
        {children}
      </div>
      {mode === "floating" && (
        <div
          onMouseDown={onResizeMouseDown}
          className="absolute bottom-0 right-0 w-3.5 h-3.5 cursor-nwse-resize"
          style={{
            background:
              "linear-gradient(135deg, transparent 0%, transparent 45%, #b8b4ad 45%, #b8b4ad 55%, transparent 55%, transparent 75%, #b8b4ad 75%, #b8b4ad 85%, transparent 85%)",
          }}
          aria-label="Resize"
        />
      )}
    </div>,
    target,
  );
}
