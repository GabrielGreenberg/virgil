"use client";

// PaneFreeze — drag-time content freeze for a heavyweight pane (plan
// MEMO_LIBRARY_UI_REFACTOR_2026_07_11 §P3).
//
// While any pane-resize gesture is in flight (the app-wide PaneDragBus), the
// wrapper locks its content to the pre-drag pixel width; the pane itself keeps
// tracking the pointer via the engine's CSS-var grid writes, and simply CLIPS
// the frozen content (`overflow: hidden` on the outer node). On the end edge
// the lock is released and the content adopts the final width — so every
// downstream cost of a content resize (pdf.js re-scale/re-rasterize, O(doc)
// ProseMirror rewrap, geometry ResizeObservers) happens exactly ONCE per
// gesture instead of per pointer frame.
//
// No-double-jump guarantee: the engine's end path flushes the pending RAF
// `apply()` (the final grid width) and runs `commit()` BEFORE it publishes the
// bus end edge (`finish()`'s finally-block), and this wrapper unlocks
// synchronously inside that same bus callback — so the pane's final geometry
// and the content's unlock land in the SAME style/layout/paint flush. The
// content never paints one frame frozen at the new pane size and then reflows.
//
// Generic by design (READER_INHERITANCE-legal): no Reader/Library knowledge —
// just "freeze my box while a pane drag is live". Zero per-frame work: ONE bus
// subscription per instance, edges only; no RAF loops, no ResizeObserver, no
// window listeners. SSR-safe: renders plain divs; all DOM work is effect-side.

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { isPaneDragging, onPaneDragChange } from "./pane-drag-bus";

export interface PaneFreezeProps {
  /**
   * Which pane edge the frozen content stays glued to for the gesture. Pass
   * the pane's STATIONARY edge: the frozen box then occupies exactly its
   * pre-drag screen rect for the whole drag — content does not slide while the
   * pane's moving edge sweeps over it (shrink → the moving edge clips it;
   * grow → a sliver of outer background is revealed on the moving side).
   * Anchoring to the MOVING edge would instead translate the frozen content
   * with every pointer frame — visibly worse than no freeze at all.
   *
   * Example: the Library reader pane is the grid's last column — both library
   * gutters move its LEFT edge while its right edge is container-fixed — so
   * its mount passes `anchor="right"`.
   */
  anchor: "left" | "right";
  /**
   * Extra styles for the OUTER clipper (e.g. a background for the sliver the
   * frozen content doesn't cover while the pane grows). The freeze contract
   * keys (position/overflow/flex sizing) always win over this object, and the
   * imperative lock styles live on the INNER node which this never touches.
   */
  style?: CSSProperties;
  children: ReactNode;
}

// Constant style objects: the lock is written imperatively onto the inner
// node, and React only touches style properties that appear in a JSX style
// diff — constant objects mean no diff ever runs, so a mid-gesture React
// re-render (e.g. the engine's single end-edge store commit) can never clobber
// the imperative width/position writes.
const OUTER_STYLE: CSSProperties = {
  // Fill the pane on either flex axis (the RightDetail task-054 contract moves
  // up onto this node) and clip the frozen content at the pane edge.
  position: "relative",
  overflow: "hidden",
  display: "flex",
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  height: "100%",
};
const INNER_STYLE: CSSProperties = {
  // Free state: an ordinary fill child — the freeze toggles it to an
  // absolutely-positioned fixed-width box and back, imperatively.
  flex: "1 1 auto",
  minWidth: 0,
  minHeight: 0,
  display: "flex",
};

/**
 * Wrap a pane's content so it is width-frozen for the duration of any
 * pane-resize gesture. Keyed on the PaneDragBus edges ONLY — a y-axis or
 * unrelated-pane gesture still toggles the lock, but locking a box to the
 * width it already has (and that the gesture never changes) is a visual
 * no-op, and the two edge toggles are O(1); axis-filtering here would be
 * consumer knowledge the wrapper deliberately doesn't have.
 */
export function PaneFreeze({ anchor, style, children }: PaneFreezeProps) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  // Latest anchor by ref so the single mount-lifetime bus subscription never
  // re-subscribes on a prop change (edge discipline: one subscription, ever).
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;

  useEffect(() => {
    const freeze = () => {
      const inner = innerRef.current;
      if (!inner) return;
      // ONE layout read, on the begin edge only. The bus begin fires from the
      // engine's pointerdown — before its first RAF apply() — so this reads
      // the true pre-drag width.
      const w = inner.getBoundingClientRect().width;
      // A hidden pane (display:none keep-alive reader) measures 0 — locking
      // to 0 would blank it if it were revealed mid-gesture; skip instead.
      if (w <= 0) return;
      const s = inner.style;
      s.position = "absolute";
      s.top = "0";
      s.bottom = "0";
      s[anchorRef.current] = "0";
      s.width = `${w}px`;
    };
    const unfreeze = () => {
      const inner = innerRef.current;
      if (!inner) return;
      const s = inner.style;
      s.position = "";
      s.top = "";
      s.bottom = "";
      s.left = "";
      s.right = "";
      s.width = "";
    };
    // A gesture can already be in flight when this mounts (keep-alive
    // remount / StrictMode effect replay mid-drag) — adopt the frozen state.
    if (isPaneDragging()) freeze();
    const off = onPaneDragChange((active) => {
      if (active) freeze();
      else unfreeze();
    });
    return () => {
      off();
      // Never leave a lock behind the subscription that would release it
      // (StrictMode replays cleanup while mounted; the re-run's isPaneDragging
      // check re-freezes if a drag is still live).
      unfreeze();
    };
  }, []);

  return (
    <div
      style={style ? { ...style, ...OUTER_STYLE } : OUTER_STYLE}
      data-pane-freeze={anchor}
    >
      <div ref={innerRef} style={INNER_STYLE} data-pane-freeze-inner="">
        {children}
      </div>
    </div>
  );
}
