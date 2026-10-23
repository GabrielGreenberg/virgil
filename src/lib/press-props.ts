/**
 * The ONE door for a button that must act BEFORE focus moves (task 1257).
 *
 * Some buttons have to run on `mousedown`, not `click`: the card rich-text
 * toolbar must toggle a mark before the press blurs its editor, the Pop-out
 * button must act before the card's focus-driven select eats the first click,
 * the math popover's Cancel must beat the document-level mousedown that
 * commits on click-outside. That timing is legitimate. What it silently costs
 * is the KEYBOARD: Enter/Space on a focused `<button>` (and an assistive
 * technology's "press") dispatch only a synthesized `click` — no mousedown —
 * so a button whose action lives only in `onMouseDown` paints a focus ring and
 * does nothing. Task 477 fixed that once by hand (`CardViewModeMenu`); it
 * recurred at three surfaces, which is the argument for a door + a census
 * (`press-before-focus-census.test.ts`) rather than another hand fix.
 *
 * `pressProps(action)` returns both legs:
 * - `onMouseDown` — primary button only (the `isPrimaryDragStart` SSOT, so a
 *   right/middle press keeps its native behaviour); `preventDefault` so focus
 *   and the selection stay where they are; then runs the action. A ONE-SHOT
 *   press, not a gesture: nothing is held, so there is no release edge to
 *   miss (`start-gate-end-edge-census` records exactly that).
 * - `onClick` — runs the action ONLY for a click with `detail === 0`: the
 *   keyboard / AT-synthesized activation. A pointer click (`detail >= 1`)
 *   already acted on its mousedown, so it never double-fires.
 *
 * `bindPress(el, action)` is the same contract for an imperative DOM button
 * (a ProseMirror NodeView's chrome).
 */
import type React from "react";
import { isPrimaryDragStart } from "@/lib/pane-resize/pointer-invariants";

export interface PressOptions {
  /** Also `stopPropagation` on both legs — for a button inside a surface whose
   *  own mousedown/click handlers (card select, lift) must not see the press. */
  stopPropagation?: boolean;
}

type PressEvent = Pick<MouseEvent, "button" | "detail" | "preventDefault" | "stopPropagation">;

/** True for the click that a keyboard or assistive technology synthesized —
 *  the one press no mousedown preceded. */
export const isSynthesizedClick = (e: { detail: number }): boolean => e.detail === 0;

function makeLegs<E extends PressEvent>(
  action: (e: E) => void,
  stop: boolean,
): { down: (e: E) => void; click: (e: E) => void } {
  return {
    down: (e) => {
      if (!isPrimaryDragStart(e)) return;
      e.preventDefault();
      if (stop) e.stopPropagation();
      action(e);
    },
    click: (e) => {
      if (stop) {
        e.preventDefault();
        e.stopPropagation();
      }
      if (!isSynthesizedClick(e)) return;
      action(e);
    },
  };
}

export function pressProps<T extends Element = HTMLButtonElement>(
  action: (e: React.MouseEvent<T>) => void,
  opts: PressOptions = {},
): {
  onMouseDown: (e: React.MouseEvent<T>) => void;
  onClick: (e: React.MouseEvent<T>) => void;
} {
  const { down, click } = makeLegs(action, opts.stopPropagation === true);
  return { onMouseDown: down, onClick: click };
}

export function bindPress(
  el: HTMLElement,
  action: (e: MouseEvent) => void,
  opts: PressOptions = {},
): void {
  const { down, click } = makeLegs<MouseEvent>(action, opts.stopPropagation === true);
  el.addEventListener("mousedown", down);
  el.addEventListener("click", click);
}
