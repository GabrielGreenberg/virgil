"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { isAnchorableNode } from "@/lib/marginalia";
import { getLinkedParagraphIds } from "@/links/links";
import type { Link } from "@/links/_shared/types";

export interface PositionItem {
  id: string;
  pos: number; // ProseMirror document position
}

/**
 * Helper: extract positions for link-anchored items. Uses the first
 * paragraph in each card's `links` array to resolve a doc position.
 */
export function getParagraphAnchorPositions(
  editor: Editor | null,
  items?: ReadonlyArray<{ id: string; links?: Link[] }>,
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
    const pids = getLinkedParagraphIds(it);
    if (pids.length > 0) {
      const pos = uuidToPos.get(pids[0]);
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

// Module-level default so callers that don't pass `entry` get a stable
// reference. An inline `entry = (id) => ...` default recreates the
// function on every call, which breaks the useCallback identity for
// `compute` and in turn loops the effect that watches it.
const DEFAULT_ENTRY = (id: string) => `[data-link-card$=":${id}"]`;

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
  /**
   * Strategy for querying the rendered DOM element for each item, used
   * to measure its height for overlap resolution.
   *
   * - A string: an attribute name whose value equals `item.id`.
   *   Example: `"data-omni-entry"` matches `<div data-omni-entry="id">`.
   * - A function: builds the CSS selector for a given item id.
   *   Example: `(id) => \`[data-link-card="note:${id}"]\``.
   *
   * Default: `(id) => \`[data-link-card$=":${id}"]\`` — matches any
   * panel card regardless of its card kind (reads `data-link-card`
   * per the Link Architecture DOM contract).
   */
  entry: string | ((id: string) => string) = DEFAULT_ENTRY,
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
        const selector =
          typeof entry === "string" ? `[${entry}="${r.id}"]` : entry(r.id);
        const el = panelEl.querySelector(selector) as HTMLElement | null;
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
  }, [editor, items, enabled, ready, entry]);

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
        // Observe every rendered card entry. For a function selector we
        // don't have a bare-attribute form, so fall back to
        // `data-link-card` which the Link Architecture guarantees on
        // every panel card.
        const bareAttr = typeof entry === "string" ? entry : "data-link-card";
        panelEl.querySelectorAll(`[${bareAttr}]`).forEach((el) => {
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
  }, [editor, compute, enabled, entry]);

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
        // Skip when an external caller (e.g. click-to-align on a panel card)
        // has flagged this scroll as programmatic. Without this, aligning a
        // card in the panel would drag the editor's main text along with it.
        if (panelEl.dataset.virgilSuppressReverseSync === "1") return;
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
