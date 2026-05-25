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
  /** editorRect.right - paddingRight — the editor's right text edge. */
  editorRight: number;
  scrollParent: HTMLElement | null;
  scrollTop: number;
  scrollBottom: number;
  /** Pixels read from --gutter-col-handle-inset on the editor element.
   *  TextObjectGrabHandle parks top-level handles at contentLeft −
   *  gutterInset (see src/text-objects/handle-layout.ts). Read here
   *  so JS placement and CSS chrome share one source. */
  gutterInset: number;
}

const DEFAULT_GUTTER_INSET = 22;

const EMPTY_CACHE: EditorViewportCache = {
  editorEl: null,
  editorRight: 0,
  scrollParent: null,
  scrollTop: 0,
  scrollBottom: 0,
  gutterInset: DEFAULT_GUTTER_INSET,
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
      const padRight = parseFloat(cs.paddingRight) || 0;
      const scrollParent = findScrollParent(editorEl);
      const scrollRect = scrollParent
        ? scrollParent.getBoundingClientRect()
        : { top: 0, bottom: window.innerHeight };
      const editorRight = rect.right - padRight;
      const scrollTop = scrollRect.top;
      const scrollBottom = scrollRect.bottom;
      const insetRaw = cs.getPropertyValue("--gutter-col-handle-inset").trim();
      const parsedInset = parseFloat(insetRaw);
      const gutterInset = Number.isFinite(parsedInset) && parsedInset > 0
        ? parsedInset
        : DEFAULT_GUTTER_INSET;
      const prev = cacheRef.current;
      if (
        prev.editorEl === editorEl &&
        prev.editorRight === editorRight &&
        prev.scrollParent === scrollParent &&
        prev.scrollTop === scrollTop &&
        prev.scrollBottom === scrollBottom &&
        prev.gutterInset === gutterInset
      ) {
        return;
      }
      cacheRef.current = {
        editorEl,
        editorRight,
        scrollParent,
        scrollTop,
        scrollBottom,
        gutterInset,
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
