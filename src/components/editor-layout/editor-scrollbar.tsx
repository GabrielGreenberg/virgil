"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SCROLLBAR_THUMB_WIDTH, SCROLLBAR_RIGHT_INSET } from "./constants";

/**
 * Custom thin scrollbar tucked just inside the editor column's right edge.
 *
 * The unified row scroll places the native scrollbar at the far right of
 * the window. This component instead renders a custom thumb sitting in
 * the editor pod's right padding, so the scroll affordance overlays the
 * content it scrolls. The native vertical scrollbar is hidden via CSS in
 * globals.css.
 *
 * Position is computed in viewport coords from the editor column's
 * bounding rect, updated on row scroll, resize, and panel collapse/expand.
 * Drag handlers translate thumb-Y deltas into row.scrollTop changes.
 *
 * Visibility follows the modern overlay-scrollbar pattern: the thumb
 * appears on scroll/drag, then fades after FADE_DELAY ms of inactivity,
 * unless the user is hovering or dragging.
 */
const FADE_DELAY = 1000;
const FADE_DURATION = 300;

export function EditorScrollbar({
  rowRef,
  editorColRef,
  topInset = 40,
  bottomInset = 18,
  // Width + rightInset default to the right-margin geometry SSOT
  // (constants.ts) so the scrollbar's footprint (SCROLLBAR_GUTTER) and the
  // marginalia / selection-bolt clearances that derive from it can never
  // drift apart. Callers may still override per-surface.
  width = SCROLLBAR_THUMB_WIDTH,
  rightInset = SCROLLBAR_RIGHT_INSET,
}: {
  rowRef: React.RefObject<HTMLElement | null>;
  editorColRef: React.RefObject<HTMLElement | null>;
  topInset?: number;
  bottomInset?: number;
  width?: number;
  /** Pixels left of the editor column's right edge to place the thumb. */
  rightInset?: number;
}) {
  const [layout, setLayout] = useState({ left: 0, top: 0, height: 0 });
  const [scroll, setScroll] = useState({ top: 0, height: 1, client: 1 });
  const [hover, setHover] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [visible, setVisible] = useState(true);
  const [dragSuppress, setDragSuppress] = useState(false);
  const fadeTimer = useRef<number | null>(null);

  // Hide the thumb while the user is resizing a panel-edge drag-gap. The
  // editor column's width is changing continuously during the drag, so the
  // thumb would otherwise visibly chase the moving edge.
  useEffect(() => {
    const onStart = () => setDragSuppress(true);
    const onEnd = () => setDragSuppress(false);
    window.addEventListener("virgil:drag-gap-start", onStart);
    window.addEventListener("virgil:drag-gap-end", onEnd);
    return () => {
      window.removeEventListener("virgil:drag-gap-start", onStart);
      window.removeEventListener("virgil:drag-gap-end", onEnd);
    };
  }, []);

  const scheduleFade = useCallback(() => {
    if (fadeTimer.current !== null) {
      window.clearTimeout(fadeTimer.current);
    }
    setVisible(true);
    fadeTimer.current = window.setTimeout(() => {
      setVisible(false);
      fadeTimer.current = null;
    }, FADE_DELAY);
  }, []);

  const refresh = useCallback(() => {
    const ec = editorColRef.current;
    const row = rowRef.current;
    if (!ec || !row) return;
    const ecr = ec.getBoundingClientRect();
    const rowr = row.getBoundingClientRect();
    setLayout({
      left: ecr.right - width - rightInset,
      top: rowr.top + topInset,
      height: Math.max(0, rowr.height - topInset - bottomInset),
    });
    // Use editor-column scrollHeight (capped by row's), not row's, so the
    // thumb maxes out when the editor's bottom comes into view rather than
    // when the (possibly taller) panel columns do.
    const effectiveHeight = Math.min(ec.scrollHeight, row.scrollHeight);
    setScroll({
      top: row.scrollTop,
      height: effectiveHeight,
      client: row.clientHeight,
    });
  }, [rowRef, editorColRef, topInset, bottomInset, width, rightInset]);

  const onScroll = useCallback(() => {
    refresh();
    scheduleFade();
  }, [refresh, scheduleFade]);

  useEffect(() => {
    refresh();
    // Initial mount flash: start visible, then fade so the user gets a
    // one-shot hint that the doc is scrollable.
    scheduleFade();
    const row = rowRef.current;
    const ec = editorColRef.current;
    if (!row || !ec) return;
    // Bound the row's natural scroll to the editor's effective end. Panel
    // columns can run taller than the editor (a tall anchored cascade, or
    // a card pinned/expanded near the doc bottom — the A5 unanchored bin is
    // absolute/zero-flow and no longer adds to column height); without a
    // bound the row's scrollHeight grows to the tallest column and the user
    // can scroll past the editor's bottom into empty space. We enforce the
    // bound at the layout level by
    // capping panel-column heights to ec.scrollHeight via a CSS custom
    // property + `overflow: clip` (which clips visually but does NOT
    // establish a scroll container, so sticky descendants still latch to
    // the row scroll). This makes the browser's native scroll top out at
    // the editor's bottom.
    const syncRowBoundCss = () => {
      // Compute the column's target height. For short docs we want the
      // column to exactly match the row's clientHeight so the pod's
      // natural bottom aligns with the sticky cap-inner — no scroll
      // overflow, no doubled bottom edge. For long docs we want the
      // column to span the doc's full scroll height so sticky
      // descendants latch across the whole scroll range.
      //
      // We use the paper content's scrollHeight (not the column's,
      // which self-perpetuates once min-height inflates it) plus the
      // column's fixed chrome (32 toolbar + 8 breathing). Floor at
      // row.clientHeight so the column never collapses below the
      // visible scroll port.
      const page = ec.querySelector("[data-editor-page]") as HTMLElement | null;
      const paperH = page ? page.scrollHeight : 0;
      const required = paperH + 40;
      const h = Math.max(required, row.clientHeight);
      row.style.setProperty("--row-bound-h", `${h}px`);
      // Visible-viewport height of the scroll port. Distinct from
      // `--row-bound-h`, which is the column's *content* height (max
      // of doc scrollHeight and visible height). Margin-frame sticky
      // descendants (the L/R guide lines in margin-edit mode) need
      // the visible port height to compute `height: vp - chrome - T - B`
      // for the rectangle they span.
      row.style.setProperty("--scroll-viewport-h", `${row.clientHeight}px`);
      // When the doc fits within the row's visible viewport, hide the
      // sticky bottom cap. The cap exists to mask editor content
      // scrolling past the bottom 8px of the viewport for long docs;
      // for short docs it just doubles up on the pod's own rounded
      // bottom, creating a visible second edge with a manilla gap
      // between. Hiding it eliminates the doubling regardless of any
      // residual measurement quirks in the column min-height path.
      const docFits = required <= row.clientHeight;
      row.style.setProperty("--cap-bottom-display", docFits ? "none" : "flex");
    };
    syncRowBoundCss();
    row.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", refresh);
    const ro = new ResizeObserver(() => { syncRowBoundCss(); refresh(); });
    ro.observe(row);
    ro.observe(ec);
    const page = ec.querySelector("[data-editor-page]") as HTMLElement | null;
    if (page) ro.observe(page);
    const mo = new MutationObserver(() => { syncRowBoundCss(); refresh(); });
    mo.observe(row, { childList: true, subtree: true, characterData: true });
    return () => {
      row.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", refresh);
      ro.disconnect();
      mo.disconnect();
      if (fadeTimer.current !== null) {
        window.clearTimeout(fadeTimer.current);
        fadeTimer.current = null;
      }
    };
  }, [rowRef, editorColRef, refresh, onScroll, scheduleFade]);

  const scrollable = scroll.height > scroll.client + 1;
  const thumbRatio = scrollable ? scroll.client / scroll.height : 1;
  const thumbHeight = Math.max(24, layout.height * thumbRatio);
  const maxThumbY = Math.max(0, layout.height - thumbHeight);
  const progress = scrollable
    ? Math.min(1, Math.max(0, scroll.top / (scroll.height - scroll.client)))
    : 0;
  const thumbY = progress * maxThumbY;

  const onThumbMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const row = rowRef.current;
      if (!row) return;
      setDragging(true);
      scheduleFade();
      const startY = e.clientY;
      const startScroll = row.scrollTop;
      const trackPx = layout.height - thumbHeight;
      const scrollPx = scroll.height - scroll.client;
      const ratio = trackPx > 0 ? scrollPx / trackPx : 0;
      const onMove = (mv: MouseEvent) => {
        const dy = mv.clientY - startY;
        row.scrollTop = startScroll + dy * ratio;
      };
      const onUp = () => {
        setDragging(false);
        scheduleFade();
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [rowRef, layout.height, scroll.height, scroll.client, thumbHeight, scheduleFade],
  );

  if (!scrollable) return null;

  const effectiveOpacity = !dragSuppress && (visible || hover || dragging) ? 1 : 0;

  return (
    <div
      onMouseEnter={() => {
        setHover(true);
        scheduleFade();
      }}
      onMouseLeave={() => {
        setHover(false);
        scheduleFade();
      }}
      style={{
        position: "fixed",
        left: layout.left,
        top: layout.top,
        width,
        height: layout.height,
        zIndex: 35,
        // Track is invisible; only the thumb is drawn. Pointer events
        // are still on the wrapper so hover changes the thumb opacity
        // and the user can grab the thumb even mid-fade.
        pointerEvents: "auto",
      }}
    >
      <div
        onMouseDown={onThumbMouseDown}
        style={{
          position: "absolute",
          left: 0,
          top: thumbY,
          width,
          height: thumbHeight,
          borderRadius: width / 2,
          background: hover || dragging
            ? "rgba(0,0,0,0.35)"
            : "rgba(0,0,0,0.18)",
          opacity: effectiveOpacity,
          cursor: "grab",
          transition: `opacity ${FADE_DURATION}ms ease, background 120ms ease`,
        }}
      />
    </div>
  );
}
