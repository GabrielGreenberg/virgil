/**
 * Generic factory for "move an inline-atom node" drop specs.
 *
 * Footnotes, citations, and AI-request markers are all inline atom
 * nodes (size 1, no internal cursor positions) carrying a unique ID
 * attribute. Dropping such a card moves its inline marker from its
 * current position in the doc to the chosen inline cursor position.
 * The card's body content stays the same — only the marker relocates.
 *
 * Each kind plugs in its `nodeName` and `idAttr`. The factory handles
 * lookup, no-op detection (drop at source's own position), and
 * cross-editor transactions.
 *
 * Source-editor discovery: searches the main editor first, then walks
 * any other editors registered with the drop-target registry (card
 * bodies). This covers the case where a footnote was added inside a
 * note's rich-text field; the float lives at the body level but the
 * atom is in a nested editor.
 */

import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import { getRegisteredEditors } from "../target-registry";
import type { DropSpec, Placement } from "../types";

export interface InlineAtomMoveOptions {
  /** Schema node name (e.g. "footnote"). */
  nodeName: string;
  /** Attribute on the node carrying the entity id (e.g. "footnoteId"). */
  idAttr: string;
}

export function inlineAtomMoveSpec(
  opts: InlineAtomMoveOptions,
): DropSpec {
  return {
    allowedPlacements: ["inline-cursor"],
    targetScope: "any-editor",
    classifyDrop(placement, cardKey, ctx) {
      if (placement.kind !== "inline-cursor") return { kind: "no-op" };
      const id = extractId(cardKey);
      if (!id) return { kind: "no-op" };
      const src = locateAtom(opts, id, ctx.mainEditor);
      if (!src) return { kind: "no-op" };
      // Same-editor no-ops: dropping at the position the atom already
      // occupies (either side) leaves it where it was.
      if (
        placement.editor === src.editor &&
        placement.pos >= src.from &&
        placement.pos <= src.to
      ) {
        return { kind: "no-op" };
      }
      return { kind: "apply" };
    },
    applyDrop(placement, cardKey, ctx) {
      if (placement.kind !== "inline-cursor") return;
      const id = extractId(cardKey);
      if (!id) return;
      const src = locateAtom(opts, id, ctx.mainEditor);
      if (!src) return;
      const { editor: targetEditor, pos: insertPos } = placement;
      const { editor: sourceEditor, node, from, to } = src;
      if (targetEditor === sourceEditor) {
        // Single transaction: delete + adjusted insert.
        const adjustedInsert = insertPos > to ? insertPos - (to - from) : insertPos;
        const tr = targetEditor.state.tr.delete(from, to);
        tr.insert(adjustedInsert, node);
        // Select the dropped atom so the user sees where it landed.
        try {
          tr.setSelection(NodeSelection.create(tr.doc, adjustedInsert));
        } catch {
          /* position couldn't host a NodeSelection — skip silently */
        }
        targetEditor.view.dispatch(tr);
        targetEditor.view.focus();
        return;
      }
      // Cross-editor move: insert first (preserves node identity), then
      // delete in source. Order matters less for atoms than for
      // paragraphs because PM positions are decoupled across editors.
      const insertTr = targetEditor.state.tr.insert(insertPos, node);
      try {
        insertTr.setSelection(NodeSelection.create(insertTr.doc, insertPos));
      } catch {
        /* skip silently */
      }
      targetEditor.view.dispatch(insertTr);
      targetEditor.view.focus();
      const deleteTr = sourceEditor.state.tr.delete(from, to);
      sourceEditor.view.dispatch(deleteTr);
    },
    postDrop: "keep",
  };
}

interface AtomLocation {
  editor: Editor;
  node: PMNode;
  from: number;
  to: number;
}

/** Walk the main editor first, then every other registered editor,
 *  looking for an inline atom with the matching id. */
function locateAtom(
  opts: InlineAtomMoveOptions,
  id: string,
  mainEditor: Editor | null,
): AtomLocation | null {
  const editors: Editor[] = [];
  if (mainEditor) editors.push(mainEditor);
  for (const e of getRegisteredEditors()) {
    if (e !== mainEditor) editors.push(e);
  }
  for (const editor of editors) {
    let found: AtomLocation | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (found) return false;
      if (node.type.name !== opts.nodeName) return true;
      if (node.attrs?.[opts.idAttr] !== id) return true;
      found = { editor, node, from: pos, to: pos + node.nodeSize };
      return false;
    });
    if (found) return found;
  }
  return null;
}

function extractId(cardKey: string): string | null {
  const sep = cardKey.indexOf(":");
  return sep > 0 ? cardKey.slice(sep + 1) : null;
}
