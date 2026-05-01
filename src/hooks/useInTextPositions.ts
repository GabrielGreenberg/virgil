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
 * with their corresponding positions in the TipTap editor, and visually
 * tracks the editor's scroll via a single GPU transform.
 *
 * The panel container (the element whose ref is `panelScrollRef`) is
 * meant to be `overflow: hidden` — it does NOT scroll natively. Wheel
 * events that hit it are forwarded to the editor's scroll container so
 * the editor remains the single source of truth for vertical position.
 *
 * The element whose ref is `transformTargetRef` receives a per-frame
 * `transform: translate3d(0, -editorScrollTop, 0)`, applied imperatively
 * inside a single RAF loop. Because the editor's compositor scroll and
 * our transform write land in the same frame, the editor's content and
 * the panel's transformed wrapper paint together — there is no
 * opportunity for desync.
 *
 * Returns:
 *   - `positions`: Map<id, topPx>, in editor-relative coordinates (use
 *     with `position: absolute; top: ${px}` inside a relative container
 *     of height `editorScrollHeight`).
 *   - `editorScrollHeight`: the editor's scrollHeight, used to size the
 *     positioned region.
 *   - `panelScrollRef`: ref for the panel wrapper (overflow: hidden;
 *     wheel-forwarding listener is attached here).
 *   - `transformTargetRef`: ref for the inner element that gets
 *     translated each frame. Wrap both unanchored content and the
 *     positioned region inside this element.
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
) {
  const [positions, setPositions] = useState<Map<string, number>>(new Map());
  const [editorScrollHeight, setEditorScrollHeight] = useState(0);
  const panelScrollRef = useRef<HTMLDivElement>(null);
  const transformTargetRef = useRef<HTMLDivElement>(null);
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
      setEditorScrollHeight(0);
      return;
    }

    const scrollEl = editor.view.dom.closest(".overflow-y-auto") as HTMLElement | null;
    if (!scrollEl) {
      setPositions(new Map());
      return;
    }

    const scrollRect = scrollEl.getBoundingClientRect();
    const nextScrollHeight = scrollEl.scrollHeight;
    setEditorScrollHeight(prev => prev === nextScrollHeight ? prev : nextScrollHeight);

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

  // Recompute on editor changes and viewport resize. Scroll alone does not
  // change positions (the formula `coords.top - viewTop + scrollTop` is
  // scroll-invariant), so we intentionally don't listen for scroll here —
  // the per-frame transform sync below handles visual tracking.
  useEffect(() => {
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

    return () => {
      cancelAnimationFrame(computeRafRef.current);
      editor.off("update", onUpdate);
      window.removeEventListener("resize", onUpdate);
    };
  }, [editor, compute, enabled]);

  // Observe card size changes (e.g. bibliography pod expanding) so we can
  // re-resolve overlaps. Depends on `positions` because cards only render
  // once positions has entries for them — running after that state commits
  // guarantees the cards are in the DOM when we querySelectorAll.
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

  // Per-frame visual sync: read editor scrollTop and translate the
  // transform target. The browser commits the editor's compositor scroll
  // before RAF callbacks run, so reading `scrollTop` here returns the
  // value about to be painted; writing `transform` lands in the same
  // frame. Editor and panel paint together — no compositor-vs-main-thread
  // race that the previous `scrollTop`-write approach suffered from.
  //
  // Wheel forwarding: the panel wrapper is `overflow: hidden`, so wheel
  // events on it don't scroll anything natively. We capture them and
  // increment editor scrollTop directly so the editor remains the single
  // scroll source.
  useEffect(() => {
    if (!enabled || !editor || editor.isDestroyed) return;

    let editorScrollEl: HTMLElement | null = null;
    try {
      editorScrollEl = (editor.view?.dom?.closest(".overflow-y-auto") as HTMLElement | null) ?? null;
    } catch {
      return;
    }
    if (!editorScrollEl) return;

    const panelEl = panelScrollRef.current;
    const targetEl = transformTargetRef.current;
    if (!panelEl || !targetEl) return;

    // Initial sync: before the first RAF runs, set transform to match
    // current scrollTop so we don't paint a frame at scroll = 0.
    targetEl.style.willChange = "transform";
    targetEl.style.transform = `translate3d(0, ${-editorScrollEl.scrollTop}px, 0)`;

    let lastTy = -editorScrollEl.scrollTop;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      // editorScrollEl is non-null inside the closure (early returned above)
      const ty = -editorScrollEl!.scrollTop;
      if (ty !== lastTy) {
        lastTy = ty;
        targetEl.style.transform = `translate3d(0, ${ty}px, 0)`;
      }
    };
    raf = requestAnimationFrame(tick);

    // Wheel forwarding. passive: false so we can preventDefault and own
    // the gesture. Cmd/Ctrl-wheel passes through (browser pinch-zoom).
    // Horizontal wheel/Shift+wheel is dropped — editor doesn't scroll
    // horizontally, so forwarding sideways nudges would feel wrong.
    const lineHeight =
      parseFloat(getComputedStyle(editor.view.dom).lineHeight) || 16;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= lineHeight;
      else if (e.deltaMode === 2) dy *= editorScrollEl!.clientHeight;
      editorScrollEl!.scrollTop += dy;
    };
    panelEl.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(raf);
      panelEl.removeEventListener("wheel", onWheel);
      if (targetEl) {
        targetEl.style.transform = "";
        targetEl.style.willChange = "";
      }
    };
  }, [editor, enabled, ready]);

  return { positions, editorScrollHeight, panelScrollRef, transformTargetRef };
}
