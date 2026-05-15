"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { DockSlotKey, PanelId } from "@/hooks/useViewPrefs";
import {
  setDockDragTarget,
  findDockTargetByPanelProximity,
  findDockTargetAtPoint,
  type DockDragTarget,
} from "@/components/editor-layout/dock-drag";
import { beginDropSession } from "@/components/drop-mode/controller";
import {
  isOverStackIcon,
  isHeaderOverStackIcon,
  setStackDropTarget,
  getStackDropTarget,
} from "@/lib/stack/stack-drop-target";

/**
 * Imperative handle exposed via `forwardRef`. Used by FloatCard to hand
 * off an in-progress mouse drag from the source card's lift gesture
 * directly into this floating panel — see `card-lift.ts` for the flow.
 */
export interface FloatingPanelHandle {
  /** Begin a move-drag at the given viewport coords as if the user just
   *  mousedowned the floating panel's header. The window-level move/up
   *  listeners (already mounted) pick up the gesture from there. */
  beginDragAt: (clientX: number, clientY: number) => void;
}

interface FloatingPanelProps {
  /** Panel id this shell hosts. Required for dock-aware mounts; optional
   *  for non-panel uses (cards, dialogs) that always float. */
  panelId?: PanelId;
  /** Popout key for cards/blocks (`${kind}:${id}`). Required to start a
   *  drop-mode session on shift+mousedown — non-card floats (dialogs)
   *  may omit it. */
  cardKey?: string;
  /** "docked" mounts the panel inside the side gutter's dock slot via
   *  portal; "floating" mounts it at document.body. Defaults to
   *  "floating" so non-panel callers don't need to opt in. */
  mode?: "docked" | "floating";
  /** When mode==='docked', identifies which slot to portal into. */
  slotKey?: DockSlotKey | null;
  /** Visual treatment when floating. "panel" (default) is the popup
   *  look — beige pod bg, strong drop shadow. "card" reads as an
   *  ambient card on the canvas — white surface, gentle ambient
   *  shadow. Used by text-content floats (paragraph/heading/selection)
   *  whose chrome should disappear behind the prose. */
  surface?: "panel" | "card";
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
function FloatingPanelInner({
  panelId,
  cardKey,
  mode = "floating",
  slotKey = null,
  surface = "panel",
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
}: FloatingPanelProps, handleRef: React.ForwardedRef<FloatingPanelHandle>) {
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
        sourceGhost: DockDragTarget | null;
        // Docked geometry captured at mousedown so the freshly-floating
        // panel lifts off at the same size it had in the dock. Null for
        // gestures that didn't start docked (e.g. card hand-offs via
        // beginDragAt, or floating-mode header drags).
        dockedWidth: number | null;
        dockedHeight: number | null;
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
          // header tracks the cursor exactly. The docked w/h were
          // captured at mousedown — clamp to the same min/max bounds the
          // resize gesture enforces so an oversized docked panel doesn't
          // lift off larger than the floating shell ever allows.
          const fallbackW = latestPosRef.current.width;
          const fallbackH = latestPosRef.current.height;
          const rawW = s.dockedWidth ?? fallbackW;
          const rawH = s.dockedHeight ?? fallbackH;
          const initialFloatRect = {
            x: s.origX + dx,
            y: s.origY + dy,
            width: Math.max(240, Math.min(900, rawW)),
            height: Math.max(200, Math.min(window.innerHeight - 40, rawH)),
          };
          // Flip the gesture into a normal floating-move: from now on,
          // origX/Y stay anchored to the docked rect's top-left and the
          // pos updates flow through normally on subsequent mousemoves.
          s.pendingUndock = false;
          handlersRef.current.onUndock?.(initialFloatRect);
          // We've already moved this frame — apply it immediately so
          // there's no visible single-frame lag. Includes width/height
          // so the panel renders at the docked-derived size in the same
          // commit, rather than flashing the prior saved float size for
          // one frame before the parent re-render syncs it back.
          setPos(() => ({
            x: initialFloatRect.x,
            y: initialFloatRect.y,
            width: initialFloatRect.width,
            height: initialFloatRect.height,
          }));
          return;
        }
        const maxX = window.innerWidth - 60;
        const maxY = window.innerHeight - 40;
        const nx = Math.max(-latestPosRef.current.width + 60, Math.min(maxX, s.origX + dx));
        const ny = Math.max(0, Math.min(maxY, s.origY + dy));
        setPos((p) => ({ ...p, x: nx, y: ny }));
        // Stack-drop affordance: when a card/block float drags over the
        // StackIcon, light up its illuminated ring. The icon component
        // caches its rect into a module-level signal so this stays a
        // pure-data lookup. Suppresses the dock outline so the two
        // affordances don't fight.
        if (cardKey) {
          // Two acceptable conditions: the cursor itself is over the
          // icon, OR the dragged float's header strip overlaps the icon.
          // The latter makes the drop target much more forgiving — the
          // user only needs to nudge the card header onto the circle,
          // not center the cursor.
          const stackHit =
            isOverStackIcon(e.clientX, e.clientY) ||
            isHeaderOverStackIcon({
              x: nx,
              y: ny,
              width: latestPosRef.current.width,
            });
          if (stackHit) {
            setStackDropTarget(true);
            setDockDragTarget(null);
            return;
          }
          if (getStackDropTarget()) setStackDropTarget(false);
        }
        // Skip dock-outline updates entirely for shells that aren't
        // dock-eligible (popped-out cards, dialogs). Cards can't redock,
        // so flashing the dock outline as they pass over a column would
        // promise a drop that never happens.
        if (!handlersRef.current.onMaybeRedock) {
          return;
        }
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
        const proximity = findDockTargetByPanelProximity(
          panelRect,
          splitState,
          undefined,
          { x: e.clientX, y: e.clientY },
        );
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
    const onUp = (e: MouseEvent) => {
      const s = dragStateRef.current;
      if (!s) return;
      const wasFloatingMove =
        s.mode === "move" && !s.pendingUndock && handlersRef.current.mode === "floating";
      // Stack drop: cursor OR the dragged float's header is over the
      // StackIcon at release. Emit a doc-level event so EditorPane
      // (which holds the per-doc hooks) can perform the snapshot. Skip
      // the rest of the redock flow on stack drop.
      const stackDropHit =
        wasFloatingMove && cardKey != null &&
        (
          isOverStackIcon(e.clientX, e.clientY) ||
          isHeaderOverStackIcon({
            x: latestPosRef.current.x,
            y: latestPosRef.current.y,
            width: latestPosRef.current.width,
          })
        );
      if (stackDropHit) {
        setStackDropTarget(false);
        setDockDragTarget(null);
        dragStateRef.current = null;
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("virgil-stack-drop", {
              detail: { cardKey, clientX: e.clientX, clientY: e.clientY },
            }),
          );
        }
        return;
      }
      // Clear stack-target signal whenever we exit a drag (covers a
      // miss after a hover).
      if (getStackDropTarget()) setStackDropTarget(false);
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
          undefined,
          { x: e.clientX, y: e.clientY },
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
    // Shift+mousedown on the grab bar → drop-mode session. Only for
    // popped-out cards/blocks (have a cardKey). The controller no-ops
    // gracefully if no spec is registered for this kind, so this is a
    // safe branch to install even before all specs are wired.
    if (e.shiftKey && cardKey && mode === "floating") {
      const started = beginDropSession({
        cardKey,
        origin: { x: e.clientX, y: e.clientY },
      });
      if (started) {
        e.preventDefault();
        return;
      }
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
    // Source-ghost rect: for a non-split slot, use the panel's rendered
    // rect. For a split-half slot, use the half-slot anchor's rect
    // instead — `rootRef` reflects the panel's intrinsic content height
    // (which can exceed the half) while the anchor div is the actual
    // half-height frame the user sees, clipped by `overflow: hidden`.
    // Using the anchor keeps the primary outline visually symmetric
    // with the companion half rect during the lift-off drag.
    let primaryRect = dockedRect
      ? { left: dockedRect.left, top: dockedRect.top, width: dockedRect.width, height: dockedRect.height }
      : null;
    let companionRect: DockDragTarget["companionRect"];
    if (socketSlot) {
      const m = socketSlot.match(/^(left|right)-(top|bottom)$/);
      if (m) {
        const sourceHalf = document.querySelector<HTMLElement>(
          `[data-panel-column-side="${m[1]}"] [data-panel-half="${m[2]}"]`,
        );
        if (sourceHalf) {
          const r = sourceHalf.getBoundingClientRect();
          primaryRect = { left: r.left, top: r.top, width: r.width, height: r.height };
        }
        // Companion = the OTHER half's geometric rect (derived from the
        // column + viewport, not the sibling element's bounding rect).
        // The sibling div is empty while the other half is undocked, so
        // its bounding rect collapses to ~0 — useless as an outline.
        // Reuse findDockTargetAtPoint by probing at the column center
        // and the other half's vertical midline.
        const col = document.querySelector<HTMLElement>(
          `[data-panel-column-side="${m[1]}"]`,
        );
        if (col) {
          const cr = col.getBoundingClientRect();
          const splitState = { left: m[1] === "left", right: m[1] === "right" };
          // Probe at viewport-bound y so we don't fall outside the column rect.
          const podGap =
            parseFloat(
              getComputedStyle(document.documentElement).getPropertyValue("--pod-gap"),
            ) || 10;
          const TOP_BAR = 32;
          const fullTop = TOP_BAR + podGap;
          const fullHeight = window.innerHeight - TOP_BAR - 2 * podGap;
          const halfHeight = Math.floor((fullHeight - podGap) / 2);
          const probeY = m[2] === "top"
            ? fullTop + halfHeight + podGap + halfHeight / 2  // center of bottom
            : fullTop + halfHeight / 2;                       // center of top
          const otherTarget = findDockTargetAtPoint(
            cr.left + cr.width / 2,
            probeY,
            splitState,
          );
          if (otherTarget) companionRect = otherTarget.rect;
        }
      }
    }
    const sourceGhost: DockDragTarget | null = (socketSlot && primaryRect)
      ? { slotKey: socketSlot, rect: primaryRect, companionRect }
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
      // Capture docked w/h from the same primaryRect the source ghost
      // uses — for split halves this is the half-anchor's visual frame
      // (not the panel's intrinsic content height), so undocking from a
      // half-slot gives a half-sized floating panel.
      dockedWidth: pendingUndock && primaryRect ? primaryRect.width : null,
      dockedHeight: pendingUndock && primaryRect ? primaryRect.height : null,
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";
    e.preventDefault();
  };

  // Expose an imperative `beginDragAt(x, y)` so a card lift-off can
  // hand the in-flight mouse drag straight into this freshly-mounted
  // floating panel — same effect as if the user had mousedowned the
  // header at (x, y). pendingUndock is false (already floating).
  useImperativeHandle(handleRef, () => ({
    beginDragAt: (clientX: number, clientY: number) => {
      dragStateRef.current = {
        mode: "move",
        startX: clientX,
        startY: clientY,
        origX: latestPosRef.current.x,
        origY: latestPosRef.current.y,
        pendingUndock: false,
        socketSlot: null,
        sourceGhost: null,
        dockedWidth: null,
        dockedHeight: null,
      };
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";
    },
  }), []);

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
  // In split mode, the slot anchor has an explicit height (50% of the
  // column dock area). The docked panel must fill that to ~100% so its
  // internal scrolling kicks in for tall content; otherwise the panel
  // grows past the slot's max-height and gets clipped by the half's
  // overflow:hidden, leaving the bottom truncated. In non-split (full
  // slot) the anchor is auto-height with a max-height cap, so the panel
  // stays content-driven (with min-height 200) — same as before.
  const isHalfSlot = !!slotKey && (slotKey.endsWith("-top") || slotKey.endsWith("-bottom"));
  const containerStyle: React.CSSProperties =
    mode === "docked"
      ? {
          position: "relative",
          width: "100%",
          ...(isHalfSlot
            ? { height: "100%" }
            : {
                minHeight: "var(--panel-min-h, 200px)",
                // Cap at the dock-frame max-height the slot exposes,
                // so PANEL.list's flex-1 overflow-y-auto can engage when
                // content overflows. Falls back to none when not docked
                // into a slot (defensive — shouldn't happen).
                maxHeight: "var(--dock-slot-frame-h, none)",
              }),
          background: "var(--pod-panel, #f3f0eb)",
          borderRadius: "var(--pod-radius, 8px)",
          border: surface === "panel"
            ? "var(--panel-border, 3px solid #c9c5c5)"
            : "var(--pod-border, 1px solid #e5e2dd)",
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
          background:
            surface === "card"
              ? "var(--surface)"
              : "var(--pod-panel, #f3f0eb)",
          borderRadius: "var(--pod-radius, 8px)",
          border: surface === "panel"
            ? "var(--panel-border, 3px solid #c9c5c5)"
            : "var(--pod-border, 1px solid #e5e2dd)",
          boxShadow:
            surface === "card"
              ? "var(--card-shadow-ambient)"
              : "0 10px 30px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10)",
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

const FloatingPanel = forwardRef<FloatingPanelHandle, FloatingPanelProps>(
  FloatingPanelInner,
);
FloatingPanel.displayName = "FloatingPanel";
export default FloatingPanel;
