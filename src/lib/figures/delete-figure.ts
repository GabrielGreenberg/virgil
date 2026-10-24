import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { surfaceEditableNow } from "@/lib/tiptap/surface-editable";

/**
 * Task 1265 — ONE delete door for a figure-family block.
 *
 * A figure used to have two delete controls that disagreed: the label
 * lozenge's × asked "Delete figure?" first, while the empty-state chrome's
 * "Remove figure" dispatched `tr.delete` at once — though an "empty" figure
 * (no image path yet) can still carry a typed caption and a `\label` that
 * other paragraphs `\ref`. Both controls now call `requestFigureDelete`, so
 * the confirm decision, the write gate and the copy are made here, once.
 */

export type FigureDeleteConfirm = () => Promise<boolean>;

/** The block kinds this door deletes. `figureBlock` = a `figure` env;
 *  `graphicsBlock` = a bare `\includegraphics`. */
const FIGURE_FAMILY = new Set(["figureBlock", "graphicsBlock"]);

/** The noun a delete control names: a `figure` env is a "figure", a bare
 *  `\includegraphics` is an "image" (it has no caption, number or label). */
export function figureDeleteNoun(typeName: string): "figure" | "image" {
  return typeName === "figureBlock" ? "figure" : "image";
}

/** The ONE verb + noun both delete controls wear ("Delete figure" /
 *  "Delete image"). */
export function figureDeleteLabel(typeName: string): string {
  return `Delete ${figureDeleteNoun(typeName)}`;
}

/**
 * THE CONFIRM RULE: ask first iff the block carries something the user would
 * lose by authoring or a `\ref` would dangle on — caption content (any inline
 * content, not just text: a caption of one citation or one math atom counts),
 * a `[short]` LoF caption, or a `\label`. A truly bare stub (no caption, no
 * label) — and every graphicsBlock, which can hold neither — deletes at once:
 * there is nothing a dialog would protect. The image path is NOT in the rule:
 * it is a reference to a file on disk, which delete never touches.
 */
export function figureDeleteNeedsConfirm(node: PMNode): boolean {
  if (node.type.name !== "figureBlock") return false;
  if (((node.attrs.label as string | undefined) ?? "").trim() !== "") return true;
  if (((node.attrs.shortCaption as string | null | undefined) ?? "").trim() !== "") return true;
  let captioned = false;
  node.forEach((child) => {
    if (child.type.name === "figureCaption" && child.content.size > 0) captioned = true;
  });
  return captioned;
}

/**
 * Delete the figure-family block at `getPos()`, asking `confirm` first when
 * `figureDeleteNeedsConfirm` says so. The write gate (`surfaceEditableNow`) is
 * asked at gesture time AND again after the confirm's await (task 1083), and
 * the node is re-read live after the await — a stale position or a block that
 * changed kind meanwhile deletes nothing. Resolves `true` iff it deleted.
 */
export async function requestFigureDelete(args: {
  editor: Editor;
  getPos: () => number | null | undefined;
  /** The block kind the control belongs to; a live node of another kind at
   *  the position is not this block. */
  typeName: string;
  confirm?: FigureDeleteConfirm | null;
}): Promise<boolean> {
  const { editor, getPos, typeName, confirm } = args;
  if (!FIGURE_FAMILY.has(typeName)) return false;
  const live = (): { pos: number; node: PMNode } | null => {
    const pos = getPos();
    if (pos == null) return null;
    const node = editor.state.doc.nodeAt(pos);
    return node && node.type.name === typeName ? { pos, node } : null;
  };
  if (!surfaceEditableNow(editor)) return false;
  const first = live();
  if (!first) return false;
  if (figureDeleteNeedsConfirm(first.node) && confirm) {
    const ok = await confirm();
    if (!ok || !surfaceEditableNow(editor)) return false;
  }
  const hit = live();
  if (!hit) return false;
  editor.view.dispatch(editor.state.tr.delete(hit.pos, hit.pos + hit.node.nodeSize));
  return true;
}
