/**
 * Live anchors for `<MenuProvider trackAnchor>` (task 747).
 *
 * A portaled menu is `position: fixed`, so a DOMRect captured at open time is a
 * FROZEN anchor: scroll the editor and the thing the menu points at moves while
 * the menu stays put. `useFloatingMenuPosition` already owns the sanctioned
 * re-anchor (a RAF-coalesced, equality-bailed, gesture-parked re-read — the
 * Scroll-anchor stability law's shape (b)); all a menu has to supply is a thunk
 * that re-reads WHERE ITS ANCHOR IS NOW. These are the three shapes every
 * rect-opened menu's anchor takes:
 *
 *   - `elementAnchor` — the trigger is a DOM element (a toolbar cell, a heading
 *     lozenge chip, a squiggled word's span);
 *   - `caretAnchor`   — the anchor is a document POSITION (a create-at-caret
 *     popover), re-read through the geometry service's `coordsAtPosCached`;
 *   - `nodeAnchor`    — the anchor is an inline atom at a position (a `\ref`
 *     chip): its node DOM when mounted, else the caret at that position.
 *
 * Each thunk returns `null` when its anchor is gone (element detached, position
 * out of range); the positioning hook then falls back to the rect captured at
 * open, which is exactly the pre-747 behaviour — never worse.
 *
 * The census `menu-live-anchor-census.test.ts` requires every portaled
 * `<MenuProvider>` to pass `trackAnchor` (or be allowlisted with a reason).
 */

import type { Editor } from "@tiptap/core";
import { coordsAtPosCached } from "@/lib/editor-geometry/registry";

export interface LiveAnchorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export type LiveAnchor = () => LiveAnchorRect | null;

/** Re-read an element's rect; `null` once it has left the document. Accepts
 *  the element itself or a ref/getter to it (for a trigger that re-mounts). */
export function elementAnchor(
  source:
    | Element
    | null
    | undefined
    | { readonly current: Element | null }
    | (() => Element | null | undefined),
): LiveAnchor {
  return () => {
    const el =
      typeof source === "function"
        ? source()
        : source && "current" in source && !(source instanceof Element)
          ? source.current
          : (source as Element | null | undefined);
    if (!el || !el.isConnected) return null;
    return el.getBoundingClientRect();
  };
}

/** Re-read the caret box at `pos` in `editor`; `null` when the editor is gone
 *  or `pos` has fallen outside the document. */
export function caretAnchor(editor: Editor | null | undefined, pos: number): LiveAnchor {
  return () => {
    if (!editor || editor.isDestroyed) return null;
    if (pos < 0 || pos > editor.state.doc.content.size) return null;
    const c = coordsAtPosCached(editor, pos);
    if (!c) return null;
    return {
      left: c.left,
      top: c.top,
      right: c.left,
      bottom: c.bottom,
      width: 0,
      height: c.bottom - c.top,
    };
  };
}

/** Re-read the rendered node at `pos` (an inline atom's chip); falls back to
 *  the caret at `pos` when the node has no mounted DOM. */
export function nodeAnchor(editor: Editor | null | undefined, pos: number): LiveAnchor {
  const caret = caretAnchor(editor, pos);
  return () => {
    if (!editor || editor.isDestroyed) return null;
    if (pos < 0 || pos > editor.state.doc.content.size) return null;
    let dom: Node | null = null;
    try {
      dom = editor.view.nodeDOM(pos);
    } catch {
      dom = null;
    }
    if (dom instanceof Element && dom.isConnected) return dom.getBoundingClientRect();
    return caret();
  };
}
