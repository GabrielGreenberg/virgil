"use client";

import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from "react";
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

/** Optional pin: force one card's `top` to a fixed pod-relative Y. Cards
 *  AFTER the pinned card in source-anchor-order cascade off the pinned
 *  card's bottom; cards BEFORE cascade upward off the pinned card's top.
 *  Net effect: the deck reflows around the pin without overlap. */
export interface Pinned {
  id: string;
  /** Pod-relative Y (px). Computed at publish time against the pod that
   *  hosts the absolute card wrappers — same coordinate space as the
   *  natural positions this hook returns. */
  pinTop: number;
}

/** Per-item measurement consumed by the pure cascade resolver. */
interface NaturalEntry {
  /** Pod-relative top from `coordsAtPos(pos).top - podRect.top`,
   *  clamped to 0 (negative values appear when an unanchored block sits
   *  above the pod). */
  naturalTop: number;
  /** Measured card height, or `DEFAULT_ENTRY_HEIGHT` if not yet rendered. */
  height: number;
}

/**
 * Pure-JS cascade resolver. Given measured natural positions + heights
 * and the current item list, returns a Map of final pod-relative Y
 * values. If `pinned` is set, the pinned card's position is forced to
 * `pinTop` and the cascade reflows in both directions to avoid overlap.
 *
 * This is the hot path on every pin change. NO DOM reads — operates
 * entirely on numbers measured separately.
 */
function resolveCascade(
  natural: Map<string, NaturalEntry>,
  items: ReadonlyArray<PositionItem>,
  pinned: Pinned | null,
): Map<string, number> {
  if (items.length === 0 || natural.size === 0) return new Map();

  // Build sorted list by natural top (so cascade-after is well-defined).
  // Skip items we haven't measured yet — they're not renderable.
  type Row = { id: string; top: number; height: number };
  const rows: Row[] = [];
  for (const it of items) {
    const nat = natural.get(it.id);
    if (!nat) continue;
    rows.push({ id: it.id, top: nat.naturalTop, height: nat.height });
  }
  rows.sort((a, b) => a.top - b.top);

  // Forward pass: push cards down to avoid overlap with their predecessor.
  // Apply the pin override mid-loop so cards AFTER the pinned one pack
  // below the pinned card's actual top, not below its natural top.
  for (let i = 0; i < rows.length; i++) {
    if (i > 0) {
      const prev = rows[i - 1];
      const minTop = prev.top + prev.height + MIN_GAP;
      if (rows[i].top < minTop) rows[i].top = minTop;
    }
    if (pinned && rows[i].id === pinned.id) {
      rows[i].top = pinned.pinTop;
    }
  }

  // Backward pass: when pinning moved the pinned card UP, cards anchored
  // BEFORE it can now overlap. Pull them upward (in source-anchor order,
  // bottom-up) until they clear. With `transform: translateY` positioning
  // this is essentially free; the deck stays symmetric around the pin
  // instead of overlapping on the upward side.
  if (pinned) {
    for (let i = rows.length - 1; i > 0; i--) {
      const cur = rows[i];
      const prev = rows[i - 1];
      const maxPrevTop = cur.top - prev.height - MIN_GAP;
      if (prev.top > maxPrevTop) prev.top = maxPrevTop;
    }
  }

  const map = new Map<string, number>();
  for (const r of rows) map.set(r.id, r.top);
  return map;
}

/**
 * Computes pod-relative Y positions for panel items so they align with
 * their corresponding paragraphs in the TipTap editor.
 *
 * Architecture: measurement and resolution are split.
 *
 *   1. **Measurement** (DOM-touching, slow): `coordsAtPos` per item and
 *      `getBoundingClientRect` per card. Writes a ref and bumps a
 *      version counter. Runs on editor content change, card-size change
 *      (ResizeObserver), window resize, or items-list change.
 *
 *   2. **Resolution** (pure JS, fast): cascade + optional pin override.
 *      Runs in `useMemo` on every render of the consumer. Pin changes
 *      flow through here in O(N) JS with no layout flush — that's the
 *      whole point: clicking a marker should not measure the DOM.
 *
 * Under the unified row scroll, the panel column and the editor column
 * share the same scroll source. Positions are computed pod-relative
 * (`coords.top - podRect.top`), which is scroll-invariant: both rects
 * shift by the same amount on natural scroll, so the cached map stays
 * correct without recompute.
 *
 * Returns:
 *   - `positions`: Map<id, topPx> in pod-relative coordinates. Render
 *     each card with `transform: translateY(${px}px)` inside a
 *     `position: relative` container of height `editorContentHeight`.
 *   - `editorContentHeight`: the editor view's natural DOM height, used
 *     to size the positioned region so the panel column extends through
 *     the document.
 *   - `panelScrollRef`: ref for the panel pod (the `position: relative`
 *     container hosting absolute children).
 */
export function useInTextPositions(
  editor: Editor | null,
  items: PositionItem[],
  enabled: boolean,
  entry: string | ((id: string) => string) = DEFAULT_ENTRY,
  pinned: Pinned | null = null,
) {
  const [editorContentHeight, setEditorContentHeight] = useState(0);
  const panelScrollRef = useRef<HTMLDivElement>(null);
  const naturalRef = useRef<Map<string, NaturalEntry>>(new Map());
  const [measureVersion, setMeasureVersion] = useState(0);
  const computeRafRef = useRef(0);

  const measure = useCallback(() => {
    if (!editor || !enabled || items.length === 0) {
      if (naturalRef.current.size > 0) {
        naturalRef.current = new Map();
        setMeasureVersion((v) => v + 1);
      }
      setEditorContentHeight(0);
      return;
    }

    const panelEl = panelScrollRef.current;
    if (!panelEl) return;

    const podRect = panelEl.getBoundingClientRect();
    const editorDom = editor.view.dom as HTMLElement;
    const nextContentHeight = editorDom.scrollHeight;
    setEditorContentHeight((prev) =>
      prev === nextContentHeight ? prev : nextContentHeight,
    );

    const next = new Map<string, NaturalEntry>();
    for (const item of items) {
      const pos = Math.min(item.pos, editor.state.doc.content.size);
      let naturalTop: number;
      try {
        const coords = editor.view.coordsAtPos(pos);
        naturalTop = coords.top - podRect.top;
      } catch {
        continue; // skip items with invalid positions
      }
      // Clamp negative tops. When an unanchored block (e.g. in
      // OmniViewPanel) sits above panelScrollRef, podRect.top is pushed
      // down past nodes near the top of the doc (notably titleField).
      // Without clamping, those cards get a negative `top` and render
      // upward into the unanchored block — visual overlap.
      if (naturalTop < 0) naturalTop = 0;

      // Measure rendered card height. Cards not yet rendered fall back
      // to DEFAULT_ENTRY_HEIGHT; their resize observer (below) will
      // re-trigger measure once they paint.
      const selector =
        typeof entry === "string" ? `[${entry}="${item.id}"]` : entry(item.id);
      const el = panelEl.querySelector(selector) as HTMLElement | null;
      const height = el ? el.getBoundingClientRect().height : DEFAULT_ENTRY_HEIGHT;

      next.set(item.id, { naturalTop, height });
    }

    naturalRef.current = next;
    setMeasureVersion((v) => v + 1);
  }, [editor, items, enabled, entry]);

  // Trigger measurement on editor updates, viewport resize, editor
  // content-height changes, and on the next paint after items change.
  // useLayoutEffect so the first measure runs synchronously after commit;
  // setMeasureVersion schedules a re-render that picks up the new natural
  // data via the useMemo below.
  useLayoutEffect(() => {
    if (!enabled) {
      if (naturalRef.current.size > 0) {
        naturalRef.current = new Map();
        setMeasureVersion((v) => v + 1);
      }
      return;
    }

    measure();

    if (!editor) return;

    const onUpdate = () => {
      cancelAnimationFrame(computeRafRef.current);
      computeRafRef.current = requestAnimationFrame(measure);
    };

    editor.on("update", onUpdate);
    window.addEventListener("resize", onUpdate);

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
  }, [editor, measure, enabled]);

  // Observe card-size changes (e.g. bibliography pod expanding) so the
  // cascade reflows correctly. Dep on `measureVersion` so we re-observe
  // whenever cards mount/unmount.
  useEffect(() => {
    if (!enabled) return;
    const panelEl = panelScrollRef.current;
    if (!panelEl || typeof ResizeObserver === "undefined") return;
    const onResize = () => {
      cancelAnimationFrame(computeRafRef.current);
      computeRafRef.current = requestAnimationFrame(measure);
    };
    const obs = new ResizeObserver(onResize);
    const bareAttr = typeof entry === "string" ? entry : "data-link-card";
    panelEl.querySelectorAll(`[${bareAttr}]`).forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [measureVersion, enabled, entry, measure]);

  // Pure-JS resolution. On a pin change, this is the ONLY thing that
  // re-runs — no DOM reads, no layout flush, no second commit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const positions = useMemo(
    () => resolveCascade(naturalRef.current, items, pinned),
    [measureVersion, items, pinned],
  );

  return { positions, editorContentHeight, panelScrollRef };
}
