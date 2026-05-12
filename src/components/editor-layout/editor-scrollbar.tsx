"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Custom thin scrollbar pinned to the editor column's right edge.
 *
 * The unified row scroll places the native scrollbar at the far right of
 * the window. This component instead renders a custom thumb at the editor
 * pod's right edge, so the scroll affordance sits next to the content it
 * scrolls. The native vertical scrollbar is hidden via CSS in globals.css.
 *
 * Position is computed in viewport coords from the editor column's
 * bounding rect, updated on row scroll, resize, and panel collapse/expand.
 * Drag handlers translate thumb-Y deltas into row.scrollTop changes.
 */
export function EditorScrollbar({
  rowRef,
  editorColRef,
  topInset = 40,
  bottomInset = 18,
  width = 6,
  outset = 2,
}: {
  rowRef: React.RefObject<HTMLElement | null>;
  editorColRef: React.RefObject<HTMLElement | null>;
  topInset?: number;
  bottomInset?: number;
  width?: number;
  /** Pixels right of the editor column's right edge to start the track. */
  outset?: number;
}) {
  const [layout, setLayout] = useState({ left: 0, top: 0, height: 0 });
  const [scroll, setScroll] = useState({ top: 0, height: 1, client: 1 });
  const [hover, setHover] = useState(false);
  const dragging = useRef(false);

  const refresh = useCallback(() => {
    const ec = editorColRef.current;
    const row = rowRef.current;
    if (!ec || !row) return;
    const ecr = ec.getBoundingClientRect();
    const rowr = row.getBoundingClientRect();
    setLayout({
      left: ecr.right + outset,
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
  }, [rowRef, editorColRef, topInset, bottomInset, outset]);

  useEffect(() => {
    refresh();
    const row = rowRef.current;
    const ec = editorColRef.current;
    if (!row || !ec) return;
    // Bound the row's natural scroll to the editor's effective end. Panel
    // columns can be taller than the editor (unanchored cards stack above
    // the anchored ones); without a bound the row's scrollHeight grows to
    // the tallest column and the user can scroll past the editor's bottom
    // into empty space. We enforce the bound at the layout level by
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
    row.addEventListener("scroll", refresh, { passive: true });
    window.addEventListener("resize", refresh);
    const ro = new ResizeObserver(() => { syncRowBoundCss(); refresh(); });
    ro.observe(row);
    ro.observe(ec);
    const page = ec.querySelector("[data-editor-page]") as HTMLElement | null;
    if (page) ro.observe(page);
    const mo = new MutationObserver(() => { syncRowBoundCss(); refresh(); });
    mo.observe(row, { childList: true, subtree: true, characterData: true });
    return () => {
      row.removeEventListener("scroll", refresh);
      window.removeEventListener("resize", refresh);
      ro.disconnect();
      mo.disconnect();
    };
  }, [rowRef, editorColRef, refresh]);

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
      dragging.current = true;
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
        dragging.current = false;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [rowRef, layout.height, scroll.height, scroll.client, thumbHeight],
  );

  if (!scrollable) return null;

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "fixed",
        left: layout.left,
        top: layout.top,
        width,
        height: layout.height,
        zIndex: 35,
        // Track is invisible; only the thumb is drawn. Pointer events
        // are still on the wrapper so hover changes the thumb opacity.
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
          background: hover || dragging.current
            ? "rgba(0,0,0,0.35)"
            : "rgba(0,0,0,0.18)",
          cursor: "grab",
          transition: "background 120ms ease",
        }}
      />
    </div>
  );
}
