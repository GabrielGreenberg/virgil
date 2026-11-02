/**
 * `scrollWithinOwnBox` — the ONE `editorProps.handleScrollToSelection` every
 * NESTED editor (card body, float body, example card, borrowed main text)
 * mounts (task 1424).
 *
 * # Why this exists
 *
 * ProseMirror answers `tr.scrollIntoView()` — dispatched by its own paste
 * path, by Enter / arrows, and by `RichTextField`'s text-input door — with
 * `scrollRectIntoView`, which walks EVERY scrollable ancestor until the caret
 * is visible. A card body or float body sits inside the pane's shared row
 * scroller (`[data-virgil-row-scroll]`, the one that scrolls the DOCUMENT),
 * so pasting into a long note moved the whole paper to the bottom of the
 * note ("paste jumps the screen").
 *
 * The rule: **a nested editor never scrolls an ancestor it doesn't own.**
 * This handler scrolls only the editor's NEAREST scroll box (its capped card
 * body, its float's scroll body, its panel list) just far enough to show the
 * caret, and returns `true` so ProseMirror's ancestor walk never runs. If the
 * nearest scroller is the document row (or none exists before it), nothing
 * scrolls — the document is the main editor's to move, not a card's.
 *
 * Cost: O(DOM depth) ancestor walk + one caret rect + one box rect — the same
 * reads ProseMirror's default does, never a doc walk (keystroke sanctity).
 */

import type { EditorView } from "@tiptap/pm/view";
import { findScrollParent } from "@/components/editor-layout/layout-scroll";

/** The document row scroller — never scrolled by a nested editor. */
const ROW_SCROLL_SELECTOR = "[data-virgil-row-scroll]";

/** Breathing room between the caret and the box's edge after a scroll. */
const CARET_MARGIN_PX = 8;

/** The editor's own nearest scroll box, or null when the first scroller up
 *  the tree is the document row (or there is none). The walk is THE door's
 *  (`findScrollParent`, layout-scroll.ts) — this only refuses the row. */
export function ownScrollBox(dom: HTMLElement): HTMLElement | null {
  const box = findScrollParent(dom);
  return box && !box.matches(ROW_SCROLL_SELECTOR) ? box : null;
}

/** `handleScrollToSelection` for a nested editor: scroll only its own box. */
export function scrollWithinOwnBox(view: EditorView): boolean {
  const box = ownScrollBox(view.dom as HTMLElement);
  if (!box) return true;
  let caret: { top: number; bottom: number };
  try {
    caret = view.coordsAtPos(view.state.selection.head);
  } catch {
    return true;
  }
  const rect = box.getBoundingClientRect();
  const top = rect.top + CARET_MARGIN_PX;
  const bottom = rect.bottom - CARET_MARGIN_PX;
  if (caret.top < top) box.scrollTop -= top - caret.top;
  else if (caret.bottom > bottom) box.scrollTop += caret.bottom - bottom;
  return true;
}
