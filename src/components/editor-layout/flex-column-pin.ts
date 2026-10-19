"use client";

import { useEffect, type RefObject } from "react";
import { onLayoutGestureSetChange } from "@/lib/pane-resize";

/**
 * The flex-column PIN — a gesture-scoped freeze of a side column's width
 * (`PanelColumn`, stamped `[data-flex-col]`; task 1178 retired the zen
 * margins that were its second kind).
 *
 * A column's resting flex is React's (`0 0 pref` for a panel column under a
 * `--panel-min` floor), so its RENDERED width can sit far from the stored pref. While
 * a side-column gutter drags, every column in that row must hold its rendered
 * width — or a shrunk column snaps back to its pref the moment the gesture
 * lifts its min-width, and the editor jumps under the pointer.
 *
 * That pin used to be made by WRITING THE STORE: on every gutter press,
 * `syncPanelPrefsToRendered` persisted both sides' rendered widths as their
 * prefs (task 1052). A plain click, an Escape, or a drag of the OTHER side
 * therefore overwrote the user's stored width with a CSS-clamped rendering of
 * it, and the column never re-expanded when the window grew — task 470's
 * class, re-entered through the begin edge. Pinning is transient geometry;
 * persistence is the commit edge's job alone.
 *
 * So the pin lives in two DOM facts React never manages — the `data-flex-pin`
 * attribute and the `--flex-pin` custom property — and one stylesheet rule
 * (`globals.css`: `[data-flex-pin] { flex: 0 0 var(--flex-pin) !important }`)
 * that overrides the React-rendered flex only while it is present. Unpinning
 * removes both, and the column falls back to exactly what React last rendered
 * from the store: no write-then-undo, and no "restore the style React thinks
 * it already wrote" dance. The dragged column's live geometry is the same pin
 * at the pointer's width; its `commit()` is the one store write, and only for
 * a gesture that moved (the engine's rule).
 */

export function pinFlexColumn(col: HTMLElement, px: number): void {
  col.style.setProperty("--flex-pin", `${px}px`);
  col.setAttribute("data-flex-pin", "");
}

function unpinFlexColumn(col: HTMLElement): void {
  col.removeAttribute("data-flex-pin");
  col.style.removeProperty("--flex-pin");
}

type FlexColumnKind = "editor-panel";
const FLEX_COLUMN_KINDS: readonly FlexColumnKind[] = ["editor-panel"];

/** The gutter gesture id of a side column — the ONE minting door, so the
 *  family test below cannot drift from the ids it recognises. Instance-unique
 *  (`reactId`): keep-alive panes and the Reader mount a column per side each. */
export function flexColumnGestureId(kind: FlexColumnKind, side: "left" | "right", reactId: string): string {
  return `${kind}-${side}-${reactId}`;
}

function isFlexColumnGesture(id: string): boolean {
  return FLEX_COLUMN_KINDS.some(
    (k) => id.startsWith(`${k}-left-`) || id.startsWith(`${k}-right-`),
  );
}

/**
 * Pin this column for the life of any side-column gutter gesture in its own
 * row (`.editor-pane-root`; the column itself when it has none) — its own
 * gutter or the opposite side's — and unpin on that gesture's end edge, which
 * the set channel delivers on every end variant (commit, cancel, owner
 * unmount). A gutter in another pane, a band divider, the code splitter and
 * the Library's gutters never pin it: the id family and the row scope both
 * have to match.
 *
 * Declare AFTER the column's `usePaneResizeHandle`: unmount cleanups run in
 * declaration order, so the engine's detach end edge still reaches this
 * listener.
 */
export function useFlexColumnPin(colRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    let pinnedFor: string | null = null;
    return onLayoutGestureSetChange((began, info) => {
      const col = colRef.current;
      if (!col) return;
      if (!began) {
        if (info.id === pinnedFor) {
          unpinFlexColumn(col);
          pinnedFor = null;
        }
        return;
      }
      if (pinnedFor !== null || !isFlexColumnGesture(info.id)) return;
      const scope = col.closest<HTMLElement>(".editor-pane-root") ?? col;
      const inRow = Array.from(scope.querySelectorAll("[data-pane-resize-id]")).some(
        (h) => h.getAttribute("data-pane-resize-id") === info.id,
      );
      if (!inRow) return;
      // One rect read per column per gesture BEGIN — not per frame.
      pinFlexColumn(col, col.getBoundingClientRect().width);
      pinnedFor = info.id;
    });
  }, [colRef]);
}
