/**
 * BoundRoot — a whole-block surface's doc is exactly ONE node of its kind
 * (task 1170).
 *
 * An expanded Example card and every block float mount
 * `buildEditorExtensions({ surface: "float" })`, whose `doc` is `block+`.
 * Nothing used to bind that doc to the one node the surface EDITS, so the most
 * ordinary rewrite gesture — Cmd-A, then type (or Backspace) — replaced the
 * AllSelection with a bare paragraph: `doc(exampleBlock(…))` became
 * `doc(paragraph("New example"))`. The write-back, finding no exampleBlock,
 * returned; so did every keystroke after it. The card showed the user's text,
 * the paper never received it, and the next re-seed erased it.
 *
 * A surface that edits one node declares the root shape it is bound to
 * (`boundRoot`, a predicate over the surface doc — usually `soleRoot(...)`),
 * and this plugin holds the doc to it:
 *
 *  1. SELECT-ALL MEANS THE ROOT'S CONTENT. An AllSelection — from Mod-a, the
 *     `selectAll` command, anything — is re-expressed as a TextSelection
 *     spanning the root's first to last text position (or a NodeSelection of
 *     a leaf root). Typing or deleting over it then replaces content INSIDE
 *     the root, so Cmd-A → type keeps landing in the same exampleBlock.
 *  2. A TRANSACTION THAT WOULD UNBIND THE ROOT IS REFUSED. Whatever else could
 *     still leave the doc without its sole root (a lift out of the block, an
 *     Enter that splits a one-paragraph surface into two) is filtered. This is
 *     capture/schema symmetry applied to a surface: the surface may not hold
 *     content its write-back cannot represent, because that content is lost
 *     the moment the surface re-seeds. A refused gesture leaves the surface and
 *     the paper AGREEING — the silent divergence is what was destroying text.
 *
 * Fail open: the guard binds only a doc that IS bound. A surface seeded with
 * some other shape (a disconnected placeholder) is never frozen by it.
 *
 * Keystroke sanctity: per transaction it reads `doc.childCount` and the first
 * child's type — O(1), no doc walk.
 */
import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  AllSelection,
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
} from "@tiptap/pm/state";

export type BoundRootPredicate = (doc: PMNode) => boolean;

/** The common binding: the doc holds exactly one node, of one of `types`. */
export function soleRoot(...types: string[]): BoundRootPredicate {
  return (doc) =>
    doc.childCount === 1 && types.includes(doc.firstChild!.type.name);
}

export const boundRootKey = new PluginKey("boundRoot");

/** The selection "select all" means on a bound surface: the root's content.
 *  Null when the root offers no such selection (then the AllSelection
 *  stands — the filter still protects the root). */
export function rootContentSelection(doc: PMNode): Selection | null {
  const root = doc.firstChild;
  if (!root) return null;
  if (root.isLeaf) {
    return NodeSelection.isSelectable(root) ? NodeSelection.create(doc, 0) : null;
  }
  const end = root.nodeSize; // position just after the root
  const first = Selection.findFrom(doc.resolve(1), 1, true);
  const last = Selection.findFrom(doc.resolve(end - 1), -1, true);
  if (!first || !last) return null;
  if (first.from < 1 || last.to > end - 1 || first.from > last.to) return null;
  return TextSelection.create(doc, first.from, last.to);
}

export function boundRootPlugin(isBound: BoundRootPredicate): Plugin {
  return new Plugin({
    key: boundRootKey,
    filterTransaction(tr, state) {
      if (!tr.docChanged) return true;
      if (!isBound(state.doc)) return true; // fail open: not bound to begin with
      return isBound(tr.doc);
    },
    appendTransaction(_trs, _old, state) {
      if (!(state.selection instanceof AllSelection)) return null;
      if (!isBound(state.doc)) return null;
      const sel = rootContentSelection(state.doc);
      if (!sel || sel.eq(state.selection)) return null;
      return state.tr.setSelection(sel).setMeta("addToHistory", false);
    },
  });
}

export interface BoundRootOptions {
  isBound: BoundRootPredicate | null;
}

export const BoundRoot = Extension.create<BoundRootOptions>({
  name: "boundRoot",
  addOptions() {
    return { isBound: null };
  },
  addProseMirrorPlugins() {
    const isBound = this.options.isBound;
    return isBound ? [boundRootPlugin(isBound)] : [];
  },
});
