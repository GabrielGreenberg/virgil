"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { Editor } from "@tiptap/react";
import {
  isAnchorableNode,
  isAnchorableAtom,
  type AnchorNodeMetrics,
} from "@/lib/marginalia";
import { findRowScroll } from "@/components/editor-layout/layout-scroll";

/**
 * Hook that tracks the screen position and line metrics of every UUID-bearing
 * paragraph/heading/list in the editor. Recomputes on document update,
 * selection change, scroll, and resize.
 *
 * Returns a Map of paragraph UUID → AnchorNodeMetrics, which includes the
 * computed line height and line count needed for the line-aligned margin grid.
 */
export function useMarginalia(editor: Editor | null) {
  const [positions, setPositions] = useState<Map<string, AnchorNodeMetrics>>(
    new Map()
  );
  const rafRef = useRef(0);

  const compute = useCallback(() => {
    if (!editor) {
      setPositions((prev) => (prev.size === 0 ? prev : new Map()));
      return;
    }
    // Marginalia is positioned relative to the editor pod (the white pod
    // marked `data-marginalia-host`). Both the host and the editor's
    // paragraph DOM share the row's scroll, so `rect.top - hostRect.top`
    // is scroll-invariant.
    let hostEl: HTMLElement | null = null;
    try {
      hostEl = editor.view?.dom?.closest(
        "[data-marginalia-host]",
      ) as HTMLElement | null;
    } catch {
      return;
    }
    if (!hostEl) return;
    const hostRect = hostEl.getBoundingClientRect();

    const next = new Map<string, AnchorNodeMetrics>();
    editor.state.doc.descendants((node, pos) => {
      if (isAnchorableNode(node.type)) {
        const id =
          (node.attrs?.uuid as string | undefined) || `_pos:${pos}`;
        const isAtom = isAnchorableAtom(node.type);
        try {
          const dom = editor.view.nodeDOM(pos) as HTMLElement | null;
          if (!dom) return true;

          const domRect = dom.getBoundingClientRect();
          const domTop = domRect.top - hostRect.top;
          const height = domRect.height;

          // Find the actual text element (not wrapper divs or nested title
          // annotations). For blockquotes/lists whose first child is a
          // par-title-wrapper paragraph, we must drill past the title line so
          // marginalia aligns with the first body text line.
          let measureEl: HTMLElement = dom;
          if (!isAtom) {
            if (dom.classList.contains("par-title-wrapper")) {
              measureEl = dom.querySelector(".par-body-container p, p") ?? dom;
            } else if (dom.classList.contains("heading-wrapper")) {
              measureEl = dom.querySelector("h1,h2,h3") ?? dom;
            } else if (dom.classList.contains("list-title-wrapper")) {
              measureEl =
                dom.querySelector("ul > li, ol > li") ?? dom;
            } else if (dom.tagName === "BLOCKQUOTE") {
              measureEl =
                dom.querySelector(".par-body-container p, :scope > p, :scope > h1, :scope > h2, :scope > h3") ??
                dom;
            }
          }

          // `top` = first text line (for icon positioning in the grid)
          // `domTop` = element boundary (for hit-testing in drop resolution)
          let top: number;
          if (isAtom) {
            top = domTop;
          } else if (measureEl !== dom) {
            // Use the resolved text element's rect so title annotations inside
            // wrappers or blockquotes don't shift the anchor upward.
            const measureRect = measureEl.getBoundingClientRect();
            top = measureRect.top - hostRect.top;
          } else {
            const coords = editor.view.coordsAtPos(pos + 1);
            top = coords.top - hostRect.top;
          }

          let lineHeight: number;
          let lineCount: number;

          if (isAtom) {
            lineHeight = height;
            lineCount = 1;
          } else {
            const style = window.getComputedStyle(measureEl);
            const lh = parseFloat(style.lineHeight);
            // "normal" line-height returns NaN — fall back to fontSize * 1.2
            lineHeight = Number.isFinite(lh)
              ? lh
              : parseFloat(style.fontSize) * 1.2;

            // Use the measured element's rect for line counting (excludes
            // wrapper children like par-title-annotation / heading-annotation)
            const measureRect = measureEl.getBoundingClientRect();
            const pt = parseFloat(style.paddingTop) || 0;
            const pb = parseFloat(style.paddingBottom) || 0;
            const contentHeight = measureRect.height - pt - pb;
            lineCount = Math.max(1, Math.round(contentHeight / lineHeight));
          }

          next.set(id, { id, top, domTop, height, lineHeight, lineCount, isAtom });
        } catch {
          /* ignore */
        }
      }
      // Don't recurse into anchorable containers — they carry the uuid.
      return !isAnchorableNode(node.type);
    });

    // Avoid setState if positions haven't changed
    setPositions((prev) => {
      if (prev.size !== next.size) return next;
      for (const [k, v] of next) {
        const p = prev.get(k);
        if (
          !p ||
          p.top !== v.top ||
          p.domTop !== v.domTop ||
          p.height !== v.height ||
          p.lineHeight !== v.lineHeight ||
          p.lineCount !== v.lineCount
        )
          return next;
      }
      return prev;
    });
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    let dom: Element | undefined;
    try {
      dom = editor.view?.dom;
    } catch {
      return;
    }
    if (!dom) return;

    // Editor document changes (new UUIDs, paragraph edits) must recompute
    // synchronously so that markers referencing freshly-assigned UUIDs can
    // find their metrics in the same React render cycle. Scroll and resize
    // events are debounced via rAF since they don't change UUID keys.
    const onDocUpdate = () => {
      cancelAnimationFrame(rafRef.current);
      compute();
    };

    const onLayoutChange = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(compute);
    };

    // Initial compute (debounced once for layout stabilization)
    rafRef.current = requestAnimationFrame(compute);

    editor.on("update", onDocUpdate);
    editor.on("selectionUpdate", onLayoutChange);

    // Marginalia metrics are scroll-invariant under unified row scroll
    // (host pod and paragraph DOM move together). We still listen on the
    // row scroll to trigger a re-render in case of layout shifts.
    const rowScroll = findRowScroll();
    rowScroll?.addEventListener("scroll", onLayoutChange, { passive: true });
    window.addEventListener("resize", onLayoutChange);

    return () => {
      cancelAnimationFrame(rafRef.current);
      editor.off("update", onDocUpdate);
      editor.off("selectionUpdate", onLayoutChange);
      rowScroll?.removeEventListener("scroll", onLayoutChange);
      window.removeEventListener("resize", onLayoutChange);
    };
  }, [editor, compute]);

  return positions;
}
