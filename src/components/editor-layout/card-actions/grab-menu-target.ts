/**
 * The grab menu's LIVE target (task 737).
 *
 * The grab menu never takes focus and never blocks the document — by design.
 * So the document keeps moving underneath it: a collaborator's edit, an agent
 * write, the user's own keystrokes. Everything the menu knew used to be a
 * snapshot taken at open — the selection's `from`/`to` numbers, the handle's
 * one-shot `getBoundingClientRect()`, and the rows' greyed state — and nothing
 * re-resolved it. Delete/Archive then acted on whatever text had shifted into
 * those numbers (a clamp keeps positions in RANGE, not on the same TEXT), the
 * menu stayed parked over a block it no longer pointed at, and a row enabled at
 * open stayed clickable after the document made it invalid.
 *
 * One premise, one owner: while the menu is open it FOLLOWS the document.
 *
 *   • RANGE — the target's span is mapped forward through every transaction's
 *     steps (and its `appendedTransactions`'), O(steps) per transaction — the
 *     positional primitive `float-source-range.ts` already uses for the same
 *     async-gap problem. A node ref keeps addressing by uuid (dispatch resolves
 *     it live); its mapped span only feeds the anchor. A SELECTION ref has no
 *     identity but its span, so the span IS the identity: it is re-issued with
 *     mapped numbers, and a step that changes text INSIDE it (or swallows it)
 *     makes the target STALE — the text the menu was opened on no longer
 *     exists as such. Stale closes the menu, and `current()` returns null so a
 *     click racing the close refuses instead of acting.
 *   • ANCHOR — the menu's rect is re-derived from the target's live position
 *     (keeping the handle's gutter x and its offset from the target), passed
 *     both as the anchor (re-solved after each document change) and as
 *     `trackAnchor` (the provider's RAF-coalesced scroll/resize re-anchor). A
 *     target scrolled out of the viewport closes the menu rather than leaving
 *     it clamped over some other block.
 *   • GREY-OUT — each followed transaction bumps a version (RAF-coalesced, ≤1
 *     render per frame) the rows memo keys on, so `applies()` is re-asked of
 *     the document as it now is.
 *
 * Keystroke sanctity: the subscription exists only while the menu is MOUNTED
 * (open) — the closed menu costs nothing. The handler is O(steps); the RAF body
 * is one `coordsAtPos`/`nodeDOM` read plus the rows' `applies()` (per-kind /
 * O(depth)), never a document walk. The one uuid walk that seeds a node ref's
 * span runs ONCE, at open.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { findLinkedAnchorRange } from "@/lib/linked-anchor-range";
import { selectionOwnerId } from "@/text-objects/selection-payload";
import { TEXT_OBJECT_REGISTRY, isTextObjectKind } from "@/text-objects/text-object-registry";
import type { DragHandleRef } from "./drag-handle-actions";

/** A half-open document span `[from, to)`. */
export interface GrabSpan {
  from: number;
  to: number;
}

/** The followed state of one open menu's target. */
export interface GrabTargetState {
  /** The target's span in the CURRENT document, or null when it could not be
   *  located at open (anchor falls back to the static rect; nothing closes). */
  span: GrabSpan | null;
  /** The text/object the menu was opened on no longer exists as such. */
  stale: boolean;
}

/**
 * Seed the target's span at open. A selection is its own span; a range kind is
 * its mark's bounds; a node kind is the node's bounds, found by uuid — the one
 * walk this module makes, once per open.
 */
export function initialGrabSpan(doc: PMNode, ref: DragHandleRef): GrabSpan | null {
  if (ref.kind === "selection") {
    const size = doc.content.size;
    const from = Math.max(0, Math.min(ref.from, size));
    const to = Math.max(0, Math.min(ref.to, size));
    return to > from ? { from, to } : null;
  }
  if (!isTextObjectKind(ref.kind)) return null;
  if (TEXT_OBJECT_REGISTRY[ref.kind].isRange) {
    const markType = doc.type.schema.marks.linkedAnchor;
    return markType ? findLinkedAnchorRange(doc, ref.id, markType) : null;
  }
  let found: GrabSpan | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === ref.kind && (node.attrs?.uuid as string | null) === ref.id) {
      found = { from: pos, to: pos + node.nodeSize };
      return false;
    }
    return true;
  });
  return found;
}

/**
 * Follow a target through the transactions of one dispatch. O(steps).
 *
 * The span maps with the node-range convention (`from` assoc +1, `to` assoc
 * −1): content inserted AT either boundary lands outside it. Staleness differs
 * by kind:
 *   • selection — any step that changed positions strictly INSIDE the span (an
 *     insert at an interior point, a delete overlapping it) means the selected
 *     text is not the text the menu was opened on. Mark-only steps (bold, a
 *     highlight) leave the text itself intact and do not count.
 *   • node / range — the uuid is the identity, so edits inside are fine; only
 *     a span that COLLAPSED (the object was deleted or moved away) is stale.
 */
export function followGrabTarget(
  ref: DragHandleRef,
  state: GrabTargetState,
  trs: readonly Transaction[],
): GrabTargetState {
  if (state.stale || !state.span) return state;
  let { from, to } = state.span;
  let stale = false;
  for (const tr of trs) {
    if (!tr.docChanged) continue;
    for (const map of tr.mapping.maps) {
      if (ref.kind === "selection" && !stale) {
        map.forEach((oldStart, oldEnd) => {
          if (oldStart < to && oldEnd > from) stale = true;
        });
      }
      from = map.map(from, 1);
      to = map.map(to, -1);
    }
  }
  if (to <= from) return { span: { from, to: from }, stale: true };
  return { span: { from, to }, stale };
}

/**
 * The ref to act on NOW. A node ref addresses by uuid and is returned as-is; a
 * selection ref is re-issued at its mapped span with its owning block re-read
 * (O(depth)) — a split before the selection can hand it a new owner.
 */
export function liveGrabRef(
  ref: DragHandleRef,
  state: GrabTargetState,
  doc: PMNode,
): DragHandleRef | null {
  if (state.stale) return null;
  if (ref.kind !== "selection" || !state.span) return ref;
  const { from, to } = state.span;
  if (from === ref.from && to === ref.to) return ref;
  return {
    kind: "selection",
    from,
    to,
    paragraphId: selectionOwnerId(doc, from) ?? ref.paragraphId,
  };
}

type RectLike = { left: number; top: number; right: number; bottom: number; width: number; height: number };

function toRectLike(r: RectLike): RectLike {
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
}

/** The target's live top edge in client coordinates, or null. One layout read. */
function targetTop(editor: Editor, ref: DragHandleRef, span: GrabSpan): number | null {
  const view = editor.view;
  try {
    if (ref.kind !== "selection") {
      const dom = view.nodeDOM(span.from);
      if (dom instanceof Element) return dom.getBoundingClientRect().top;
    }
    return view.coordsAtPos(span.from).top;
  } catch {
    return null;
  }
}

export interface LiveGrabTarget {
  /** The ref to render the rows against — re-issued after each followed
   *  document change (RAF-coalesced). */
  ref: DragHandleRef;
  /** The ref to act on at CLICK time — always current, never RAF-delayed.
   *  Null when the target went stale (the caller refuses). */
  current: () => DragHandleRef | null;
  /** The menu's anchor, re-derived after each followed document change. */
  anchorRect: RectLike;
  /** The provider's RAF-coalesced scroll/resize re-anchor thunk. */
  trackAnchor: () => RectLike | null;
  /** Bumps once per frame in which the document changed — the rows memo key. */
  version: number;
}

/**
 * Follow the open grab menu's target through the live document. Mount it
 * inside the menu (the menu's lifetime IS the subscription's).
 */
export function useLiveGrabTarget(
  editor: Editor | null | undefined,
  ref: DragHandleRef | undefined,
  anchorRect: RectLike,
  onStale: () => void,
): LiveGrabTarget | null {
  // Seeded ONCE per (editor, ref): the open. The ref's identity is the menu's
  // opening — EditorPane stores it at open and never re-issues it.
  const seed = useMemo(() => {
    if (!editor || !ref || editor.isDestroyed) return null;
    const span = initialGrabSpan(editor.state.doc, ref);
    const state: GrabTargetState = { span, stale: false };
    const top0 = span ? targetTop(editor, ref, span) : null;
    // The handle sits in the gutter beside its target: keep its x, and keep its
    // vertical offset from the target so the re-anchored menu opens where the
    // original one did.
    const dy = top0 == null ? null : anchorRect.top - top0;
    return { state, dy };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seeded at open; the rect is read once with it
  }, [editor, ref]);

  const stateRef = useRef<GrabTargetState | null>(seed?.state ?? null);
  // The RENDERED copy of the followed state — published at most once per frame
  // (the RAF below), so rows and anchor re-derive against the document as it
  // now is without reading the ref during render.
  const [followed, setFollowed] = useState<{ state: GrabTargetState | null; version: number }>(
    () => ({ state: seed?.state ?? null, version: 0 }),
  );
  const version = followed.version;
  const onStaleRef = useRef(onStale);
  useEffect(() => {
    onStaleRef.current = onStale;
  }, [onStale]);

  const rectAt = useCallback((state: GrabTargetState | null): RectLike | null => {
    if (!editor || !ref || !seed || seed.dy == null || !state?.span || state.stale) return null;
    if (editor.isDestroyed) return null;
    const top = targetTop(editor, ref, state.span);
    if (top == null) return null;
    const t = top + seed.dy;
    return {
      left: anchorRect.left,
      right: anchorRect.right,
      width: anchorRect.width,
      height: anchorRect.height,
      top: t,
      bottom: t + anchorRect.height,
    };
  }, [editor, ref, seed, anchorRect]);

  useEffect(() => {
    stateRef.current = seed?.state ?? null;
    if (!editor || !ref || !seed) return;
    let raf: number | null = null;
    const handler = ({
      transaction,
      appendedTransactions,
    }: {
      transaction: Transaction;
      appendedTransactions?: Transaction[];
    }) => {
      const prev = stateRef.current;
      if (!prev || prev.stale) return;
      const all = appendedTransactions?.length ? [transaction, ...appendedTransactions] : [transaction];
      if (!all.some((tr) => tr.docChanged)) return;
      const next = followGrabTarget(ref, prev, all);
      stateRef.current = next;
      if (next.stale) {
        onStaleRef.current();
        return;
      }
      if (raf != null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const state = stateRef.current;
        setFollowed((f) => ({ state, version: f.version + 1 }));
      });
    };
    editor.on("transaction", handler);
    return () => {
      editor.off("transaction", handler);
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [editor, ref, seed]);

  // The scroll/resize re-anchor. A target that left the viewport closes the
  // menu — clamped to the edge, it would sit over some other block.
  const trackAnchor = useCallback((): RectLike | null => {
    const r = rectAt(stateRef.current);
    if (!r) return null;
    const vh = typeof window === "undefined" ? Infinity : window.innerHeight;
    if (r.bottom < 0 || r.top > vh) {
      queueMicrotask(() => onStaleRef.current());
      return null;
    }
    return r;
  }, [rectAt]);

  // Re-derived once per followed frame (`version`) — the static anchor the
  // provider re-solves against when the document reflows under a still pane.
  const liveRect = useMemo(
    () => rectAt(followed.state) ?? toRectLike(anchorRect),
    [rectAt, followed.state, anchorRect],
  );

  const liveRef = useMemo(() => {
    const state = followed.state;
    if (!editor || !ref || !state) return ref;
    return liveGrabRef(ref, state, editor.state.doc) ?? ref;
  }, [editor, ref, followed.state]);

  const current = useCallback((): DragHandleRef | null => {
    const state = stateRef.current;
    if (!ref) return null;
    if (!editor || !state) return ref;
    return liveGrabRef(ref, state, editor.state.doc);
  }, [editor, ref]);

  return useMemo(
    () =>
      editor && ref && liveRef
        ? { ref: liveRef, current, anchorRect: liveRect, trackAnchor, version }
        : null,
    [editor, ref, liveRef, current, liveRect, trackAnchor, version],
  );
}
