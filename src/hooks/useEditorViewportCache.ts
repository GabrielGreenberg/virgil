"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  recordKeystrokeWork,
  KEYSTROKE_WORK_VIEWPORT_CACHE_RO,
} from "@/lib/keystroke-latency-probe";
import { parkDuringLayoutGesture } from "@/lib/pane-resize";
import { LAYOUT_SITE_VIEWPORT_CACHE } from "@/lib/layout-gesture-probe";

/**
 * Cached DOM measurements that are stable across keystrokes — the editor's
 * right text edge and the scroll parent's viewport rect. These values only
 * change on resize / layout shift (e.g. sidebar toggle), not on selection
 * moves or content edits.
 *
 * Selection-tracking placement components (SelectionActionsMenu,
 * TextObjectGrabHandle) previously re-read these on every RAF, paying for
 * 3-4 forced layouts per keystroke: editor `getBoundingClientRect` +
 * `getComputedStyle` for padding + `findScrollParent` (which walks DOM
 * ancestors with `getComputedStyle` each) + scroll parent
 * `getBoundingClientRect`. This hook collapses that to one refresh per
 * actual layout change.
 *
 * Refresh triggers:
 *   - Editor change (mount/unmount)
 *   - Window resize
 *   - ResizeObserver on the editor element (catches sidebar toggles, pane
 *     drags that don't fire window resize)
 *   - ResizeObserver on the scroll parent
 *
 * All three geometry triggers are PARKED on the layout-gesture bus, so a
 * continuous gesture (pane-divider drag or OS window resize) costs ONE refresh
 * on its end edge instead of one per frame × 4 mounted instances.
 *
 * Consumers read `cacheRef.current` for ad-hoc reads (no re-render) and
 * depend on `version` in their effect deps when they need to re-run on
 * cache changes.
 */
export interface EditorViewportCache {
  editorEl: HTMLElement | null;
  /** editorRect.left + paddingLeft — the editor's left text edge. */
  contentLeft: number;
  /** editorRect.right - paddingRight — the editor's right text edge.
   *  Aliased as `hoverZoneRight`; kept separate for callers that already
   *  read this name. */
  editorRight: number;
  scrollParent: HTMLElement | null;
  scrollTop: number;
  scrollBottom: number;
  /** Pixels read from --margin-col-handle-inset on the editor element — the
   *  narrow-viewport FLOOR for handle placement (`editorColumnLeft −
   *  marginInset`), applied in src/text-objects/handle-layout.ts. (Handles
   *  otherwise hug each block's measured marker via block-frame.ts; this is
   *  just the off-screen-left clamp.) Read here so JS and CSS share one knob. */
  marginInset: number;
  /** Left edge of the grab-handle hover zone — the horizontal stripe
   *  where hovering reveals a TextObject's grab handle. Extends leftward
   *  from `contentLeft` by `marginInset` (where the handle lives) plus a
   *  small cushion. So the user can move the cursor from the prose into
   *  the margin toward the handle without the resolver dropping hover. */
  hoverZoneLeft: number;
  /** Right edge of the hover zone — equal to `editorRight`. Handle is
   *  on the left; no widening on the right. */
  hoverZoneRight: number;
  /** Left edge of `.editor-pane-pod` — the pod's OUTER rect, including
   *  the white padding around the text column. Used by the lifted-overlay
   *  predicate so "popout mode" activates at the white-pod → manila
   *  transition, not at the text → white-padding transition inside the
   *  pod. Falls back to `rect.left` if the pod walk fails (defensive). */
  podLeft: number;
  /** Right edge of `.editor-pane-pod`. See `podLeft`. */
  podRight: number;
  /** Top edge of `.editor-pane-pod`. See `podLeft`. */
  podTop: number;
  /** Bottom edge of `.editor-pane-pod`. See `podLeft`. */
  podBottom: number;
  /** True iff `(x, y)` falls inside the editor POD's outer rect — i.e.
   *  the `.editor-pane-pod` wrapper around the text column, which
   *  includes the pod's white padding. Sibling of `containsHoverZone`.
   *  Used by the lifted-overlay gesture to decide ghost-mode vs
   *  popout-mode: cursor inside the pod (anywhere in the white area,
   *  including the padding around text) → ghost; cursor crossing the
   *  pod's outer edge into the manila column → popout. Matches the
   *  user's mental model of the boundary as the white-pod → manila
   *  transition, not the text → white-padding transition. Predicate
   *  name is retained for diff minimisation; semantics widened from
   *  text content rect → editor pod outer rect (L1.7). */
  containsContentZone(x: number, y: number): boolean;
  /** The `[data-editor-col="true"]` (editor-pane-column) element that
   *  serves as the grab-handle portal's positioning context. The portal
   *  div lives as a column-level sibling of the pod (NOT inside the
   *  pod) so it escapes the pod's `clipPath` that would otherwise clip
   *  handles in the margin. Handles render as absolute-positioned
   *  children of `[data-grab-handle-portal]` inside this column; the
   *  rect's top-left is the origin for converting viewport coords to
   *  portal-relative coords. Null when the column isn't mounted yet.
   *  (Name stays `paperEl` for diff minimization; semantically this is
   *  the column.) */
  paperEl: HTMLElement | null;
  /** Top/left of `paperEl` in viewport coords; used by
   *  `toPortalCoords` so callers don't re-read getBoundingClientRect
   *  per RAF. Updated on the same refresh path as the other rects. */
  paperRect: { top: number; left: number };
  /** True iff `(x, y)` falls inside the hover-active rectangle for this
   *  editor. Y is bounded by the scroll parent's visible region. */
  containsHoverZone(x: number, y: number): boolean;
  /** Convert viewport coords to portal-relative coords (inside the
   *  `editor-pane-column` containing block — the portal lives at column
   *  level, not inside paper-render). Returns the input unchanged if
   *  the column isn't mounted yet — handles render in viewport coords
   *  as a fallback until paperEl resolves. */
  toPortalCoords(viewportX: number, viewportY: number): { x: number; y: number };
}

const DEFAULT_MARGIN_INSET = 22;
/** Cushion added to the hover zone's leftward extent so the handle
 *  (~10px wide) sits comfortably inside. */
const HOVER_MARGIN_PAD = 8;

const EMPTY_CACHE: EditorViewportCache = {
  editorEl: null,
  contentLeft: 0,
  editorRight: 0,
  scrollParent: null,
  scrollTop: 0,
  scrollBottom: 0,
  marginInset: DEFAULT_MARGIN_INSET,
  hoverZoneLeft: 0,
  hoverZoneRight: 0,
  podLeft: 0,
  podRight: 0,
  podTop: 0,
  podBottom: 0,
  containsContentZone: () => false,
  paperEl: null,
  paperRect: { top: 0, left: 0 },
  containsHoverZone: () => false,
  toPortalCoords: (x, y) => ({ x, y }),
};

export function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let cur = el?.parentElement ?? null;
  while (cur) {
    const cs = window.getComputedStyle(cur);
    const ov = cs.overflowY;
    if ((ov === "auto" || ov === "scroll") && cur.scrollHeight > cur.clientHeight) {
      return cur;
    }
    cur = cur.parentElement;
  }
  return null;
}

export function useEditorViewportCache(editor: Editor | null): {
  cacheRef: React.MutableRefObject<EditorViewportCache>;
  version: number;
} {
  const cacheRef = useRef<EditorViewportCache>(EMPTY_CACHE);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!editor || editor.isDestroyed) {
      cacheRef.current = EMPTY_CACHE;
      return;
    }
    let editorEl: HTMLElement;
    try {
      editorEl = editor.view.dom as HTMLElement;
    } catch {
      return;
    }
    if (!editorEl) return;

    const refresh = () => {
      // Keep-alive: a hidden (display:none) editor has offsetHeight 0 and all
      // its rects collapse to 0×0. Bailing here is the highest-leverage guard —
      // it stops the stale-geometry cascade (this cache's `version` bump drives
      // the margin-bolt, grab-handle, and in-text-position followers). The
      // ResizeObserver / window-resize that call refresh() fire on hide/show
      // regardless of editor transactions, so this offsetHeight check (not a
      // transaction gate) is the authoritative signal.
      if (!editorEl.isConnected || editorEl.offsetHeight === 0) return;
      const cs = window.getComputedStyle(editorEl);
      const rect = editorEl.getBoundingClientRect();
      const padLeft = parseFloat(cs.paddingLeft) || 0;
      const padRight = parseFloat(cs.paddingRight) || 0;
      const scrollParent = findScrollParent(editorEl);
      const scrollRect = scrollParent
        ? scrollParent.getBoundingClientRect()
        : { top: 0, bottom: window.innerHeight };
      const contentLeft = rect.left + padLeft;
      const editorRight = rect.right - padRight;
      const scrollTop = scrollRect.top;
      const scrollBottom = scrollRect.bottom;
      const insetRaw = cs.getPropertyValue("--margin-col-handle-inset").trim();
      const parsedInset = parseFloat(insetRaw);
      const marginInset = Number.isFinite(parsedInset) && parsedInset > 0
        ? parsedInset
        : DEFAULT_MARGIN_INSET;
      const hoverZoneLeft = contentLeft - marginInset - HOVER_MARGIN_PAD;
      const hoverZoneRight = editorRight;
      // `.editor-pane-pod` is the outer pod wrapper around the text
      // column (white surface + chrome). The lifted-overlay gesture's
      // mode-flip predicate (containsContentZone) reads THIS rect, not
      // the ProseMirror text content rect, so popout mode engages at
      // the white-pod → manila transition rather than at the inner
      // text → white-padding edge inside the pod. Defensive fallback
      // to the editor's own rect if the pod walk fails (early mount,
      // unexpected DOM, etc.).
      const podEl = (editorEl.closest(
        ".editor-pane-pod",
      ) as HTMLElement | null) ?? null;
      const podRect = podEl?.getBoundingClientRect();
      const podLeft = podRect?.left ?? rect.left;
      const podRight = podRect?.right ?? rect.right;
      const podTop = podRect?.top ?? scrollTop;
      const podBottom = podRect?.bottom ?? scrollBottom;
      // `editor-pane-column` is the positioning context for the grab-
      // handle portal. The portal lives at column level (sibling of the
      // pod) so it escapes the pod's `clipPath` that clips lateral
      // descendants beyond ±20px (the handle sits ~22px left of the
      // pod's content edge, in the margin). Walk from the editorEl up
      // — same direction as the scroll parent walk — to find it.
      const paperEl = (editorEl.closest(
        '[data-editor-col="true"]',
      ) as HTMLElement | null) ?? null;
      const paperBound = paperEl?.getBoundingClientRect();
      const paperTop = paperBound?.top ?? 0;
      const paperLeft = paperBound?.left ?? 0;
      const prev = cacheRef.current;
      if (
        prev.editorEl === editorEl &&
        prev.contentLeft === contentLeft &&
        prev.editorRight === editorRight &&
        prev.scrollParent === scrollParent &&
        prev.scrollTop === scrollTop &&
        prev.scrollBottom === scrollBottom &&
        prev.marginInset === marginInset &&
        prev.podLeft === podLeft &&
        prev.podRight === podRight &&
        prev.podTop === podTop &&
        prev.podBottom === podBottom &&
        prev.paperEl === paperEl &&
        prev.paperRect.top === paperTop &&
        prev.paperRect.left === paperLeft
      ) {
        return;
      }
      // Capture the latest values in helper closures so callers always
      // see the current cache — the object identity changes per refresh,
      // and the closures are regenerated alongside the data fields.
      const containsHoverZone = (x: number, y: number): boolean =>
        x >= hoverZoneLeft &&
        x <= hoverZoneRight &&
        y >= scrollTop &&
        y <= scrollBottom;
      const containsContentZone = (x: number, y: number): boolean =>
        x >= podLeft && x <= podRight && y >= podTop && y <= podBottom;
      // Read the column rect fresh per call: it changes on scroll
      // (the column moves inside the row scroll container), and the
      // cache only refreshes on resize. Cheap — one
      // getBoundingClientRect per RAF (called from computePlacement,
      // not from mousemove).
      const toPortalCoords = (viewportX: number, viewportY: number) => {
        if (!paperEl) return { x: viewportX, y: viewportY };
        const live = paperEl.getBoundingClientRect();
        return { x: viewportX - live.left, y: viewportY - live.top };
      };
      cacheRef.current = {
        editorEl,
        contentLeft,
        editorRight,
        scrollParent,
        scrollTop,
        scrollBottom,
        marginInset,
        hoverZoneLeft,
        hoverZoneRight,
        podLeft,
        podRight,
        podTop,
        podBottom,
        containsContentZone,
        paperEl,
        paperRect: { top: paperTop, left: paperLeft },
        containsHoverZone,
        toPortalCoords,
      };
      setVersion((v) => (v + 1) & 0xffff);
    };

    refresh();

    // Park BOTH triggers on the layout-gesture bus (task 317). This is the
    // single highest-leverage park in the app: `refresh()` is a
    // `getComputedStyle` + 4× `getBoundingClientRect` + two `closest()` walks
    // + a `getComputedStyle`-per-ancestor `findScrollParent`, its equality
    // bail structurally cannot hold mid-gesture (the rects really are moving),
    // and the hook is mounted ×4 live (LiftHost, TextObjectGrabHandle,
    // PendingChangePill, SelectionActionsMenu) — each with its own RO on the
    // same two elements. Nothing user-visible reads the cache mid-gesture:
    // its consumers are overlays that SUPPRESS for the duration.
    const park = parkDuringLayoutGesture(refresh, LAYOUT_SITE_VIEWPORT_CACHE);

    const ro = new ResizeObserver(() => {
      recordKeystrokeWork(KEYSTROKE_WORK_VIEWPORT_CACHE_RO);
      park.fire();
    });
    ro.observe(editorEl);
    const sp = findScrollParent(editorEl);
    if (sp) ro.observe(sp);

    const onWindowResize = () => park.fire();
    window.addEventListener("resize", onWindowResize);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onWindowResize);
      park.dispose();
      cacheRef.current = EMPTY_CACHE;
    };
  }, [editor]);

  return { cacheRef, version };
}
