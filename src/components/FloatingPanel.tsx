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
  readDockGeometry,
  resolveDockTargetByPanelProximity,
  type DockDragTarget,
  type DockGeometry,
} from "@/components/editor-layout/dock-drag";
// The two pointer invariants EVERY drag gesture in the app honors — imported
// from the engine's SSOT, never re-derived (AGENTS.md "Pane-drag stability";
// task 185). A bespoke gesture buys a different SHAPE, not an exemption.
import { isMissedRelease, isPrimaryDragStart } from "@/lib/pane-resize/pointer-invariants";
import { onLayoutGestureSetChange } from "@/lib/pane-resize";
import {
  isOverStackIcon,
  isHeaderOverStackIcon,
  setStackDropTarget,
  getStackDropTarget,
} from "@/lib/stack/stack-drop-target";
import { canCaptureToStack } from "@/floats/stack-capture";
import { WINDOW_DRAG_BLOCK_SELECTOR, pressFromInteractiveControl } from "@/lib/drag-blocklist";
import { useIsVisible } from "@/lib/keep-alive/visibility-context";
import { getWindowInsetTopPx } from "@/hooks/useWindowChrome";

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

/**
 * Everything a MOVE gesture's per-event arithmetic needs from outside itself,
 * captured in ONE sweep on a gesture edge (task 330).
 *
 * Why once per gesture is safe: the dock stack cannot gain or lose a band
 * mid-drag (the only band-count change a drag causes is its OWN undock, which
 * happens before the capture), and a *continuous* viewport change while the
 * user holds the header is the one case that can move these values — which the
 * LayoutGestureBus publishes, and which re-arms the capture.
 *
 * The residual, stated rather than waved away: the bus's window publisher needs
 * TWO resize events inside 100 ms to declare a gesture, deliberately, so a
 * ONE-SHOT viewport change mid-drag (a keyboard maximize, a DPR change, an
 * external display arriving) publishes nothing and leaves this snapshot stale
 * for the rest of the gesture. That is survivable rather than merely tolerated:
 * both the hover and the release read the SAME snapshot, so they stay stale
 * TOGETHER — the outline and the redock still agree, which is the property that
 * matters. It is also the exposure the StackIcon's cached rect already carries
 * for the same hit-test.
 */
interface MoveGeometry {
  /** Viewport clamp bounds — how far the shell may be pushed off-screen. */
  maxX: number;
  maxY: number;
  /** Top clamp: the OS-reserved strip (WCO title bar), so a float dragged to
   *  the top can't tuck under the window controls. Snapshot because
   *  `getWindowInsetTopPx()` reads `localStorage` (the wco-debug flag) plus
   *  the WCO titlebar rect — twice — which is not a per-mousemove cost. */
  insetTop: number;
  /** Dock columns + bands, or null for a shell that can't redock (cards,
   *  dialogs — anything without `onMaybeRedock`), which never hit-tests. */
  dock: DockGeometry | null;
}

/** THE move gesture's geometry sweep. Gesture edges only — never per move. */
function readMoveGeometry(needsDock: boolean): MoveGeometry {
  return {
    maxX: window.innerWidth - 60,
    maxY: window.innerHeight - 40,
    insetTop: getWindowInsetTopPx(),
    dock: needsDock ? readDockGeometry() : null,
  };
}

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
 *
 * ── THE MOVE GESTURE'S COST CONTRACT (task 330) ────────────────────────────
 *
 * This is a bespoke window-level drag — the pane-resize engine's
 * `getValue/apply/commit(px)` shape genuinely doesn't fit a 2D free move, and
 * the guardrail's allowlist sanctions it on that ground. "Bespoke" buys a
 * different SHAPE, never an exemption from the engine's discipline, and for a
 * year it had been read as the latter: the handler ran per raw `mousemove`
 * (120-240 Hz on a high-Hz mouse) and each invocation did BOTH a React commit
 * (`setPos`) and a forced-layout DOM sweep (the dock proximity test, which grew
 * a rect-read-per-band inside the 80px dock gate). Write → read → write per
 * event: textbook layout thrash, worst exactly where Gabriel felt it worst.
 *
 * Stated precisely, because the first draft of this comment overstated it and
 * an overstated claim is its own defect: the commit re-rendered THIS component
 * and rewrote the shell's inline `left`/`top` (a layout invalidation), but NOT
 * the hosted panel body — `children` is built by the PARENT's render, so it
 * stays referentially identical across this component's own `setState` and
 * React's same-element bailout spares that subtree. The cost was the per-event
 * style write INTERLEAVED with the forced rect reads, which is enough.
 *
 * It is also not the only bespoke drag in `src/` (see
 * `PERMITTED_WINDOW_DRAG_GESTURES`): the siblings that still owe some of the
 * four obligations below are recorded in the queue rather than claimed fixed
 * here.
 *
 * So, per event, this gesture now costs pointer ARITHMETIC and nothing else:
 *
 *   - the shell MOVES by an imperative `translate3d` on its own element,
 *     RAF-coalesced behind an equality bail (composite-only — a `left`/`top`
 *     write would re-layout every frame). React renders on gesture EDGES only;
 *     JSX never sets `transform`. Same law as the drop-mode lift overlay.
 *   - dock geometry (columns, `--pod-gap`, band footprints, stack frames) and
 *     the viewport clamp bounds are SNAPSHOT once per gesture and hit-tested
 *     as pure arithmetic. Same law as the drop-mode controller's mint-free
 *     move path.
 *   - `setPos` + `onChange` commit ONCE, on release.
 *   - `isPrimaryDragStart` gates every mousedown and `isMissedRelease` bails
 *     the move handler, both from the engine's SSOT — without them a release
 *     this handler never observes (chorded second button, release outside the
 *     window) leaves the panel ghost-glued to the cursor and commits on the
 *     user's next click.
 *
 * ── AND THE RESIZE BRANCH'S (task 335) ─────────────────────────────────────
 *
 * Task 330 left the resize branch committing `setPos` per raw `mousemove`, and
 * recorded the reason as SCOPE rather than principle: a resize genuinely has no
 * composite-only representation (the hosted body must reflow to the new
 * width/height), but "must re-layout" is not "must re-layout uncoalesced" — the
 * engine's own `apply()` writes real layout and still coalesces behind an
 * equality bail. That residual is now closed, and the shape it took is the
 * decision worth recording:
 *
 *   - React stays the OWNER of the shell's `width`/`height` (and of the `x`
 *     the left edge re-derives). The coalescing sits IN FRONT of the owner
 *     rather than beside it: the handler advances `liveResizeRef` and
 *     schedules ONE frame; the frame commits through the same `commitPos`
 *     door, behind an equality bail against what React last rendered.
 *   - The rejected alternative was the move path's own shape — imperative
 *     width/height writes with a single commit on release. It is faster and it
 *     FORKS the source of truth in a way the transform does not: JSX never
 *     sets `transform`, so a mid-gesture re-render (a parent prop change)
 *     leaves the move's imperative write standing, while it would rewrite
 *     `width`/`height` from the stale `pos` and snap the float back until the
 *     next mousemove. There is no third representation to defer onto, so the
 *     honest ceiling for a resize is one commit per FRAME, not zero.
 *   - So the per-event cost is arithmetic + a scheduled frame, and the release
 *     still commits + persists exactly once, reading `liveRect()` so a gesture
 *     whose last frame never ran keeps the geometry the user dragged to.
 *
 * Both pointer invariants covered it before and cover it now.
 *
 * Two consequences of the transform, stated because neither is a free win. It
 * makes the shell a containing block for `position: fixed` DESCENDANTS, so an
 * overlay portaled inside the float travels with it for the duration of the
 * drag instead of holding still against the viewport — the better behaviour for
 * the surfaces that can be open while the header is held (they belong to the
 * float), and it lasts only as long as the gesture. And `translate3d` asks for
 * a composited layer, so the first real move frame pays a promotion +
 * rasterization the pre-fix `left`/`top` write did not: a one-off cost at the
 * start of the gesture, traded for every subsequent frame skipping layout, and
 * given back when the transform is dropped on the release commit.
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
        // Can this float be captured onto the Stack? Resolved ONCE here, at
        // gesture start, from the registry (`canCaptureToStack`) — never per
        // mousemove, since a registry read cannot change mid-gesture (the rule
        // `resolveSessionPlacements` follows for a drop session, for the same
        // reason). BOTH the hover affordance and the release read this one
        // value, so the ring can never promise a capture the commit refuses
        // (task 332). False for a non-card shell (no `cardKey`) and for a kind
        // `CARD_REGISTRY` declares non-stackable — report / report-request /
        // example.
        canCapture: boolean;
        // The last cursor position this gesture actually OBSERVED. The dock
        // band index is probed at the cursor's y (user intent), so a release
        // carrying no trustworthy coordinate — the missed-release bail — must
        // re-probe at the last one it SAW rather than fall back to the float's
        // vertical centre: that fallback can resolve a different insertion
        // index than the outline was previewing, which would break the
        // hover-offers-what-the-commit-accepts law on the one path that exists
        // to end the gesture safely (task 330 review).
        lastCursor: { x: number; y: number } | null;
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
        /** As above — the shared end edge reads this whichever kind it ends. */
        lastCursor: { x: number; y: number } | null;
      }
    | null
  >(null);
  // What React currently RENDERS (`left`/`top`/`width`/`height`). Also the
  // baseline the move gesture's imperative translate is measured from.
  const latestPosRef = useRef(pos);
  latestPosRef.current = pos;

  /* ── Move-gesture locals (task 330) — refs, never state ─────────────────
   * A move never commits React state per event. It advances `liveMoveRef`
   * (the gesture's own source of truth for where the float has reached) and
   * schedules ONE imperative translate per frame; the release reads the live
   * rect back out and commits it once. Everything here is drag-local by
   * design — the keystroke-sanctity discipline applied to pointer frames. */
  /** Where the move gesture has reached. Null outside a move gesture. */
  const liveMoveRef = useRef<{ x: number; y: number } | null>(null);
  const moveRafRef = useRef<number | null>(null);
  /** The translate currently written to the element, for the equality bail. */
  const appliedTranslateRef = useRef<{ dx: number; dy: number } | null>(null);
  /** Set when a gesture commits `pos`: the next commit's layout effect drops
   *  the imperative transform in the SAME paint that writes the new left/top,
   *  so the float can't flash between the two representations. */
  const clearTranslateOnCommitRef = useRef(false);
  /**
   * Per-gesture geometry snapshot: the viewport clamp bounds and (for a
   * dock-eligible shell) the dock columns. Captured ONCE, lazily, from the
   * first move that needs it — which for a gesture that began DOCKED lands
   * after the undock reflow, the one legitimate mid-gesture layout change:
   * the undock move returns early, React commits in the microtask that
   * follows, and the next `mousemove` is a separate task, so the snapshot
   * already sees the lifted stack. Invalidated on a LayoutGestureBus
   * membership edge (a window-resize burst) — nulling it just re-arms the
   * lazy capture.
   */
  const moveGeomRef = useRef<MoveGeometry | null>(null);

  /* ── Resize-gesture locals (task 335) ───────────────────────────────────
   * The same discipline, one representation down. A resize has no
   * composite-only form — the hosted body must reflow — so React stays the
   * OWNER of the shell's width/height and the coalescing happens in front of
   * it: the handler advances `liveResizeRef` per event (pure arithmetic off
   * the gesture's captured original geometry) and schedules ONE frame, whose
   * body commits through the same `commitPos` door the move's end edge uses.
   * The release reads the live ref back out, so a gesture whose last frame
   * never ran still persists the geometry the user dragged to. */
  /** Where the resize gesture has reached. Null outside a resize gesture. */
  const liveResizeRef = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const resizeRafRef = useRef<number | null>(null);

  // Latest callbacks/mode in a ref so the move/up effect can install
  // listeners once and stay stable across renders. Avoids tearing down
  // and re-binding window listeners on every prop change, and keeps
  // the hooks dep array a fixed length even when optional props
  // (onMaybeRedock) are sometimes omitted.
  //
  // `cardKey` rides along for the same reason: the window listeners install
  // once and `beginDragAt` (the card-lift hand-off) lives in a
  // `useImperativeHandle` with an empty dep list, so both would otherwise read
  // the MOUNT-time popout key — and the stack-capture capability must be
  // resolved from the same key the release then reports.
  const handlersRef = useRef({ onChange, onUndock, onMaybeRedock, mode, cardKey });
  handlersRef.current = { onChange, onUndock, onMaybeRedock, mode, cardKey };

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
    // Retire any live gesture transform with this commit. The move gesture's
    // translate is measured from the RENDERED pos, so a commit that moves the
    // baseline while a transform is still applied paints at "new base + stale
    // offset" for a frame. No production caller reaches this mid-gesture today
    // (the undock's own commit goes through `commitPos`, which already clears),
    // but "unreachable today" is what a latent trap looks like — and the clear
    // is one ref write on a path that already re-renders.
    clearTranslateOnCommitRef.current = true;
    setPos({ x: initialX, y: initialY, width: initialWidth, height: initialHeight });
  }, [initialX, initialY, initialWidth, initialHeight]);

  // Drop the imperative translate in the SAME commit that writes the new
  // left/top, so the float never paints once at "old pos + transform" and once
  // at "new pos + transform". A layout effect runs after React's DOM mutation
  // and before paint, which is exactly the window this needs; no dep array,
  // because the cost is one ref read per commit.
  useLayoutEffect(() => {
    if (!clearTranslateOnCommitRef.current) return;
    clearTranslateOnCommitRef.current = false;
    appliedTranslateRef.current = null;
    const el = rootRef.current;
    if (el) el.style.transform = "";
  });

  // Window-level move/up listeners. Both modes share these — only the
  // body of the move handler differs based on dragStateRef contents.
  useEffect(() => {
    /** The gesture's live rect: rendered pos, overridden by whichever branch
     *  is live — the move's own x/y, or the resize's whole geometry. THE thing
     *  the release commits, because `latestPosRef` alone is a frame behind by
     *  design in BOTH branches (the move writes a transform; the resize commits
     *  from a scheduled frame). The two are mutually exclusive — one
     *  `dragStateRef` — so the order here is a tie-break that never fires. */
    const liveRect = () => {
      const base = latestPosRef.current;
      const live = liveMoveRef.current;
      if (live) return { ...base, x: live.x, y: live.y };
      const resized = liveResizeRef.current;
      return resized ? { ...resized } : { ...base };
    };

    /** Write the pending translate. ONE per frame, equality-bailed. */
    const applyTranslate = () => {
      moveRafRef.current = null;
      const live = liveMoveRef.current;
      const el = rootRef.current;
      if (!live || !el) return;
      const dx = live.x - latestPosRef.current.x;
      const dy = live.y - latestPosRef.current.y;
      const prev = appliedTranslateRef.current;
      if (prev && prev.dx === dx && prev.dy === dy) return;
      appliedTranslateRef.current = { dx, dy };
      el.style.transform =
        dx === 0 && dy === 0 ? "" : `translate3d(${dx}px, ${dy}px, 0)`;
    };
    const scheduleTranslate = () => {
      if (moveRafRef.current !== null) return; // a frame is already queued
      moveRafRef.current = requestAnimationFrame(applyTranslate);
    };
    const cancelTranslate = () => {
      if (moveRafRef.current !== null) {
        cancelAnimationFrame(moveRafRef.current);
        moveRafRef.current = null;
      }
    };

    /** The gesture's ONE geometry sweep, taken on demand (see the ref's doc). */
    const geometry = (): MoveGeometry => {
      let g = moveGeomRef.current;
      if (!g) {
        g = readMoveGeometry(!!handlersRef.current.onMaybeRedock);
        moveGeomRef.current = g;
      }
      return g;
    };

    /** Commit `pos` from inside the gesture, retiring the transform with it. */
    const commitPos = (rect: { x: number; y: number; width: number; height: number }) => {
      // Keep the ref (the translate baseline) in step immediately: it normally
      // syncs on render, and a move event can arrive before that.
      latestPosRef.current = rect;
      clearTranslateOnCommitRef.current = true;
      setPos(rect);
    };

    /** Commit the pending resize geometry through that same door. ONE per
     *  frame, equality-bailed against what React last rendered — a resize held
     *  still (the user pausing at a clamp bound, a mouse re-reporting the same
     *  coordinate, a second axis moving while this one is frozen) re-renders
     *  nothing and reflows the hosted body not at all. */
    const applyResize = () => {
      resizeRafRef.current = null;
      const live = liveResizeRef.current;
      if (!live) return;
      const cur = latestPosRef.current;
      if (
        cur.x === live.x &&
        cur.y === live.y &&
        cur.width === live.width &&
        cur.height === live.height
      ) {
        return;
      }
      commitPos({ ...live });
    };
    const scheduleResize = () => {
      if (resizeRafRef.current !== null) return; // a frame is already queued
      resizeRafRef.current = requestAnimationFrame(applyResize);
    };
    const cancelResize = () => {
      if (resizeRafRef.current !== null) {
        cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
    };

    const onMove = (e: MouseEvent) => {
      const s = dragStateRef.current;
      if (!s) return;
      // Missed-release failsafe (the engine's own predicate, task 185): the
      // PRIMARY button is up, so the release happened somewhere we never
      // observed — over an iframe, outside the window, eaten by a context
      // menu, or the drag button let go while a second one is chorded (which
      // fires only a move with an updated mask, never a mouseup). End the
      // gesture HERE and do NOT incorporate this event's coordinate: that
      // would be ghost movement the user never made. Without this the panel
      // stays glued to the cursor and commits on the next click.
      if (isMissedRelease(e)) {
        endGesture(null);
        return;
      }
      e.preventDefault();
      // Remember what we SAW, so an end edge with no coordinate of its own can
      // probe where the outline last did instead of guessing.
      s.lastCursor = { x: e.clientX, y: e.clientY };
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
          // one frame before the parent re-render syncs it back. This is a
          // gesture EDGE (once per drag, and the drag's one legitimate layout
          // change), so a React commit here is exactly right — it also
          // re-bases the translate on the freshly-floating rect.
          liveMoveRef.current = { x: initialFloatRect.x, y: initialFloatRect.y };
          commitPos(initialFloatRect);
          return;
        }
        // Per-move arithmetic over the gesture's snapshot — no DOM reads. The
        // clamp bounds and the OS top inset were captured at gesture begin
        // (`getWindowInsetTopPx` reads localStorage + the WCO titlebar rect,
        // which is not a 240 Hz cost), and the shell moves by transform rather
        // than by a React commit.
        const geom = geometry();
        const nx = Math.max(
          -latestPosRef.current.width + 60,
          Math.min(geom.maxX, s.origX + dx),
        );
        // Clamp the top to the OS-reserved strip (WCO title bar) instead of 0,
        // so a panel dragged to the top can't tuck under the window controls.
        const ny = Math.max(geom.insetTop, Math.min(geom.maxY, s.origY + dy));
        liveMoveRef.current = { x: nx, y: ny };
        scheduleTranslate();
        // Stack-drop affordance: when a card/block float drags over the
        // StackIcon, light up its illuminated ring. The icon component
        // caches its rect into a module-level signal so this stays a
        // pure-data lookup. Suppresses the dock outline so the two
        // affordances don't fight.
        // Gated on the CAPABILITY resolved at mousedown, not on `cardKey`
        // alone: a float whose kind the Stack cannot carry lights no ring and
        // falls through to the normal dock/redock handling below.
        if (s.canCapture) {
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
        // Pure arithmetic over the snapshot: no querySelectorAll, no rect
        // reads, and no growth inside the 80px dock gate (the per-band sweep
        // that made the near-dock cliff is now part of the one capture).
        const proximity = geom.dock
          ? resolveDockTargetByPanelProximity(geom.dock, panelRect, undefined, {
              x: e.clientX,
              y: e.clientY,
            })
          : null;
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
        // cursor delta — never an accumulation off the live pos. Per event
        // this is arithmetic and a scheduled frame; the commit itself is the
        // frame's (task 335).
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
        liveResizeRef.current = { x, y, width, height };
        scheduleResize();
      }
    };
    /**
     * THE end edge — one path for every ending, so no variant can skip the
     * chrome teardown or the single persistence commit (the engine's
     * finally-style discipline).
     *
     * `cursor` is the release coordinate, or NULL when the release was never
     * observed (the missed-release bail). A null cursor is not "the cursor is
     * at 0,0": the cursor-based hit-tests are skipped and the rect-based ones
     * still run, so the two forgiving conditions the user could SEE (the
     * header over the StackIcon, the float's corner near a dock) still decide,
     * while a coordinate we don't trust decides nothing. Like the engine's
     * failsafe this COMMITS the last live value rather than cancelling — the
     * user did move the float there.
     */
    const endGesture = (cursor: { x: number; y: number } | null) => {
      const s = dragStateRef.current;
      if (!s) return;
      // Flush nothing and cancel the pending frames: the commit below writes
      // the final geometry, so an outstanding translate would only paint a
      // doubled offset for a frame and an outstanding resize frame would
      // re-commit a value this one already supersedes. Cancelling does NOT
      // discard the value — `liveRect()` reads it straight out of the live
      // refs on the next line, which is what makes a gesture whose last frame
      // never ran still persist where the user dragged to.
      cancelTranslate();
      cancelResize();
      const finalRect = liveRect();
      const wasFloatingMove =
        s.mode === "move" && !s.pendingUndock && handlersRef.current.mode === "floating";
      // Stack drop: cursor OR the dragged float's header is over the
      // StackIcon at release. Emit a doc-level event so EditorPane
      // (which holds the per-doc hooks) can perform the snapshot. Skip
      // the rest of the redock flow on stack drop.
      // Read through the ref: this effect installs its listeners once with an
      // empty dep list, so the render-scope `cardKey` here would be the
      // mount-time value — and it must be the same key the capability below
      // was resolved from, or the two could disagree about what is travelling.
      const dropKey = handlersRef.current.cardKey;
      const stackDropHit =
        wasFloatingMove && dropKey != null &&
        // The SAME resolved capability the hover read (task 332) — the
        // affordance and the commit answer from one value, so a release that
        // was never offered a ring can't dispatch a capture.
        s.mode === "move" && s.canCapture &&
        (
          (cursor != null && isOverStackIcon(cursor.x, cursor.y)) ||
          isHeaderOverStackIcon({
            x: finalRect.x,
            y: finalRect.y,
            width: finalRect.width,
          })
        );
      if (stackDropHit) {
        setStackDropTarget(false);
        setDockDragTarget(null);
        dragStateRef.current = null;
        liveMoveRef.current = null;
        liveResizeRef.current = null;
        moveGeomRef.current = null;
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        // Persist where the user actually left the float. This branch returns
        // before the shared commit below, which was harmless only while a
        // capture ALWAYS closed the float: since task 332 the host closes it
        // only on a snapshot that landed, so a refused capture (a deleted
        // source, an unresolvable id) would otherwise leave the float parked
        // over the StackIcon at a rect nothing had stored. On a capture that
        // does land this is a no-op in effect — `closeCardPopout` deletes the
        // key's saved rect immediately afterwards, through a functional
        // updater on the same store, so the write cannot outlive the delete.
        commitPos(finalRect);
        handlersRef.current.onChange(finalRect);
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("virgil-stack-drop", {
              detail: {
                cardKey: dropKey,
                clientX: cursor?.x ?? finalRect.x,
                clientY: cursor?.y ?? finalRect.y,
              },
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
      //
      // Answered from the SAME snapshot the hover asked (never a second, live
      // sweep): what the outline OFFERED and what the release ACCEPTS must
      // come from one table, so they cannot disagree — and a gesture that
      // never moved has no snapshot to ask, which is right, since a release
      // without a move can't have been offered anything either.
      let dropTarget: DockDragTarget | null = null;
      if (wasFloatingMove) {
        const dock = geometry().dock;
        // Probe at the release coordinate, or — when the release carried none —
        // at the last one the gesture OBSERVED, which is the coordinate the
        // outline currently on screen was resolved from. Never the panel-centre
        // fallback: that can answer a different band than the one offered.
        const probe = cursor ?? s.lastCursor ?? undefined;
        if (dock) {
          dropTarget = resolveDockTargetByPanelProximity(
            dock,
            finalRect,
            undefined,
            probe,
          );
        }
      }
      if (s.mode === "move") {
        setDockDragTarget(null);
      }
      dragStateRef.current = null;
      liveMoveRef.current = null;
      liveResizeRef.current = null;
      moveGeomRef.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      // ONE React commit and ONE persistence write per gesture, on the edge —
      // and for a resize this is the LAST of at most one-per-frame commits,
      // not the only one: React owns width/height, so there is no imperative
      // channel to defer them onto (see the header's cost contract).
      commitPos(finalRect);
      handlersRef.current.onChange(finalRect);
      if (wasFloatingMove && handlersRef.current.onMaybeRedock && dropTarget) {
        handlersRef.current.onMaybeRedock({
          side: dropTarget.side,
          index: dropTarget.index,
        });
      }
    };
    const onUp = (e: MouseEvent) => {
      endGesture({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    // A window-resize burst is the one real invalidation of the gesture
    // snapshot (an external display, Stage Manager, a live OS window resize
    // that overlaps the drag). The bus publishes membership changes, never
    // frames — ≤2 fires per gesture — so it needs no kind filter: dropping the
    // snapshot is idempotent and safe whatever the edge was. Read through the
    // SET channel per the bus's own rule.
    //
    // Nulling is safe ONLY because both readers go through `geometry()`, which
    // re-captures on demand. That is load-bearing rather than incidental: while
    // the release read the raw ref, a bus edge landing between the last
    // mousemove and the mouseup — a `endWindowGesture` trailing-idle timer
    // firing during the pause people take to confirm a drop target — left the
    // release with no geometry, so a lit dock outline redocked NOWHERE and
    // cleared itself with no feedback. The false-affordance shape this file's
    // own comments invoke, reintroduced by the invalidation meant to prevent
    // staleness (found by the adversarial pass on this task).
    const unsubscribeGestureBus = onLayoutGestureSetChange(() => {
      moveGeomRef.current = null;
    });
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      unsubscribeGestureBus();
      cancelTranslate();
      cancelResize();
    };
  }, []);

  // Header mousedown — same handler in both modes. While docked, also
  // light up the dock socket outline.
  const onHeaderMouseDown = (e: React.MouseEvent) => {
    // Primary button only (the engine's own gate): a right-press must not begin
    // a gesture whose release the context menu then eats.
    if (!isPrimaryDragStart(e)) return;
    const target = e.target as HTMLElement;
    // Bug #36: `[data-card]` is in WINDOW_DRAG_BLOCK_SELECTOR so a press on a
    // CARD surface inside a float lifts the card (PanelCard's 5px-threshold
    // lift), not the whole window. The window stays draggable from inter-card
    // gaps / background (outside any [data-card]).
    // Scoped to strict descendants of the float root through the shared
    // door (task 423) — the float is body-portaled, so today nothing above
    // or at the root can match, but the rule is stated once for all four
    // gestures rather than re-derived per site.
    if (
      pressFromInteractiveControl(
        target,
        rootRef.current ?? (e.currentTarget as Element),
        WINDOW_DRAG_BLOCK_SELECTOR,
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
      canCapture: cardKey != null && canCaptureToStack(cardKey),
      lastCursor: { x: e.clientX, y: e.clientY },
    };
    // Arm the move gesture's locals: no live position yet (the shell is where
    // React rendered it) and no geometry snapshot — the first move captures
    // one, which for this docked start lands after the undock reflow.
    liveMoveRef.current = null;
    liveResizeRef.current = null;
    moveGeomRef.current = null;
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
        canCapture: (() => {
          const key = handlersRef.current.cardKey;
          return key != null && canCaptureToStack(key);
        })(),
        lastCursor: { x: clientX, y: clientY },
      };
      liveMoveRef.current = null;
      liveResizeRef.current = null;
      moveGeomRef.current = null;
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
      // Same reason as the prop-sync effect above: this moves the transform's
      // baseline, so any live gesture translate retires with it.
      clearTranslateOnCommitRef.current = true;
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
    if (!isPrimaryDragStart(e)) return;
    dragStateRef.current = {
      mode: "resize",
      edges,
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
      origW: pos.width,
      origH: pos.height,
      lastCursor: { x: e.clientX, y: e.clientY },
    };
    // Arm the resize gesture's locals: nothing live yet, and no frame queued.
    liveResizeRef.current = null;
    liveMoveRef.current = null;
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
              omitted: the header strip owns it for move/undock.

              `aria-hidden`, and the edge's identity lives on `data-resize-edge`
              (task 189). These carried `aria-label="Resize left edge"` etc. on
              bare divs, whose implicit role is `generic` — which ARIA
              PROHIBITS from being named, so no AT ever announced them: five
              inert attributes reading as an a11y contract that did not exist.
              Like the engine's gutters they are pointer-only (no tabIndex, no
              key handler), so the honest statement is "decorative", not a name
              promising an interaction. See STYLE_GUIDE "Resize gutters". */}
          <div
            data-resize-edge="left"
            onMouseDown={beginResize({ left: true })}
            className="absolute top-0 left-0 h-full w-1.5 cursor-ew-resize"
            aria-hidden
          />
          <div
            data-resize-edge="right"
            onMouseDown={beginResize({ right: true })}
            className="absolute top-0 right-0 h-full w-1.5 cursor-ew-resize"
            aria-hidden
          />
          <div
            data-resize-edge="bottom"
            onMouseDown={beginResize({ bottom: true })}
            className="absolute bottom-0 left-0 w-full h-1.5 cursor-ns-resize"
            aria-hidden
          />
          {/* Invisible 2-axis corner zones (RATIFIED: keep corner ergonomics,
              zero visible styling). Rendered after the edges so they win the
              overlapping corner pixels. */}
          <div
            data-resize-edge="bottom-left"
            onMouseDown={beginResize({ bottom: true, left: true })}
            className="absolute bottom-0 left-0 w-3 h-3 cursor-nesw-resize"
            aria-hidden
          />
          <div
            data-resize-edge="bottom-right"
            onMouseDown={beginResize({ bottom: true, right: true })}
            className="absolute bottom-0 right-0 w-3 h-3 cursor-nwse-resize"
            aria-hidden
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
