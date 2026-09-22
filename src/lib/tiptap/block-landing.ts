/**
 * Landing on a block — the ONE door for "navigate to the block that starts at
 * `pos`" (task 711).
 *
 * The jump handles used to guess a position INSIDE the block (`pos + 1`), put
 * a TextSelection there, and ask `domAtPos` for the element to scroll to. That
 * only works when the block's first position is inside a textblock. For an
 * atom leaf block (`texBlock`, `forestBlock`, a graphics block — nodeSize 1),
 * `pos + 1` is the top-level gap AFTER the block: `domAtPos` answers the
 * editor root, so the scroll lands at the top of the paper, and the
 * TextSelection sits between blocks, in no textblock at all.
 *
 * Here the target is named by identity instead: the scroll element is the
 * block's OWN DOM (`nodeDOM(pos)`), and the selection is the kind the node
 * admits — a NodeSelection on an atom, the nearest text position otherwise.
 */
import type { EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection, type Selection } from "@tiptap/pm/state";

/** The selection that "lands on" the block starting at `pos`, or null when
 *  no node starts there. Atom/leaf blocks get a NodeSelection; everything
 *  else gets the text position nearest the block's start (for a heading or
 *  paragraph that is exactly `pos + 1`, the old behaviour). */
export function selectionLandingOnBlock(doc: PMNode, pos: number): Selection | null {
  if (pos < 0 || pos >= doc.content.size) return null;
  const node = doc.nodeAt(pos);
  if (!node) return null;
  // `selectable: false` (texBlock, forestBlock) only stops PM from making a
  // NodeSelection on mousedown; a programmatic one is still the honest
  // landing — any TEXT position near an atom is in some OTHER block.
  if (node.isAtom || node.isLeaf) return NodeSelection.create(doc, pos);
  return TextSelection.near(doc.resolve(pos + 1));
}

/** The element to scroll to for the block at `pos`. An atom block answers
 *  its OWN DOM (`nodeDOM(pos)`) — `pos + 1` is outside it. A block with
 *  content keeps the element holding its first inside position (for a
 *  heading, the text line rather than its NodeView chrome — the line the
 *  section detector reads), falling back to its node DOM. Never the editor
 *  root. */
export function blockElementAt(view: EditorView, pos: number): HTMLElement | null {
  const node = view.state.doc.nodeAt(pos);
  if (!node) return null;
  const asEl = (n: Node | null | undefined): HTMLElement | null => {
    const el = n instanceof HTMLElement ? n : n?.parentElement ?? null;
    return el && el !== view.dom ? el : null;
  };
  if (!(node.isAtom || node.isLeaf)) {
    try {
      const inside = asEl(view.domAtPos(pos + 1).node);
      if (inside) return inside;
    } catch { /* fall through to the node DOM */ }
  }
  try {
    return asEl(view.nodeDOM(pos));
  } catch {
    return null;
  }
}

/** Put the selection on the block at `pos` (no scroll — the caller owns the
 *  scroll, so no deferred scrollIntoView can fight it) and return the
 *  element to scroll to. Returns null when no block starts at `pos`. */
export function landOnBlock(view: EditorView, pos: number): HTMLElement | null {
  const sel = selectionLandingOnBlock(view.state.doc, pos);
  if (!sel) return null;
  view.dispatch(view.state.tr.setSelection(sel));
  return blockElementAt(view, pos);
}
