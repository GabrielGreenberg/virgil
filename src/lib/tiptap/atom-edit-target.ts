/**
 * ATOM EDIT POPOVERS — the ONE door for "may this atom's edit popover open"
 * and "which node does its commit write" (task 1071).
 *
 * The math, `\ref` and figure/graphics popovers share one shape: a click on an
 * atom dispatches a `virgil-*-click` event carrying the atom's `pos` and its
 * OWNING editor; a React popover opens across an async gap; its commit
 * `setNodeMarkup`s `pos` in that editor. Two questions recur at both ends, and
 * each surface used to answer them privately — and wrongly:
 *
 *  1. **May it open / commit at all?** Math asked `editor.isEditable`, `\ref`
 *     asked nothing. On MAIN `isEditable` is a CONSTANT `true` (read-only and
 *     the cowork pen are enforced by `readOnlyEnforcer`'s `filterTransaction`),
 *     so the popover opened on a read-only doc and its save was silently
 *     filtered. The answer is `surfaceEditableNow` (task 579/733) — asked here,
 *     at the bridge AND again at commit (the pen can be taken mid-edit).
 *
 *  2. **Which node does the commit write?** "Whatever node of the right type
 *     now sits at `pos`" is a position address across an async gap — an
 *     external write that removes the clicked atom shifts its neighbour onto
 *     `pos`, and the save overwrites the neighbour. The commit names the atom
 *     by what was CLICKED (the "Addressing the live document across an async
 *     gap" law) and refuses on mismatch.
 *
 * Census: every `virgil-*-click` listener whose popover commits a write calls
 * `atomPopoverMayOpen` (`atom-popover-gate-census.test.ts`), so a new atom
 * popover cannot gate on `isEditable` again.
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";

import { surfaceEditableNow } from "@/lib/tiptap/surface-editable";

/** What the door needs of an editor (structural, like `surfaceEditableNow`'s
 *  — keeps this module free of the TipTap barrel). */
type EditorLike = { view: EditorView; storage: object; isDestroyed?: boolean; state: { doc: PMNode } };

/**
 * May an edit popover open on an atom owned by `owner`? A destroyed or absent
 * owner cannot be edited (the bridges already drop a detail without one).
 *
 * [cost: O(1).]
 */
export function atomPopoverMayOpen(owner: EditorLike | null | undefined): boolean {
  if (!owner || owner.isDestroyed) return false;
  return surfaceEditableNow(owner);
}

/**
 * Resolve the atom a popover commit writes, against the LIVE document: the
 * owner must still be editable, `pos` in range, and the node there must be the
 * one that was clicked (`isClicked`). Anything else is `null` — REFUSE, never
 * "whatever is there now". `nodeAt` throws past the doc end, hence the bound.
 *
 * [cost: O(log doc) — one `nodeAt`.]
 */
export function resolveAtomEditTarget(
  owner: EditorLike | null | undefined,
  pos: number,
  isClicked: (node: PMNode) => boolean,
): PMNode | null {
  if (!atomPopoverMayOpen(owner)) return null;
  const doc = owner!.state.doc;
  if (!Number.isInteger(pos) || pos < 0 || pos >= doc.content.size) return null;
  const node = doc.nodeAt(pos);
  if (!node || !isClicked(node)) return null;
  return node;
}

/** The math node type a popover `kind` names. */
export const MATH_NODE_FOR_KIND = {
  inline: "inlineMath",
  display: "displayMath",
} as const;

/** The math popover's identity predicate: the clicked KIND with the clicked
 *  `latex`. A same-kind formula that slid onto `pos` has other latex and is
 *  refused; so is an inline↔display swap. */
export function isClickedMath(
  kind: keyof typeof MATH_NODE_FOR_KIND,
  latex: string,
): (node: PMNode) => boolean {
  return (node) =>
    node.type.name === MATH_NODE_FOR_KIND[kind] &&
    ((node.attrs.latex as string | undefined) || "") === latex;
}

/**
 * The math popover's COMMIT: rewrite the clicked formula's `latex` in its
 * OWNING editor (main or an embedded card/float — EX-F4-02), refusing unless
 * the door resolves the clicked node. Returns whether it wrote.
 *
 * [cost: O(log doc) + one transaction.]
 */
export function applyMathEdit(
  owner: EditorLike | null | undefined,
  pos: number,
  clicked: { kind: keyof typeof MATH_NODE_FOR_KIND; latex: string },
  newLatex: string,
): boolean {
  const node = resolveAtomEditTarget(owner, pos, isClickedMath(clicked.kind, clicked.latex));
  if (!node) return false;
  const { view } = owner!;
  view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, latex: newLatex }));
  return true;
}
