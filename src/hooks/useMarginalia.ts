"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { ANCHORABLE_NODES, ANCHORABLE_ATOMS } from "@/lib/marginalia";

export interface ParagraphPosition {
  /** Paragraph UUID */
  id: string;
  /** Top offset (px) inside the editor's scroll container */
  top: number;
  /** Height (px) of the paragraph element */
  height: number;
}

/**
 * Hook that tracks the screen position (top offset) of every UUID-bearing
 * paragraph/heading/list in the editor. Recomputes on document update,
 * selection change, scroll, and resize.
 *
 * Marginalia consumers use this to render markers in the gutter aligned
 * with their anchor paragraph's first line.
 */
export function useMarginalia(editor: Editor | null) {
  const [positions, setPositions] = useState<Map<string, { top: number; height: number }>>(new Map());
  const rafRef = useRef(0);

  const compute = useCallback(() => {
    if (!editor) {
      setPositions((prev) => (prev.size === 0 ? prev : new Map()));
      return;
    }
    let scrollEl: HTMLElement | null = null;
    try {
      scrollEl = editor.view?.dom?.closest(".overflow-y-auto") as HTMLElement | null;
    } catch {
      return;
    }
    if (!scrollEl) return;
    const scrollRect = scrollEl.getBoundingClientRect();

    const next = new Map<string, { top: number; height: number }>();
    editor.state.doc.descendants((node, pos) => {
      const name = node.type.name;
      if (ANCHORABLE_NODES.has(name)) {
        const id = (node.attrs?.uuid as string | undefined) || `_pos:${pos}`;
        try {
          let top: number;
          const dom = editor.view.nodeDOM(pos) as HTMLElement | null;
          if (ANCHORABLE_ATOMS.has(name)) {
            // Atom nodes: pos+1 is outside the node, use DOM rect directly
            if (!dom) return true;
            top = dom.getBoundingClientRect().top - scrollRect.top + scrollEl!.scrollTop;
          } else {
            // Container nodes: step inside for first-line coordinates
            const coords = editor.view.coordsAtPos(pos + 1);
            top = coords.top - scrollRect.top + scrollEl!.scrollTop;
          }
          const height = dom ? dom.getBoundingClientRect().height : 20;
          next.set(id, { top, height });
        } catch { /* ignore */ }
      }
      // Don't recurse into list items — list itself carries the uuid
      if (name === "bulletList" || name === "orderedList") return false;
      return true;
    });

    // Avoid setState if positions haven't changed
    setPositions((prev) => {
      if (prev.size !== next.size) return next;
      for (const [k, v] of next) {
        const p = prev.get(k);
        if (!p || p.top !== v.top || p.height !== v.height) return next;
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
