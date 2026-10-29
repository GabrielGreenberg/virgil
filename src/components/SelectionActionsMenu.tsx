"use client";

/**
 * The contextual margin trigger for the action menu. Renders a small
 * yellow-lightning-bolt button anchored in the far-right margin at the
 * head line of the current selection (or cursor, when no selection).
 * Clicking it mounts {@link ActionsMenuPanel} at the button's position.
 *
 * Single placement rule: the bolt is POD-anchored via
 * {@link computeBoltLeftFromPod} (the right-margin geometry SSOT), seated in
 * its INBOARD band — between the text and the marker grid, so the marginalia
 * markers sit to its RIGHT. Anchoring to `cache.podRight` (not `editorRight`)
 * makes it margin-invariant (dragging `--editor-pr` wide moves text, markers,
 * AND bolt together, so it never drifts onto the pod-anchored markers) and
 * clipped-edge-correct in code view (the pod is inside the code-split clip, so
 * `podRight` is the visible edge — the bolt no longer pops up over the code
 * pane). A cramped compressed-split gutter falls back to a scrollbar-tuck; both
 * regimes live in the pure SSOT fn. RAF-batched updates on PM `selectionUpdate`
 * / `update` / `focus` / `blur` plus window `resize`.
 *
 * The resting bolt RIDES ITS LINE (task 1355 — Scroll-anchor stability law,
 * shape (a)): it portals into the column-level `[data-grab-handle-portal]` host
 * inside the row scroll container — the same host as its left-side twin
 * {@link TextObjectGrabHandle} — at `position:absolute`, in portal coords
 * (`toPortalCoords`). A scroll moves it by LAYOUT, so it has NO scroll
 * listener: it never hides, never lags, and scrolls out of view (and under the
 * sticky pod caps) with its line. It used to be a `position:fixed` body portal
 * that UNMOUNTED for every scroll and re-seated 120 ms after the last event —
 * the "vanishes and flickers back while scrolling" report.
 *
 * Counterpart triggers:
 *  - {@link TextObjectGrabHandle} (left side) for the drag-to-lift gesture.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveAnchor } from "./menu/live-anchor";
import { isPrimaryDragStart, watchHeldPress } from "@/lib/pane-resize/pointer-invariants";
import type { Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { resolveAnchorableNode, resolveAnchorUuidAndKind } from "@/lib/anchor-uuid";
import type { TextObjectKind } from "@/text-objects/types";
import { IconZap } from "./editor-layout/panel-icons";
import { ActionsMenuPanel } from "./ActionsMenuPanel";
import { useMenuTrigger } from "./menu/menu-trigger";
import { useHint } from "./Hint";
import {
  coordsAtPosCached,
  type EditorViewportFrame,
} from "@/lib/editor-geometry";
import { useViewportFrame } from "@/lib/editor-geometry/use-viewport-frame";
import { useIsVisible, useIsVisibleRef } from "@/lib/keep-alive/visibility-context";
import { PaneOverlayPortal } from "@/lib/keep-alive/PaneOverlayPortal";
import { IN_SCROLL_MARGIN_TRIGGER_Z } from "@/floats/float-policy";
import {
  recordScrollPlacement,
  SCROLL_PORTAL_SELECTION_BOLT,
} from "@/lib/scroll-reposition-probe";
import {
  computeBoltLeftFromPod,
  MARGINALIA_BOLT_SIZE,
} from "@/lib/marginalia";
import {
  isLayoutGestureActive,
  onLayoutGestureChange,
} from "@/lib/pane-resize";

const VIEWPORT_MARGIN = 8;
// Action-button (collapsed state) dimensions — sized to match one menu row's
// vertical rhythm so the button feels like a single seed of the menu it opens.
// The pixel size lives in the right-margin SSOT (the bolt's lane offset is
// derived from it), re-exported here under the local name.
const BUTTON_SIZE = MARGINALIA_BOLT_SIZE;

const INVISIBLE_PLACEMENT: Placement = {
  visible: false,
  left: 0,
  top: 0,
  anchorNodePos: null,
  range: null,
  mode: "selection",
  host: null,
};

interface Placement {
  visible: boolean;
  left: number;
  top: number;
  /**
   * Position of the anchorable container at the head, used as the close-on-
   * paragraph-change identity. Stable across UUID hydration (setNodeMarkup
   * doesn't shift positions), so opening the menu — which may hydrate a UUID
   * — does not collapse the menu it just opened.
   */
  anchorNodePos: number | null;
  range: { from: number; to: number } | null;
  mode: "selection" | "cursor";
  /** The in-scroll portal host the coords are relative to — resolved from the
   *  SAME frame snapshot `toPortalCoords` used, so coords and container can
   *  never disagree (the grab handle's race-free rule). Null before the column
   *  resolves; both then degrade together to body + viewport coords. */
  host: HTMLElement | null;
}

/** The column's `[data-grab-handle-portal]` child. A walk over the column's
 *  DIRECT children (a handful), never a `querySelector` — that would descend
 *  the whole editor subtree, which precedes the host in document order. */
function portalHostOf(column: HTMLElement | null): HTMLElement | null {
  if (!column) return null;
  for (const child of Array.from(column.children)) {
    if (child instanceof HTMLElement && child.hasAttribute("data-grab-handle-portal")) {
      return child;
    }
  }
  return null;
}

/**
 * Single placement rule: far-right margin at the line containing the
 * selection head. Stable under tiny selection changes because the X
 * comes from the editor box (not per-line geometry) and the Y is the
 * head line's top.
 *
 * Coordinates are PORTAL-relative (the `[data-grab-handle-portal]` host, see
 * the render below) — scroll-invariant, so a scroll needs no recompute. There
 * is no scroll-band gate and no top/bottom clamp: an off-band line's bolt is
 * simply clipped by the row scroll container, like the line itself.
 * `visible` therefore means "there is a head line to sit beside", not "it is
 * on screen" — the open menu's off-screen close is asked of the LIVE rect
 * (`trackBolt`), not of this snapshot.
 *
 * Per-keystroke cost: one `coordsAtPos(head)` + one column rect read
 * (`toPortalCoords`, layout already clean after coordsAtPos) + arithmetic on
 * cached editor metrics — the grab handle's exact budget.
 */
function computePlacement(editor: Editor, cache: EditorViewportFrame): Placement {
  const sel = editor.state.selection;
  if (sel instanceof NodeSelection) return INVISIBLE_PLACEMENT;
  // Cursor-only mode is gated on focus so the button doesn't materialize
  // at the document's default cursor position on first paint, before the
  // user has ever clicked into the prose.
  if (sel.empty && !editor.isFocused) return INVISIBLE_PLACEMENT;
  // Keep-alive: a hidden (display:none) editor has offsetHeight 0 and
  // coordsAtPos → {0,0,0,0}; bail BEFORE coordsAtPos so the margin bolt never
  // jitters and the hidden editor does zero placement measurement.
  if (!cache.editorEl || cache.editorEl.offsetHeight === 0) return INVISIBLE_PLACEMENT;

  const { from, to, head } = sel;
  const anchor = resolveAnchorableNode(editor.view, head);
  const anchorNodePos = anchor?.nodePos ?? null;

  // Through the geometry service's per-frame memo (C7): the pill and any
  // other same-frame placement pass reading this pos share ONE forced-layout
  // read. Null = the old catch path.
  const headCoords = coordsAtPosCached(editor, head);
  if (!headCoords) return INVISIBLE_PLACEMENT;

  const vw = window.innerWidth;
  // Bolt x from the right-margin geometry SSOT — POD-anchored, seated in its
  // INBOARD band between the text and the marker grid (markers to its RIGHT).
  // Anchoring to `cache.podRight` (not the old text-edge `editorRight`) makes
  // it margin-invariant AND clipped-edge-correct in code view; the SSOT fn also
  // handles the cramped compressed-split gutter. Both cache reads are already
  // measured — no new subscriber, keystroke sanctity preserved.
  let left = computeBoltLeftFromPod({
    podRight: cache.podRight,
    editorRight: cache.editorRight,
  });
  if (left + BUTTON_SIZE > vw - VIEWPORT_MARGIN) {
    left = Math.max(VIEWPORT_MARGIN, vw - BUTTON_SIZE - VIEWPORT_MARGIN);
  }
  // Viewport → portal coords. Only the x clamp above is viewport-relative (a
  // horizontal fact no vertical scroll changes); y is the line's own top.
  const portal = cache.toPortalCoords(left, headCoords.top);

  return {
    visible: true,
    left: portal.x,
    top: portal.y,
    anchorNodePos,
    range: { from, to },
    mode: sel.empty ? "cursor" : "selection",
    host: portalHostOf(cache.paperEl),
  };
}

/** The bolt's square at a placement, in VIEWPORT coords — the rect the open
 *  menu (a fixed `<Menu>` portal) anchors to. The placement is portal-relative,
 *  so it is shifted by the portal host's LIVE origin (one rect read). */
function boltViewportRect(p: Placement, cache: EditorViewportFrame) {
  const origin = cache.toPortalCoords(0, 0);
  const left = p.left - origin.x;
  const top = p.top - origin.y;
  return {
    left,
    top,
    right: left + BUTTON_SIZE,
    bottom: top + BUTTON_SIZE,
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
  };
}

type BoltRect = ReturnType<typeof boltViewportRect>;

function placementsEqual(a: Placement, b: Placement): boolean {
  return (
    a.visible === b.visible &&
    a.left === b.left &&
    a.top === b.top &&
    a.anchorNodePos === b.anchorNodePos &&
    a.mode === b.mode &&
    a.host === b.host &&
    (a.range?.from ?? null) === (b.range?.from ?? null) &&
    (a.range?.to ?? null) === (b.range?.to ?? null)
  );
}

export function SelectionActionsMenu({
  editor,
  documentClass = null,
}: {
  /** The live editor as a TRACKED value (task 736 — the grab handle's
   *  sibling). A ref the parent fills in an effect is still null when this
   *  child renders, so the viewport frame, the PM subscriptions and the
   *  scroll-parent listener all bound to nothing; a RAF wait-loop rescued the
   *  subscriptions but not the scroll listener, and nothing re-bound on an
   *  editor swap. As a prop, arrival/swap is one render per editor lifetime and
   *  every binding below re-keys on it — nothing per-transaction flows here. */
  editor: Editor | null;
  /** The document's `\documentclass`, threaded to the lightning grid's ¶
   *  block-type dropdown so it greys the heading levels the class cannot
   *  carry (task 752). */
  documentClass?: string | null;
}) {
  const [placement, setPlacement] = useState<Placement>(INVISIBLE_PLACEMENT);
  const [menuTarget, setMenuTarget] = useState<{
    uuid: string;
    // The REAL anchorable node kind at the caret/head (heading, listItem, …,
    // else "paragraph"). Threaded into ActionsMenuPanel so the cursor-mode
    // dispatch ref carries the real kind instead of a flattened "paragraph"
    // (the BUG2 fix). Both the dispatch ref and the grey-out probe derive from
    // this ONE field, so they cannot diverge on identity.
    kind: TextObjectKind;
    range: { from: number; to: number };
    mode: "selection" | "cursor";
    /** The bolt's viewport rect at the moment the menu OPENED — the menu's
     *  static fallback anchor (the live one is `trackBolt`). Captured in the
     *  opening handler, so render never reads layout for it. */
    triggerRect: BoltRect;
  } | null>(null);
  // Transient drag jitter-suppression for the RESTING bolt ONLY — a channel of
  // its own, kept OUT of `placement`. Historically `suppress()` wrote
  // `placement.visible = false`, which overloaded that flag: because the open
  // menu's lifecycle + render also keyed off `placement.visible`, a bolt-only
  // jitter guard silently unmounted the OPEN menu (task 154). `suppressed`
  // hides the bolt during a press-drag or a layout gesture without touching
  // it. A SCROLL no longer suppresses at all (task 1355 — the bolt rides its
  // line by layout). Flips on editor-mousedown / gesture start → true and on
  // the press's end edge (`watchHeldPress`, task 993) / gesture end → false;
  // edge-only, never on the editor transaction path, so it adds no
  // per-keystroke work (keystroke sanctity).
  const [suppressed, setSuppressed] = useState(false);
  // The bolt is a menu TRIGGER that cannot be an `AnchoredMenu` button (an
  // in-scroll pane-overlay portal), so it takes the shared trigger
  // contract piecewise (task 992): its element rides `ActionsMenuPanel`'s
  // `excludeRefs` so a re-click is a toggle rather than a close-then-remount,
  // and it announces `aria-haspopup`/`aria-expanded`.
  const {
    triggerEl: boltEl,
    triggerRef: boltRef,
    triggerProps: boltTriggerProps,
  } = useMenuTrigger({ open: menuTarget !== null });
  // The placement scheduler, published for the out-of-band pokes below. It is
  // a REF, not an effect dep, deliberately: `cacheVersion` in the dep array
  // tore down and re-registered this entire effect (window capture listeners,
  // scroll, resize, 4× `editor.on`) on every viewport-cache bump — the
  // amplifier that turned a window-resize storm into a re-subscription storm
  // (task 317). Same shape as `TextObjectGrabHandle`'s `scheduleRefRef`.
  const updateRef = useRef<() => void>(() => {});

  // Shared viewport frame (geometry service, C7). editorRight, scrollTop,
  // scrollBottom are read here per placement compute instead of being
  // re-measured per RAF. The frame refreshes only on resize /
  // RO-detected layout changes — ONE engine per pane now, not a private
  // observer per consumer. `version` participates in the poke effect below
  // so the compute re-runs when the frame changes (e.g., sidebar toggle).
  const isVisible = useIsVisible();
  const visibleRef = useIsVisibleRef();
  const { frameRef: cacheRef, version: cacheVersion } = useViewportFrame(
    editor,
  );

  // Single RAF-coalesced compute on every event that could move or hide
  // the button. The button is small and tracks the cursor's head line
  // smoothly.
  //
  // Suppression: while the user is mid-drag (left mousedown started inside
  // the editor prose) or a layout gesture is live, the placement math is gated
  // off entirely. PM `selectionUpdate` etc. still fire, but they hit
  // `isSuppressed()` and return before scheduling RAF — no `coordsAtPos`,
  // no setState. This keeps the button from flickering frame-by-frame
  // while the head line is in motion.
  //
  // Equality: `setPlacement` short-circuits via `placementsEqual` when
  // the new placement is structurally identical to the old. Typing
  // within a single visual line keeps headCoords.top constant, so most
  // keystrokes hit the bail-out and don't trigger a React re-render of
  // the portaled button.
  useEffect(() => {
    let rafId = 0;
    let mouseDownInEditor = false;
    // A continuous layout gesture (pane-divider drag, OS window resize, content
    // drag) is the second suppression source, alongside editor-mousedown. A
    // scroll is NOT one: the bolt rides its line by layout (task 1355). A
    // gesture REFLOWS the column, though — the pod-anchored x and the line's y
    // both go stale — so the bolt SUPPRESSES: hidden for the gesture,
    // recomputed once on the end edge (task 317). That also covers a content
    // drag's auto-scroll, which the old scroll-idle hide used to.
    let gestureActive = isLayoutGestureActive();
    const isSuppressed = () => mouseDownInEditor || gestureActive;
    const run = () => {
      const next = editor && !editor.isDestroyed
        ? computePlacement(editor, cacheRef.current)
        : INVISIBLE_PLACEMENT;
      // Scroll-anchor stability probe (task 042): one record per coalesced
      // frame — a stable RAF-gated portal reports ≤1 distinct top/frame.
      recordScrollPlacement(SCROLL_PORTAL_SELECTION_BOLT, next.top);
      setPlacement((prev) => (placementsEqual(prev, next) ? prev : next));
    };
    const update = () => {
      if (isSuppressed()) return;
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        run();
      });
    };
    updateRef.current = update;
    // Enter suppression: cancel any pending compute and hide the RESTING bolt
    // via its own `suppressed` channel. Crucially it NO LONGER zeroes
    // `placement` — so an open menu (gated on the logical `placement.visible`,
    // not on `suppressed`) survives the scroll/drag it used to be collapsed by.
    const suppress = () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      setSuppressed(true);
    };
    // Leave suppression once BOTH sources are clear (no editor mousedown, no
    // live layout gesture): drop the bolt-hide flag and recompute the resting
    // placement at the settled position.
    const settle = () => {
      if (isSuppressed()) return;
      setSuppressed(false);
      update();
    };
    // The press latch's END edge (task 993): not just the window `mouseup` —
    // `watchHeldPress` also ends it on a missed-release move, a context menu
    // and a window blur, so a release the page never sees can't keep the bolt
    // hidden until the user's next click.
    let disarmPress: (() => void) | null = null;
    const onPressEnd = () => {
      disarmPress = null;
      mouseDownInEditor = false;
      settle();
    };
    const onMouseDown = (e: MouseEvent) => {
      // The engine's start gate (SSOT, never re-derived).
      if (!isPrimaryDragStart(e)) return;
      if (!editor) return;
      const t = e.target as Node | null;
      if (t && editor.view.dom.contains(t)) {
        mouseDownInEditor = true;
        disarmPress?.();
        disarmPress = watchHeldPress(onPressEnd);
        suppress();
      }
    };
    if (editor) {
      editor.on("selectionUpdate", update);
      editor.on("update", update);
      editor.on("focus", update);
      editor.on("blur", update);
    }
    run();
    // Mousedown at window scope: the drag may originate inside the editor
    // and complete outside, so its end edge (`watchHeldPress`) is window-scope
    // too. Captured phase to beat React's bubbling cleanup.
    window.addEventListener("mousedown", onMouseDown, true);
    // Resize is a genuinely global event. It stays a raw listener because a
    // ONE-SHOT resize (maximize, zoom, DPR change) must still reposition
    // immediately — during a continuous gesture `update()` hits the
    // `gestureActive` suppression above and returns before scheduling a RAF.
    //
    // PANE-SCOPED (task 598): one menu per pane; a hidden pane has no bolt to
    // re-seat, and the re-show poke below settles it when the pane is shown.
    const onResize = () => {
      if (visibleRef.current) update();
    };
    window.addEventListener("resize", onResize);
    const offGesture = onLayoutGestureChange((active) => {
      gestureActive = active;
      if (active) suppress();
      else settle();
    });
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (editor) {
        editor.off("selectionUpdate", update);
        editor.off("update", update);
        editor.off("focus", update);
        editor.off("blur", update);
      }
      offGesture();
      window.removeEventListener("mousedown", onMouseDown, true);
      disarmPress?.();
      window.removeEventListener("resize", onResize);
    };
  }, [editor, cacheRef, visibleRef]);

  // Recompute at the settled viewport-cache geometry. Out of the effect above
  // on purpose — see `updateRef`.
  useEffect(() => {
    updateRef.current();
  }, [cacheVersion]);

  // The bolt's LIVE viewport rect, re-derived from the view (one
  // `coordsAtPosCached` read + the portal origin) — null when there is no head
  // line to sit beside.
  const liveBoltRect = useCallback((): BoltRect | null => {
    if (!editor || editor.isDestroyed) return null;
    const live = computePlacement(editor, cacheRef.current);
    return live.visible ? boltViewportRect(live, cacheRef.current) : null;
  }, [editor, cacheRef]);

  // The OPEN menu's live anchor (task 1200). The menu is a fixed `<Menu>`
  // portal, so it cannot ride the scroll by layout the way the resting bolt
  // now does (task 1355); the menu provider calls this thunk at most once per
  // frame on scroll/resize, gesture-parked (Scroll-anchor stability law, shape
  // (b)) — no listener added here. It is ALSO the menu's off-screen close: the
  // bolt has no scroll listener any more, so `placement` never learns that a
  // scroll carried the line out of the band — the live read here does, and
  // closes. An off-band read answers the LAST in-band rect, not null: the
  // provider's null fallback is the static open-time `triggerRect`, which
  // would fling the menu back to where it opened for the closing frame.
  const lastBoltRectRef = useRef<BoltRect | null>(null);
  const trackBolt = useCallback<LiveAnchor>(() => {
    const rect = liveBoltRect();
    const frame = cacheRef.current;
    if (
      rect &&
      rect.bottom >= frame.scrollTop &&
      rect.top <= frame.scrollBottom
    ) {
      lastBoltRectRef.current = rect;
    } else {
      setMenuTarget(null);
    }
    return lastBoltRectRef.current;
  }, [liveBoltRect, cacheRef]);

  // Shown again → settle the placement a hidden-pane resize skipped (task 598).
  // Hidden → close the open menu (task 753): it anchors to a bolt the hidden
  // pane no longer paints, and its actions would dispatch into a document the
  // user cannot see. The render gate below unmounts it this frame; clearing
  // the target keeps it from springing back open on re-show.
  useEffect(() => {
    if (isVisible) updateRef.current();
    else setMenuTarget(null);
  }, [isVisible]);

  // Close the menu when the anchored *identity* changes — selection moved,
  // paragraph changed, mode flipped. `left/top` excluded so scroll re-positions
  // the open menu instead of collapsing it. `anchorNodePos` (not UUID) is the
  // identity key: it's stable across the `ensureAnchorUuid` setNodeMarkup that
  // fires when the menu opens.
  useEffect(() => {
    setMenuTarget(null);
  }, [
    placement.range?.from,
    placement.range?.to,
    placement.anchorNodePos,
    placement.mode,
  ]);

  // Close the menu on a genuine visibility DROP only — the head line went away
  // (`computePlacement` yields visible:false: focus lost in cursor mode, a node
  // selection, a hidden editor). A RISE (false→true) must NOT close (task 154).
  // The directional guard is why `placement.visible` was split out of the
  // identity-close effect above. (Scrolling OUT of the band is no longer a
  // `placement` fact — task 1355 — and closes through `trackBolt`.)
  const prevVisibleRef = useRef(placement.visible);
  useEffect(() => {
    const droppedOffScreen = prevVisibleRef.current && !placement.visible;
    prevVisibleRef.current = placement.visible;
    if (droppedOffScreen) setMenuTarget(null);
  }, [placement.visible]);

  // Keep the latest open-state reachable from the mount-once Cmd+/ handler
  // without re-subscribing the listener on every selection change.
  const menuOpenRef = useRef(false);
  useEffect(() => {
    menuOpenRef.current = menuTarget !== null;
  }, [menuTarget]);

  // Cmd+/ opens the menu at the live cursor/selection — the keyboard twin of
  // clicking the margin ⚡. O(1) bail; window-level (not an editor.on
  // subscriber), so it costs nothing per keystroke.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || !e.metaKey || e.ctrlKey || e.altKey || e.shiftKey)
        return;
      const ed = editor;
      if (!ed || ed.isDestroyed) return;
      // Already open → toggle it closed (cursor stays; editor kept focus).
      if (menuOpenRef.current) {
        e.preventDefault();
        setMenuTarget(null);
        return;
      }
      if (!ed.isFocused) return;
      const sel = ed.state.selection;
      if (sel instanceof NodeSelection) return;
      const resolved = resolveAnchorUuidAndKind(ed.view, sel.head);
      if (!resolved) return;
      e.preventDefault();
      // Bring the caret into the visible band before opening (task 154), then
      // read the bolt's rect at the caret's NEW screen spot — PM scrolls
      // synchronously inside the dispatch, so the read below already sees it.
      ed.commands.scrollIntoView();
      const rect = liveBoltRect();
      if (!rect) return;
      setMenuTarget({
        uuid: resolved.uuid,
        kind: resolved.kind,
        range: { from: sel.from, to: sel.to },
        mode: sel.empty ? "cursor" : "selection",
        triggerRect: rect,
      });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [editor, liveBoltRect]);

  const hint = useHint({ keys: "Mod+/" });

  if (typeof document === "undefined") return null;

  if (!editor) return null;

  // The RESTING bolt paints only at a logically-visible placement AND while not
  // transiently suppressed (press-drag / layout gesture). The OPEN menu is
  // DECOUPLED from `suppressed` — it renders on `menuTarget` + the *logical*
  // `placement.visible` (below), so a drag can never unmount it (task 154).
  const showBolt = placement.visible && !suppressed;

  // A TOGGLE, like its keyboard twin Cmd+/ above: pressing the bolt while its
  // menu is open closes it (the bolt is excluded from the menu's click-outside,
  // so this click is the ONLY thing that sees the press).
  const toggleMenu = () => {
    if (menuTarget) {
      setMenuTarget(null);
      return;
    }
    if (!placement.range) return;
    const resolved = resolveAnchorUuidAndKind(
      editor.view,
      editor.state.selection.head,
    );
    if (!resolved) return;
    setMenuTarget({
      uuid: resolved.uuid,
      kind: resolved.kind,
      range: placement.range,
      mode: placement.mode,
      triggerRect: boltViewportRect(placement, cacheRef.current),
    });
  };

  // Collapsed-state action button. Same chrome variables as the menu so
  // the two states feel like one component: the menu expands out of the
  // button, anchored at the same `left/top`.
  //
  // Where it paints (task 1355): the column-level `[data-grab-handle-portal]`
  // host inside the row scroll container — NOT the pod, whose `overflow: clip`
  // would cut the cramped split-view scrollbar-tuck placement. The host is
  // `pointer-events:none`, so the bolt re-enables them on itself. The host
  // rides `placement` (see `Placement.host`), so coords and container come
  // from one frame snapshot.
  //
  // z-index: `IN_SCROLL_MARGIN_TRIGGER_Z` (see src/floats/float-policy.ts tier
  // map) — the grab handle's in-scroll tier: over editor content, UNDER the
  // sticky pod caps (z 30/31) so a line scrolling behind a cap takes its bolt
  // with it, and below the docked-panel band and the float layer, so a popout
  // / popped card / lifted-text overlay dropped over this paragraph OCCLUDES
  // the bolt (BUG #50). Resting tier ONLY: the `ActionsMenuPanel` it opens
  // rides the `<Menu>` primitive's CHROME_Z (2000, = OPEN_CHROME_MENU_Z) and
  // stays on top of EVERYTHING, floats included.
  //
  // Both the bolt and the open menu go through the pane-overlay door (task
  // 753), so a hidden pane renders neither.
  const buttonPortal = showBolt
    ? (
    <PaneOverlayPortal container={placement.host}>
    <button
      ref={boltRef}
      type="button"
      aria-label="Open actions menu"
      {...boltTriggerProps}
      {...hint}
      // Prevent the mousedown from blurring the editor / clearing the
      // selection before the click registers.
      onMouseDown={(e) => e.preventDefault()}
      onClick={toggleMenu}
      // Resting bg lives on the CLASS layer (`bg-[var(--pod-editor)]`), NOT
      // inline: an inline `background` shorthand sets `background-color` and,
      // as an inline declaration, beats any non-`!important` selector —
      // including `.hover-on-light:hover` — so the hover tint would be dead.
      // With the resting bg as a (0,1,0) utility class, `.hover-on-light:hover`
      // (0,2,0, and unlayered vs. Tailwind's `@layer utilities`) wins and the
      // one-step tint fires — matching the left-side TextObjectGrabHandle twin
      // and every other `hover-on-light` control (task 299).
      // NO `focus-ring` (task 503), and for the same cascade reason the
      // comment above gives for `background`: the elevation below is an
      // INLINE `boxShadow`, which beats any non-`!important` selector — so
      // `.focus-ring:focus-visible` could never paint its ring here, while its
      // `outline: none` DID apply. Net effect: a keyboard-reachable control
      // with NO focus indicator at all, which is strictly worse than the UA
      // outline it deleted. Dropped, so the UA ring comes back — the same
      // answer `StackIcon` takes (allowlisted there with that reason). This
      // site takes no allowlist entry: leg C skips it anyway (`{...hint}` is
      // an unresolvable spread). What pins the decision is the sibling leg
      // "no element that takes the indicator also owns box-shadow INLINE" in
      // `icon-button-a11y-guardrail.test.ts`, whose allowlist is EMPTY.
      className="flex items-center justify-center hover-on-light bg-[var(--pod-editor)]"
      style={{
        position: "absolute",
        left: placement.left,
        top: placement.top,
        width: BUTTON_SIZE,
        height: BUTTON_SIZE,
        zIndex: IN_SCROLL_MARGIN_TRIGGER_Z,
        pointerEvents: "auto",
        border: "var(--pod-border)",
        boxShadow: "var(--menu-shadow)",
        borderRadius: "var(--pod-radius)",
        padding: 0,
        cursor: "pointer",
      }}
    >
      <IconZap size={16} />
    </button>
    </PaneOverlayPortal>
      )
    : null;

  // Menu renders on `menuTarget` + logical visibility only — never the transient
  // `suppressed` — so a drag can't unmount an open menu (task 154).
  if (!menuTarget || !placement.visible || !isVisible) return buttonPortal;

  return (
    <>
      {buttonPortal}
      <ActionsMenuPanel
        editor={editor}
        paragraphUuid={menuTarget.uuid}
        nodeKind={menuTarget.kind}
        range={menuTarget.range}
        mode={menuTarget.mode}
        triggerRect={menuTarget.triggerRect}
        trackAnchor={trackBolt}
        triggerEl={boltEl}
        onClose={() => setMenuTarget(null)}
        documentClass={documentClass}
      />
    </>
  );
}
