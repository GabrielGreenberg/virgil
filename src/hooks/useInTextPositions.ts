"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { isAnchorableNode } from "@/lib/marginalia";

export interface PositionItem {
  id: string;
  pos: number; // ProseMirror document position
}

/**
 * Helper: extract positions for items anchored to paragraphs by UUID.
 * Works for any item shape that has `id` and `paragraphIds[]` — uses the
 * first paragraph anchor to resolve a doc position.
 */
export function getParagraphAnchorPositions(
  editor: Editor | null,
  items?: Array<{ id: string; paragraphIds: string[] }>,
): PositionItem[] {
  if (!editor || !items) return [];
  const uuidToPos = new Map<string, number>();
  editor.state.doc.descendants((node, pos) => {
    if (isAnchorableNode(node.type) && node.attrs?.uuid) {
      uuidToPos.set(node.attrs.uuid as string, pos);
    }
    return true;
  });
  const out: PositionItem[] = [];
  for (const it of items) {
    if (it.paragraphIds.length > 0) {
      const pos = uuidToPos.get(it.paragraphIds[0]);
      if (pos !== undefined) out.push({ id: it.id, pos });
    }
  }
  return out;
}


/**
 * Helper: find approximate document position for a text snippet.
 * Used by RevisionsPanel where comments store selectedText but no pos.
 */
export function findTextPosition(editor: Editor | null, text: string): number {
  if (!editor || !text) return 0;
  const docText = editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n");
  const snippet = text.slice(0, 40);
  const idx = docText.indexOf(snippet);
  if (idx < 0) return 0;
  // Convert text offset to doc position
  let pos = 0;
  let textOffset = 0;
  editor.state.doc.descendants((node, nodePos) => {
    if (pos > 0) return false;
    if (node.isText) {
      const len = (node.text || "").length;
      if (textOffset + len > idx) {
        pos = nodePos + (idx - textOffset);
        return false;
      }
      textOffset += len;
    } else if (node.isBlock && textOffset > 0) {
      textOffset += 1;
    }
    return true;
  });
  return pos;
}

const MIN_GAP = 4; // small extra gap between entries beyond their height
const DEFAULT_ENTRY_HEIGHT = 60; // fallback before entries are rendered

/**
 * Computes scroll-relative Y positions for panel items so they align
 * with their corresponding positions in the TipTap editor.
 *
 * Returns a Map<id, topPx> where topPx is relative to the editor's
 * scroll height (for use with position: absolute inside a container
 * that matches the editor's scrollHeight).
 *
 * Also returns the editor's scrollHeight for sizing the container,
 * and a ref to attach to the panel's scroll container for scroll sync.
 */
export function useInTextPositions(
  editor: Editor | null,
  items: PositionItem[],
  enabled: boolean,
  entryAttr: string = "data-citation-entry",
  /** Ref whose `.current` holds the pixel height of content above the
   *  positioned container (e.g. an unanchored section). The scroll sync
   *  offsets by this amount so the panel can scroll above the document. */
  topOffsetRef?: { current: number },
) {
  const [positions, setPositions] = useState<Map<string, number>>(new Map());
  const [editorScrollHeight, setEditorScrollHeight] = useState(0);
  const panelScrollRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const syncingRef = useRef(false); // prevent scroll sync loops

  // Delay activation to avoid state updates during initial mount
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (enabled) {
      const t = setTimeout(() => setReady(true), 100);
      return () => clearTimeout(t);
    }
    setReady(false);
  }, [enabled]);

  const compute = useCallback(() => {
    if (!editor || !enabled || !ready || items.length === 0) {
      setPositions(new Map());
      setEditorScrollHeight(0);
      return;
    }

    const scrollEl = editor.view.dom.closest(".overflow-y-auto") as HTMLElement | null;
    if (!scrollEl) {
      setPositions(new Map());
      return;
    }

    const scrollRect = scrollEl.getBoundingClientRect();
    setEditorScrollHeight(scrollEl.scrollHeight);

    // Compute positions using coordsAtPos for all items.
    // ProseMirror renders all nodes to the DOM (no virtualization),
    // so coordsAtPos works for the entire document.
    const scrollTop = scrollEl.scrollTop;
    const viewTop = scrollRect.top;

    const raw: Array<{ id: string; top: number }> = [];
    for (const item of items) {
      const pos = Math.min(item.pos, editor.state.doc.content.size);
      try {
        const coords = editor.view.coordsAtPos(pos);
        // Convert screen coords to scroll-relative position
        const top = coords.top - viewTop + scrollTop;
        raw.push({ id: item.id, top });
      } catch {
        // Skip items with invalid positions
      }
    }

    // Sort by top position
    raw.sort((a, b) => a.top - b.top);

    // Measure rendered entry heights from the DOM for accurate overlap resolution
    const panelEl = panelScrollRef.current;
    const entryHeights = new Map<string, number>();
    if (panelEl) {
      for (const r of raw) {
        const el = panelEl.querySelector(`[${entryAttr}="${r.id}"]`) as HTMLElement | null;
        if (el) {
          entryHeights.set(r.id, el.getBoundingClientRect().height);
        }
      }
    }

    // Resolve overlaps — push items down so they don't overlap
    for (let i = 1; i < raw.length; i++) {
      const prevHeight = entryHeights.get(raw[i - 1].id) || DEFAULT_ENTRY_HEIGHT;
      const minTop = raw[i - 1].top + prevHeight + MIN_GAP;
      if (raw[i].top < minTop) {
        raw[i].top = minTop;
      }
    }

    const map = new Map<string, number>();
    for (const r of raw) {
      map.set(r.id, r.top);
    }
    setPositions(map);
  }, [editor, items, enabled, ready, entryAttr]);

  // Recompute on editor changes and scroll
  useEffect(() => {
    if (!enabled) {
      setPositions(new Map());
      return;
    }

    compute();

    if (!editor) return;

    const onUpdate = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(compute);
    };

    editor.on("update", onUpdate);
    editor.on("selectionUpdate", onUpdate);

    const scrollEl = editor.view?.dom?.closest(".overflow-y-auto");
    scrollEl?.addEventListener("scroll", onUpdate, { passive: true });
    window.addEventListener("resize", onUpdate);

    // Watch for panel-side size changes — e.g. when a card expands its
    // bibliography pod, the entry height grows and we need to reflow
    // the absolute positions so the cards below don't get overlapped.
    // We observe each entry element individually so adding/removing
    // entries doesn't require re-running the observer setup.
    let resizeObs: ResizeObserver | null = null;
    let mutObs: MutationObserver | null = null;
    const panelEl = panelScrollRef.current;
    if (panelEl && typeof ResizeObserver !== "undefined") {
      resizeObs = new ResizeObserver(onUpdate);
      const observeEntries = () => {
        resizeObs?.disconnect();
        panelEl.querySelectorAll(`[${entryAttr}]`).forEach((el) => {
          resizeObs!.observe(el);
        });
      };
      observeEntries();
      // Re-observe whenever entries are added/removed from the DOM
      // (happens when the items prop changes).
      mutObs = new MutationObserver(observeEntries);
      mutObs.observe(panelEl, { childList: true, subtree: true });
    }

    return () => {
      cancelAnimationFrame(rafRef.current);
      editor.off("update", onUpdate);
      editor.off("selectionUpdate", onUpdate);
      scrollEl?.removeEventListener("scroll", onUpdate);
      window.removeEventListener("resize", onUpdate);
      resizeObs?.disconnect();
      mutObs?.disconnect();
    };
  }, [editor, compute, enabled, entryAttr]);

  // Bidirectional scroll sync
  useEffect(() => {
    if (!enabled || !editor) return;

    const editorScrollEl = editor.view?.dom?.closest(".overflow-y-auto") as HTMLElement | null;
    if (!editorScrollEl) return;

    let cleanupFns: (() => void)[] = [];

    const setup = () => {
      const panelEl = panelScrollRef.current;
      if (!panelEl) return false;

      const syncEditorToPanel = () => {
        if (syncingRef.current) return;
        syncingRef.current = true;
        const offset = topOffsetRef?.current ?? 0;
        panelEl.scrollTop = editorScrollEl.scrollTop + offset;
        requestAnimationFrame(() => { syncingRef.current = false; });
      };

      const syncPanelToEditor = () => {
        if (syncingRef.current) return;
        syncingRef.current = true;
        const offset = topOffsetRef?.current ?? 0;
        // When the panel is in the "above document" zone, pin editor to top
        editorScrollEl.scrollTop = Math.max(0, panelEl.scrollTop - offset);
        requestAnimationFrame(() => { syncingRef.current = false; });
      };

      editorScrollEl.addEventListener("scroll", syncEditorToPanel, { passive: true });
      panelEl.addEventListener("scroll", syncPanelToEditor, { passive: true });

      // Initial sync — retry a few times to handle late DOM layout
      const doSync = () => {
        const offset = topOffsetRef?.current ?? 0;
        panelEl.scrollTop = editorScrollEl.scrollTop + offset;
      };
      doSync();
      const t1 = setTimeout(doSync, 100);
      const t2 = setTimeout(doSync, 300);

      cleanupFns.push(() => { clearTimeout(t1); clearTimeout(t2); });
      cleanupFns.push(() => {
        editorScrollEl.removeEventListener("scroll", syncEditorToPanel);
        panelEl.removeEventListener("scroll", syncPanelToEditor);
      });
      return true;
    };

    // Try immediately, then retry until panel ref is attached
    if (!setup()) {
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if (setup() || attempts > 20) clearInterval(interval);
      }, 50);
      cleanupFns.push(() => clearInterval(interval));
    }

    return () => { cleanupFns.forEach((fn) => fn()); };
  }, [editor, enabled]);

  return { positions, editorScrollHeight, panelScrollRef };
}
