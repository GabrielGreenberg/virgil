"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";

/**
 * Cached DOM measurements that are stable across keystrokes — the editor's
 * right text edge and the scroll parent's viewport rect. These values only
 * change on resize / layout shift (e.g. sidebar toggle), not on selection
 * moves or content edits.
 *
 * Selection-tracking placement components (SelectionActionsMenu,
 * SelectionDragHandle) previously re-read these on every RAF, paying for
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
  /** Pixels read from --gutter-col-handle-inset on the editor element.
   *  TextObjectGrabHandle parks top-level handles at contentLeft −
   *  gutterInset (see src/text-objects/handle-layout.ts). Read here
   *  so JS placement and CSS chrome share one source. */
  gutterInset: number;
  /** Left edge of the grab-handle hover zone — the horizontal stripe
   *  where hovering reveals a TextObject's grab handle. Extends leftward
   *  from `contentLeft` by `gutterInset` (where the handle lives) plus a
   *  small cushion. So the user can move the cursor from the prose into
   *  the gutter toward the handle without the resolver dropping hover. */
  hoverZoneLeft: number;
  /** Right edge of the hover zone — equal to `editorRight`. Handle is
   *  on the left; no widening on the right. */
  hoverZoneRight: number;
  /** The `[data-editor-col="true"]` (editor-pane-column) element that
   *  serves as the grab-handle portal's positioning context. The portal
   *  div lives as a column-level sibling of the pod (NOT inside the
   *  pod) so it escapes the pod's `clipPath` that would otherwise clip
   *  handles in the gutter. Handles render as absolute-positioned
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

const DEFAULT_GUTTER_INSET = 22;
/** Cushion added to the hover zone's leftward extent so the handle
 *  (~10px wide) sits comfortably inside. */
const HOVER_GUTTER_PAD = 8;

const EMPTY_CACHE: EditorViewportCache = {
  editorEl: null,
  contentLeft: 0,
  editorRight: 0,
  scrollParent: null,
  scrollTop: 0,
  scrollBottom: 0,
  gutterInset: DEFAULT_GUTTER_INSET,
  hoverZoneLeft: 0,
  hoverZoneRight: 0,
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
      if (!editorEl.isConnected) return;
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
      const insetRaw = cs.getPropertyValue("--gutter-col-handle-inset").trim();
      const parsedInset = parseFloat(insetRaw);
      const gutterInset = Number.isFinite(parsedInset) && parsedInset > 0
        ? parsedInset
        : DEFAULT_GUTTER_INSET;
      const hoverZoneLeft = contentLeft - gutterInset - HOVER_GUTTER_PAD;
      const hoverZoneRight = editorRight;
      // `editor-pane-column` is the positioning context for the grab-
      // handle portal. The portal lives at column level (sibling of the
      // pod) so it escapes the pod's `clipPath` that clips lateral
      // descendants beyond ±20px (the handle sits ~22px left of the
      // pod's content edge, in the gutter). Walk from the editorEl up
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
        prev.gutterInset === gutterInset &&
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
        gutterInset,
        hoverZoneLeft,
        hoverZoneRight,
        paperEl,
        paperRect: { top: paperTop, left: paperLeft },
        containsHoverZone,
        toPortalCoords,
      };
      setVersion((v) => (v + 1) & 0xffff);
    };

    refresh();

    const ro = new ResizeObserver(refresh);
    ro.observe(editorEl);
    const sp = findScrollParent(editorEl);
    if (sp) ro.observe(sp);

    window.addEventListener("resize", refresh);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", refresh);
      cacheRef.current = EMPTY_CACHE;
    };
  }, [editor]);

  return { cacheRef, version };
}
