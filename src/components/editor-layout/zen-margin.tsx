"use client";

import { useEffect, useId, useRef } from "react";
import { usePaneResizeHandle, onLayoutGestureSetChange } from "@/lib/pane-resize";
import type { Side } from "@/hooks/useViewPrefs";

/**
 * Empty page margin shown on each side of the editor in Zen mode, in
 * place of the icon strip + panel column that would normally live there.
 * The inner edge (toward the editor) is a drag handle — dragging toward
 * center shrinks the page and grows this margin's preferred size in
 * lockstep, so the edge stays glued to the cursor. The other margin is
 * unaffected. The margin itself flexes to fill whatever window space
 * remains after icons + page + opposite margin.
 */
export function ZenMargin({
  side,
  marginPref,
  onMarginPrefChange,
  isResizing,
  onResizingChange,
  onSyncBeforeDrag,
}: {
  side: Side;
  marginPref: number;
  onMarginPrefChange: (w: number) => void;
  isResizing?: boolean;
  onResizingChange?: (r: boolean) => void;
  onSyncBeforeDrag?: () => void;
}) {
  const colRef = useRef<HTMLDivElement>(null);
  // Instance-unique gesture id — keep-alive doc panes mount a ZenMargin per
  // side each, so a bare side-keyed id would fire every same-side instance's
  // bus-edge listener (below) on a foreign gesture.
  const reactId = useId();
  const gestureId = `zen-margin-${side}-${reactId}`;

  // Per-gesture pointer-UX clamp + start width, snapshotted once in
  // getValue() (the engine's single start-edge read point). The reserved
  // widths (opposite margin's flex-basis, editor min) don't change during
  // the gesture, so the snapshot is equivalent to the old per-move
  // re-measure.
  const clampRef = useRef({ min: 0, max: Number.POSITIVE_INFINITY });
  const startRef = useRef(0);

  // Cancel / zero-move re-sync from the source of truth (the marginPref
  // prop): mid-drag React renders `flex: 0 0 ${marginPref}px` (isResizing is
  // true for the whole gesture), so writing that exact value re-converges
  // DOM and props; the end edge's isResizing→false render then swaps in the
  // resting `1 100` flex itself (the prop string changes, so React rewrites).
  const restoreFlex = () => {
    const col = colRef.current;
    if (col) col.style.flex = `0 0 ${marginPref}px`;
  };

  const handle = usePaneResizeHandle({
    id: gestureId,
    axis: "x",
    // The right margin grows as the pointer moves LEFT (toward the origin).
    direction: side === "right" ? -1 : 1,
    getValue: () => {
      const col = colRef.current;
      const rendered = col?.getBoundingClientRect().width ?? marginPref;
      const marginMin = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--zen-margin-min'),
      ) || 0;
      let max = Number.POSITIVE_INFINITY;
      const main = col?.parentElement;
      if (col && main) {
        const editor = main.querySelector('[data-editor-col]') as HTMLElement | null;
        const editorMin = editor ? (parseFloat(getComputedStyle(editor).minWidth) || 0) : 0;
        let reserved = editorMin;
        for (const child of Array.from(main.children)) {
          if (child !== col && child !== editor) {
            const el = child as HTMLElement;
            const basis = parseFloat(getComputedStyle(el).flexBasis);
            reserved += Number.isFinite(basis) ? basis : el.getBoundingClientRect().width;
          }
        }
        max = Math.max(0, main.clientWidth - reserved);
      }
      clampRef.current = { min: marginMin, max };
      startRef.current = rendered;
      return rendered;
    },
    clamp: (px) =>
      Math.max(clampRef.current.min, Math.min(clampRef.current.max, px)),
    // Live geometry is an imperative flex-basis write — one RAF-coalesced
    // style write per frame. The old path ran onMarginPrefChange →
    // useZenMode._persist → localStorage per mousemove.
    apply: (px) => {
      const col = colRef.current;
      if (col) col.style.flex = `0 0 ${px}px`;
    },
    commit: (px) => {
      // Zero-move end (plain click / drag returned to start): don't write
      // prefs; re-sync the DOM from the store in case applies happened.
      if (px === startRef.current) {
        restoreFlex();
        return;
      }
      onMarginPrefChange(px);
    },
    restore: restoreFlex,
  });

  // Gesture-edge side effects (sync prefs to rendered, lift the flex to the
  // pinned `0 0` shape via isResizing) ride the pane-drag bus filtered to
  // THIS instance's gesture — the end edge fires on every end variant incl.
  // owner unmount, so isResizing can never wedge true. Declared AFTER
  // usePaneResizeHandle: unmount cleanups run in declaration order, so the
  // engine's detach end-edge fires while this listener is still subscribed.
  const onResizingChangeRef = useRef(onResizingChange);
  const onSyncBeforeDragRef = useRef(onSyncBeforeDrag);
  useEffect(() => {
    // Latest-prop mirrors, refreshed post-commit (a render-time ref write
    // trips react-hooks/refs). The listener only fires from pointer events,
    // which can't interleave before this effect runs.
    onResizingChangeRef.current = onResizingChange;
    onSyncBeforeDragRef.current = onSyncBeforeDrag;
  });
  useEffect(
    () =>
      // The SET channel, not the outermost-edge channel: an id filter on the
      // latter strands `isResizing` when gestures overlap (this gesture's end
      // is swallowed while another is live and its edge arrives carrying a
      // different info). Here every gesture's own begin AND end always
      // arrive, so the id filter is sound.
      onLayoutGestureSetChange((began, info) => {
        if (info.id !== gestureId) return;
        if (began) {
          onSyncBeforeDragRef.current?.();
          onResizingChangeRef.current?.(true);
        } else {
          onResizingChangeRef.current?.(false);
        }
      }),
    [gestureId],
  );

  return (
    <div ref={colRef} data-flex-col={side} className="relative flex" style={{ flex: isResizing ? `0 0 ${marginPref}px` : `1 100 ${marginPref}px`, minWidth: isResizing ? 0 : 'var(--zen-margin-min)', paddingTop: 'var(--pod-gap)', paddingBottom: 'var(--pod-gap)', paddingLeft: 4, paddingRight: 4 }}>
      <div className={`flex-1 min-w-0 ${side === "left" ? "order-1" : "order-2"}`} />
      <div
        className={`drag-gap drag-gap-v band-grip shrink-0 ${side === "left" ? "order-2 drag-gap-toward-editor-right" : "order-1 drag-gap-toward-editor-left"}`}
        {...handle}
        style={{ ...handle.style, width: 'var(--pod-gap)' }}
      />
    </div>
  );
}
