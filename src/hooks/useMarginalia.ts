"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { Editor } from "@tiptap/react";
import {
  isAnchorableNode,
  isAnchorableAtom,
  type AnchorNodeMetrics,
} from "@/lib/marginalia";

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
    let scrollEl: HTMLElement | null = null;
    try {
      scrollEl = editor.view?.dom?.closest(
        ".overflow-y-auto"
      ) as HTMLElement | null;
    } catch {
      return;
    }
    if (!scrollEl) return;
    const scrollRect = scrollEl.getBoundingClientRect();

    const next = new Map<string, AnchorNodeMetrics>();
    editor.state.doc.descendants((node, pos) => {
      if (isAnchorableNode(node.type)) {
        const id =
          (node.attrs?.uuid as string | undefined) || `_pos:${pos}`;
        const isAtom = isAnchorableAtom(node.type);
        try {
          const dom = editor.view.nodeDOM(pos) as HTMLElement | null;
          if (!dom) return true;

          let top: number;
          if (isAtom) {
            top =
              dom.getBoundingClientRect().top -
              scrollRect.top +
              scrollEl!.scrollTop;
          } else {
            const coords = editor.view.coordsAtPos(pos + 1);
            top = coords.top - scrollRect.top + scrollEl!.scrollTop;
          }

          const height = dom.getBoundingClientRect().height;

          let lineHeight: number;
          let lineCount: number;

          if (isAtom) {
            lineHeight = height;
            lineCount = 1;
          } else {
            // Find the actual text element (not wrapper divs)
            let measureEl: HTMLElement = dom;
            if (dom.classList.contains("par-title-wrapper")) {
              measureEl = dom.querySelector("p") ?? dom;
            } else if (dom.classList.contains("heading-wrapper")) {
              measureEl =
                dom.querySelector("h1,h2,h3") ?? dom;
            }

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

          next.set(id, { id, top, height, lineHeight, lineCount, isAtom });
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

    const onUpdate = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(compute);
    };

    // Initial compute (debounced once for layout stabilization)
    rafRef.current = requestAnimationFrame(compute);

    editor.on("update", onUpdate);
    editor.on("selectionUpdate", onUpdate);

    const scrollEl = dom.closest(".overflow-y-auto");
    scrollEl?.addEventListener("scroll", onUpdate, { passive: true });
    window.addEventListener("resize", onUpdate);

    return () => {
      cancelAnimationFrame(rafRef.current);
      editor.off("update", onUpdate);
      editor.off("selectionUpdate", onUpdate);
      scrollEl?.removeEventListener("scroll", onUpdate);
      window.removeEventListener("resize", onUpdate);
    };
  }, [editor, compute]);

  return positions;
}
