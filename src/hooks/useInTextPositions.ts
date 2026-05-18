"use client";

import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
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

const DEFAULT_ENTRY = (id: string) => `[data-link-card$=":${id}"]`;

/**
 * Computes Y positions for panel items so they align with their
 * corresponding paragraphs in the TipTap editor.
 *
 * Under the unified row scroll (A.1+A.2), the panel column and the editor
 * column share the same scroll source — both move together. So positions
 * are computed relative to the panel pod's own bounding rect:
 * `coords.top - podRect.top`. This is scroll-invariant: as the row scrolls,
 * both `coords.top` (paragraph) and `podRect.top` (omni pod) shift by the
 * same amount.
 *
 * Returns:
 *   - `positions`: Map<id, topPx> in pod-relative coordinates (use with
 *     `position: absolute; top: ${px}` inside a `position: relative`
 *     container of height `editorContentHeight`).
 *   - `editorContentHeight`: the editor view's natural DOM height,
 *     used to size the positioned region so the panel column extends
 *     through the document.
 *   - `panelScrollRef`: ref for the panel pod (the `position: relative`
 *     container hosting absolute children).
 */
/** Optional pin: force one card's `top` to a fixed viewport-Y (converted
 *  to pod-relative inside compute). Cards AFTER the pinned card in
 *  source-anchor-order cascade off the pinned card's bottom, so the deck
 *  reflows to make room. Cards BEFORE are unaffected. */
export interface Pinned {
  id: string;
  /** Viewport Y (in px). */
  clickY: number;
}

export function useInTextPositions(
  editor: Editor | null,
  items: PositionItem[],
  enabled: boolean,
  entry: string | ((id: string) => string) = DEFAULT_ENTRY,
  pinned: Pinned | null = null,
) {
  const [positions, setPositions] = useState<Map<string, number>>(new Map());
  const [editorContentHeight, setEditorContentHeight] = useState(0);
  const panelScrollRef = useRef<HTMLDivElement>(null);
  const computeRafRef = useRef(0);

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
      setEditorContentHeight(0);
      return;
    }

    const panelEl = panelScrollRef.current;
    if (!panelEl) {
      setPositions(new Map());
      return;
    }

    const podRect = panelEl.getBoundingClientRect();
    const editorDom = editor.view.dom as HTMLElement;
    const nextContentHeight = editorDom.scrollHeight;
    setEditorContentHeight(prev =>
      prev === nextContentHeight ? prev : nextContentHeight,
    );

    // Compute positions using coordsAtPos for all items.
    // ProseMirror renders all nodes to the DOM (no virtualization),
    // so coordsAtPos works for the entire document.
    const raw: Array<{ id: string; top: number }> = [];
    for (const item of items) {
      const pos = Math.min(item.pos, editor.state.doc.content.size);
      try {
        const coords = editor.view.coordsAtPos(pos);
        // Pod-relative Y (scroll-invariant).
        const top = coords.top - podRect.top;
        raw.push({ id: item.id, top });
      } catch {
        // Skip items with invalid positions
      }
    }

    raw.sort((a, b) => a.top - b.top);

    // Clamp negative tops to 0. When an unanchored block (e.g. in
    // OmniViewPanel) sits above panelScrollRef, podRect.top is pushed
    // down past nodes near the top of the doc (notably titleField).
    // Without clamping, those cards get a negative `top` and render
    // upward into the unanchored block — visual overlap. The cascade
    // below then spaces multiple clamped cards apart.
    for (const r of raw) if (r.top < 0) r.top = 0;

    // Measure rendered entry heights from the DOM for accurate overlap resolution
    const entryHeights = new Map<string, number>();
    for (const r of raw) {
      const selector =
        typeof entry === "string" ? `[${entry}="${r.id}"]` : entry(r.id);
      const el = panelEl.querySelector(selector) as HTMLElement | null;
      if (el) {
        entryHeights.set(r.id, el.getBoundingClientRect().height);
      }
    }

    // Resolve overlaps — push items down so they don't overlap.
    // Pin: when we hit the pinned card, force its top to the pin Y AFTER
    // its own cascade-from-above (so cards BEFORE pinned are not pushed
    // up) but BEFORE the next iteration (so cards AFTER pinned see pin
    // Y + heightOfPinned as their minTop and pack below the pin). Net
    // effect: the deck reflows around the pin instead of overlapping.
    const pinTop = pinned ? pinned.clickY - podRect.top : null;
    for (let i = 0; i < raw.length; i++) {
      if (i > 0) {
        const prevHeight = entryHeights.get(raw[i - 1].id) || DEFAULT_ENTRY_HEIGHT;
        const minTop = raw[i - 1].top + prevHeight + MIN_GAP;
        if (raw[i].top < minTop) raw[i].top = minTop;
      }
      if (pinned && pinTop !== null && raw[i].id === pinned.id) {
        raw[i].top = pinTop;
      }
    }

    const map = new Map<string, number>();
    for (const r of raw) {
      map.set(r.id, r.top);
    }
    setPositions(map);
  }, [editor, items, enabled, ready, entry, pinned]);

  // Recompute on editor changes, viewport resize, and editor content
  // height changes. Positions are scroll-invariant (formula uses
  // viewport-relative coords on both sides, so scroll cancels out).
  //
  // useLayoutEffect (not useEffect): when `pinned` changes, `compute`'s
  // identity changes (it's in compute's useCallback deps), so this
  // effect re-runs. With useLayoutEffect, compute runs synchronously
  // after the render commit, before paint — setPositions schedules a
  // second render+commit, all before paint, so the user never sees a
  // frame of stale positions. With useEffect (passive), the user would
  // see one frame of old positions before compute catches up.
  useLayoutEffect(() => {
    if (!enabled) {
      setPositions(new Map());
      return;
    }

    compute();

    if (!editor) return;

    const onUpdate = () => {
      cancelAnimationFrame(computeRafRef.current);
      computeRafRef.current = requestAnimationFrame(compute);
    };

    editor.on("update", onUpdate);
    window.addEventListener("resize", onUpdate);

    // Watch editor content height — paragraphs added/removed change the
    // layout in ways `update` may not catch (e.g. async images loading).
    let editorObs: ResizeObserver | null = null;
    try {
      const editorDom = editor.view?.dom as HTMLElement | undefined;
      if (editorDom && typeof ResizeObserver !== "undefined") {
        editorObs = new ResizeObserver(onUpdate);
        editorObs.observe(editorDom);
      }
    } catch {
      // ignore
    }

    return () => {
      cancelAnimationFrame(computeRafRef.current);
      editor.off("update", onUpdate);
      window.removeEventListener("resize", onUpdate);
      editorObs?.disconnect();
    };
  }, [editor, compute, enabled]);

  // Observe card size changes (e.g. bibliography pod expanding) so we can
  // re-resolve overlaps. Depends on `positions` because cards only render
  // once positions has entries for them.
  useEffect(() => {
    if (!enabled) return;
    const panelEl = panelScrollRef.current;
    if (!panelEl || typeof ResizeObserver === "undefined") return;
    const onResize = () => {
      cancelAnimationFrame(computeRafRef.current);
      computeRafRef.current = requestAnimationFrame(compute);
    };
    const obs = new ResizeObserver(onResize);
    const bareAttr = typeof entry === "string" ? entry : "data-link-card";
    panelEl.querySelectorAll(`[${bareAttr}]`).forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [positions, enabled, entry, compute]);

  return { positions, editorContentHeight, panelScrollRef };
}
