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
import type { DockSlotKey, PanelId, Side } from "@/hooks/useViewPrefs";
import {
  setDockDragTarget,
  findDockTargetByPanelProximity,
  type DockDragTarget,
} from "@/components/editor-layout/dock-drag";
import {
  isOverStackIcon,
  isHeaderOverStackIcon,
  setStackDropTarget,
  getStackDropTarget,
} from "@/lib/stack/stack-drop-target";
import { WINDOW_DRAG_BLOCK_SELECTOR } from "@/lib/drag-blocklist";
import { useIsVisible } from "@/lib/keep-alive/visibility-context";

/**
 * Floating-shell resize clamps — the single source of truth for how small
 * or large a floating pop-out may be dragged. Consumed by EVERY edge/corner
 * resize zone AND by the undock lift-off clamp (which used to duplicate these
 * magic numbers inline). Height has no fixed max — it's clamped against the
 * live viewport (`window.innerHeight - FLOAT_VIEWPORT_MARGIN`) so a window
 * can't grow taller than the screen leaves room for.
 */
export const FLOAT_MIN_W = 240;
export const FLOAT_MAX_W = 900;
export const FLOAT_MIN_H = 200;
/** Bottom inset kept clear of the viewport edge when clamping height. */
export const FLOAT_VIEWPORT_MARGIN = 40;

const clampW = (v: number) => Math.max(FLOAT_MIN_W, Math.min(FLOAT_MAX_W, v));
const clampH = (v: number) =>
  Math.max(
    FLOAT_MIN_H,
    Math.min(
      typeof window !== "undefined" ? window.innerHeight - FLOAT_VIEWPORT_MARGIN : Infinity,
      v,
    ),
  );

/** Which edges a resize gesture is dragging. Corners set two flags. Top is
 *  never resizable — the header strip owns it for move/undock. */
type ResizeEdges = { left?: boolean; right?: boolean; bottom?: boolean };

/** Body cursor for a given edge combination. Single-axis edges → ew/ns;
 *  corners → the matching diagonal. */
function resizeCursor(edges: ResizeEdges): string {
  const horizontal = edges.left || edges.right;
  if (edges.bottom && horizontal) {
    // bottom-left = nesw, bottom-right = nwse.
    return edges.left ? "nesw-resize" : "nwse-resize";
  }
  if (edges.bottom) return "ns-resize";
  return "ew-resize"; // left or right
}

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
  /** One-shot programmatic rect update (partial — unset fields keep
   *  their current value). Sets the live floating pos AND persists it
   *  via `onChange`. Called from a layout effect it applies before the
   *  next paint. Used by the collapsed-card lift's expand-to-content
   *  grow (FloatWindow); not a resize gesture — no min/max clamping. */
  setRect: (rect: Partial<{ x: number; y: number; width: number; height: number }>) => void;
}

interface FloatingPanelProps {
  /** Panel id this shell hosts. Required for dock-aware mounts; optional
   *  for non-panel uses (cards, dialogs) that always float. */
  panelId?: PanelId;
  /** Popout key for cards/blocks (`${kind}:${id}`). Identifies a
   *  card/block float so it can redock onto the StackIcon on a drag-over
   *  (the stack-redock affordance below) — non-card floats (dialogs) may
   *  omit it. (Drop-mode is no longer entered from here; that lives on
   *  the card drop button — see `beginCardDropGesture`.) */
  cardKey?: string;
  /** "docked" mounts the panel inside the side gutter's dock slot via
   *  portal; "floating" mounts it at document.body. Defaults to
   *  "floating" so non-panel callers don't need to opt in. */
  mode?: "docked" | "floating";
  /** When mode==='docked', identifies which slot (band) to portal into.
   *  Looks like "left-0" / "right-2" — the `data-dock-slot` key produced
   *  by `bandSlotKey(side, index)`. */
  slotKey?: DockSlotKey | null;
  /** When mode==='docked', whether the docked container should fill the
   *  slot frame (`height: 100%`) rather than sizing to its content. True
   *  for slots given an explicit band height by the parent; false (the
   *  default) leaves the pod content-sized with a min/max clamp. */
  fillSlot?: boolean;
  /** Visual treatment when floating. "panel" (default) is the popup
   *  look — beige pod bg, strong drop shadow. "card" reads as an
   *  ambient card on the canvas — white surface, gentle ambient
   *  shadow. Used by text-content floats (paragraph/heading/selection)
   *  whose chrome should disappear behind the prose. */
  surface?: "panel" | "card";
  /** Kind accent for the popped-card WINDOW selection/hover ring (bug #34).
   *  Stamped as `--link-anchor-color` on the shell root so the `:has()`
   *  window-ring rules in globals.css resolve the kind color. The inner
   *  PanelCard's own `--link-anchor-color` (on its root) doesn't inherit UP
   *  to this host, so card floats pass `theme.accent` here explicitly. */
  accentTint?: string;
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
   *  redock proximity of a dock column — fires only when an auto-dock
   *  target was active at the moment of release (i.e. the user could
   *  already see the dock outline). Receives the side + band insertion
   *  index the parent should redock into (consumer calls
   *  `redockPanel(id, target.side, target.index)`). */
  onMaybeRedock?: (target: { side: Side; index: number }) => void;
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
  fillSlot = false,
  surface = "panel",
  accentTint,
  children,
  initialX,
  initialY,
  initialWidth,
  initialHeight,
  zIndex,
  onChange,
  onUndock,
  onMaybeRedock,
  onFocus,
}: FloatingPanelProps, handleRef: React.ForwardedRef<FloatingPanelHandle>) {
  // Keep-alive invariant: a hidden (display:none) kept-alive pane must render NO
  // floating/docked panels. FloatingPanel is the single portal-escape chokepoint
  // — docked panels portal to a GLOBAL `[data-dock-slot]` (per-pane anchor, but
  // resolved via a document-wide querySelector), so without this gate every warm
  // pane's docked panel collapses onto the active pane's slot and stacks (the
  // multi-outline bug). Returning null when hidden also keeps hidden panes inert
  // (their panel subtrees never mount), extending the same "hidden is frozen"
  // invariant the measurement hooks already enforce. Default `true` (no provider)
  // ⇒ app-level dialogs/floats outside a keep-alive pane render normally.
  const isVisible = useIsVisible();
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
    | {
        mode: "resize";
        // Which edges are live this gesture. Left moves the left side (right
        // edge stays pinned); right/bottom grow from a fixed top-left.
        edges: ResizeEdges;
        startX: number;
        startY: number;
        // Original geometry captured at mousedown. origX/origY are needed for
        // the left edge: clamping the new width re-derives x from the pinned
        // right edge (origX + origW), so hitting min/max freezes the left side.
        origX: number;
        origY: number;
        origW: number;
        origH: number;
      }
    | null
  >(null);
  const latestPosRef = useRef(pos);
  latestPosRef.current = pos;
  // Latest callbacks/mode in a ref so the move/up effect can install
  // listeners once and stay stable across renders. Avoids tearing down
  // and re-binding window listeners on every prop change, and keeps
  // the hooks dep array a fixed length even when optional props
  // (onMaybeRedock) are sometimes omitted.
  const handlersRef = useRef({ onChange, onUndock, onMaybeRedock, mode });
  handlersRef.current = { onChange, onUndock, onMaybeRedock, mode };

  // Sync local pos when the parent's float rect changes (e.g. on
  // undock the parent calls onUndock which writes a new floatPosition;
  // re-rendered props bring the new initial values down to us).
  // Skipping this would leave the floating panel stuck at the docked
  // rect's pre-undock position even though prefs say otherwise.
  const setRectEchoRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  useEffect(() => {
    // Own-write echo filter: an imperative setRect (collapsed-lift grow)
    // persists via onChange and round-trips back as new initial props. By
    // then a live handed-off drag may have moved pos past it - re-syncing
    // to the echo would snap the float back for a frame. Genuine external
    // rect changes (undock, programmatic moves) don't match the echo and
    // sync as before.
    const echo = setRectEchoRef.current;
    if (
      echo &&
      echo.x === initialX &&
      echo.y === initialY &&
      echo.width === initialWidth &&
      echo.height === initialHeight
    ) {
      setRectEchoRef.current = null;
      return;
    }
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
            width: clampW(rawW),
            height: clampH(rawH),
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
        const panelRect = {
          x: nx,
          y: ny,
          width: latestPosRef.current.width,
          height: latestPosRef.current.height,
        };
        const proximity = findDockTargetByPanelProximity(
          panelRect,
          undefined,
          { x: e.clientX, y: e.clientY },
        );
        if (
          proximity &&
          !(
            s.sourceGhost &&
            proximity.side === s.sourceGhost.side &&
            proximity.index === s.sourceGhost.index
          )
        ) {
          // A *different* band insertion point is the candidate — show
          // its set-down frame.
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
        // Edge-aware resize. Start from the gesture's ORIGINAL geometry
        // (captured at mousedown) so each axis is a pure function of the
        // cursor delta — never an accumulation off the live pos.
        const dx = e.clientX - s.startX;
        const dy = e.clientY - s.startY;
        let x = s.origX;
        // y (top) is never resizable — the header owns the top edge for
        // move/undock — so it always stays at the gesture's original top.
        const y = s.origY;
        let width = s.origW;
        let height = s.origH;
        if (s.edges.right) {
          // Right edge follows the cursor; top-left stays fixed.
          width = clampW(s.origW + dx);
        }
        if (s.edges.left) {
          // Left edge follows the cursor while the RIGHT edge stays pinned.
          // Pin the right edge, clamp the width, then re-derive x from it —
          // so hitting FLOAT_MIN_W / FLOAT_MAX_W naturally freezes the left
          // side without any separate x clamp.
          const rightEdge = s.origX + s.origW;
          width = clampW(s.origW - dx);
          x = rightEdge - width;
        }
        if (s.edges.bottom) {
          // Bottom edge follows the cursor; top (y) stays fixed.
          height = clampH(s.origH + dy);
        }
        setPos((p) => ({ ...p, x, y, width, height }));
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
        dropTarget = findDockTargetByPanelProximity(
          {
            x: latestPosRef.current.x,
            y: latestPosRef.current.y,
            width: latestPosRef.current.width,
            height: latestPosRef.current.height,
          },
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
        handlersRef.current.onMaybeRedock({
          side: dropTarget.side,
          index: dropTarget.index,
        });
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
    // Bug #36: `[data-card]` is in WINDOW_DRAG_BLOCK_SELECTOR so a press on a
    // CARD surface inside a float lifts the card (PanelCard's 5px-threshold
    // lift), not the whole window. The window stays draggable from inter-card
    // gaps / background (outside any [data-card]).
    if (target.closest(WINDOW_DRAG_BLOCK_SELECTOR)) {
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
    // Source-ghost rect: the panel's rendered (band) rect captured at
    // mousedown. In the band-stack model there are no split halves, so
    // the lift-off ghost is just the band's own footprint — no companion
    // rect to derive.
    const primaryRect = dockedRect
      ? { left: dockedRect.left, top: dockedRect.top, width: dockedRect.width, height: dockedRect.height }
      : null;
    // `side` is encoded in the band slot key ("left-0" / "right-2") and
    // is what the redock target needs (the precise band index resolves at
    // drop time via the proximity hit-test).
    const sourceSide: Side | null = socketSlot
      ? (socketSlot.startsWith("left") ? "left" : "right")
      : null;
    const sourceGhost: DockDragTarget | null = (sourceSide && primaryRect)
      ? { side: sourceSide, index: 0, rect: primaryRect }
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
      sourceGhost,
      // Capture docked w/h from the same primaryRect the source ghost
      // uses, so undocking from a band gives a floating panel sized to
      // the band's visual frame.
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
        sourceGhost: null,
        dockedWidth: null,
        dockedHeight: null,
      };
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";
    },
    setRect: (rect) => {
      const next = { ...latestPosRef.current, ...rect };
      // Refresh the ref eagerly (it normally syncs on render) so a
      // beginDragAt issued later in the same effect anchors to the
      // updated rect, not the stale pre-setRect one.
      latestPosRef.current = next;
      setRectEchoRef.current = next;
      setPos(next);
      handlersRef.current.onChange(next);
    },
  }), []);

  // Resize-gesture factory. Each edge zone's onMouseDown calls
  // beginResize({...}) with the edges it controls; the handler captures the
  // full original geometry (origX/Y/W/H) — left-edge resize needs origX +
  // origW to keep the right edge pinned — and sets the matching body cursor.
  // stopPropagation keeps the header move/undock gesture from co-firing.
  const beginResize = (edges: ResizeEdges) => (e: React.MouseEvent) => {
    dragStateRef.current = {
      mode: "resize",
      edges,
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
      origW: pos.width,
      origH: pos.height,
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = resizeCursor(edges);
    e.preventDefault();
    e.stopPropagation();
  };

  // Resolve portal target — body for floating, dock-slot anchor for
  // docked. Looked up via useLayoutEffect so the DOM is committed
  // before we try to query for the slot anchor.
  // Floating mode resolves synchronously (lazy initializer): the portal DOM
  // must exist in the FIRST commit so a child layout effect (FloatWindow's
  // collapsed-lift pre-paint grow) can measure it before paint. Only the
  // docked slot-anchor lookup needs the layout effect.
  const [target, setTarget] = useState<HTMLElement | null>(() =>
    typeof document !== "undefined" && mode === "floating" ? document.body : null,
  );
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

  // Hidden kept-alive pane → render nothing (no portal escape, no stacking).
  if (!isVisible) return null;
  if (typeof document === "undefined" || !target) return null;

  // Container style differs by mode. Docked: the pod FILLS its band
  // anchor via flexbox — the anchor is a flex column (set in
  // panel-column's BandFragment) whose own height is flex-determined
  // (content-sized, or the explicit resized px), and the pod is a
  // `flex: 1 1 auto; min-height: 0` child that grows/shrinks to exactly
  // that height. PANEL.list's `flex-1 overflow-y-auto` then scrolls when
  // content overflows. This replaces the old `max-height: 100%` cap,
  // which WebKit/Safari fails to resolve against a flex-shrunk item —
  // the panel grew to full content height and ran off the bottom of the
  // page instead of capping + scrolling (`fillSlot` is now vestigial).
  // Floating: positioned via fixed left/top and explicit w/h.
  const containerStyle: React.CSSProperties =
    mode === "docked"
      ? {
          position: "relative",
          width: "100%",
          flex: "1 1 auto",
          minHeight: 0,
          background: "var(--pod-panel, #f3f0eb)",
          borderRadius: surface === "panel" ? "var(--panel-radius, 14px)" : "var(--pod-radius, 8px)",
          border: surface === "panel"
            ? "var(--panel-border, 3px solid #c9c5c5)"
            : "var(--pod-border, 1px solid #e5e2dd)",
          boxShadow: "var(--card-shadow-ambient)",
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
          borderRadius: surface === "panel" ? "var(--panel-radius, 14px)" : "var(--pod-radius, 8px)",
          border: surface === "panel"
            ? "var(--panel-border, 3px solid #c9c5c5)"
            : "var(--pod-border, 1px solid #e5e2dd)",
          boxShadow:
            surface === "card"
              ? "var(--card-shadow-ambient)"
              : "var(--shadow-float)",
        };

  return createPortal(
    <div
      ref={rootRef}
      data-floating-panel="true"
      data-panel-shell-mode={mode}
      data-panel-shell-id={panelId}
      className="flex flex-col overflow-hidden"
      style={
        accentTint
          ? ({ ...containerStyle, "--link-anchor-color": accentTint } as React.CSSProperties)
          : containerStyle
      }
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
        <>
          {/* Edge hit-zones — thin (6px) and fully transparent (no styling).
              L/R span full height, B spans full width. Top is intentionally
              omitted: the header strip owns it for move/undock. */}
          <div
            data-resize-edge="left"
            onMouseDown={beginResize({ left: true })}
            className="absolute top-0 left-0 h-full w-1.5 cursor-ew-resize"
            aria-label="Resize left edge"
          />
          <div
            data-resize-edge="right"
            onMouseDown={beginResize({ right: true })}
            className="absolute top-0 right-0 h-full w-1.5 cursor-ew-resize"
            aria-label="Resize right edge"
          />
          <div
            data-resize-edge="bottom"
            onMouseDown={beginResize({ bottom: true })}
            className="absolute bottom-0 left-0 w-full h-1.5 cursor-ns-resize"
            aria-label="Resize bottom edge"
          />
          {/* Invisible 2-axis corner zones (RATIFIED: keep corner ergonomics,
              zero visible styling). Rendered after the edges so they win the
              overlapping corner pixels. */}
          <div
            data-resize-edge="bottom-left"
            onMouseDown={beginResize({ bottom: true, left: true })}
            className="absolute bottom-0 left-0 w-3 h-3 cursor-nesw-resize"
            aria-label="Resize bottom-left corner"
          />
          <div
            data-resize-edge="bottom-right"
            onMouseDown={beginResize({ bottom: true, right: true })}
            className="absolute bottom-0 right-0 w-3 h-3 cursor-nwse-resize"
            aria-label="Resize bottom-right corner"
          />
        </>
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
