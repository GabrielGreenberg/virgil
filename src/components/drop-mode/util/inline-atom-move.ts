/**
 * Generic factory for "move an inline-atom node" drop specs.
 *
 * Footnotes, citations, refs, and inline math are all inline atom nodes
 * (size 1, no internal cursor positions). Dropping such a payload moves
 * its inline marker from its current position in the doc to the chosen
 * inline cursor position. For Card-bearing atoms (footnote/citation) the
 * Card's body content stays the same — only the marker relocates.
 *
 * TWO source-resolution modes share this one factory:
 *  • **by-id** (default) — `{nodeName, idAttr}`. Scans the doc for the
 *    atom whose id attr matches the id in the cardKey. Used by the
 *    Card float-header drop path (footnote/citation), which can move an
 *    atom across editors (the atom may live in a nested card body).
 *  • **captured-source** — `{resolveSource}`. The in-text grab gesture
 *    captures the exact source node at mousedown (the id-less kinds —
 *    ref, inline math — have nothing to scan by). Same-editor only.
 *
 * Source-editor discovery for by-id: searches the main editor first,
 * then any other editors registered with the drop-target registry (card
 * bodies). This covers a footnote added inside a note's rich-text field.
 */

import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { getRegisteredEditors } from "../target-registry";
import type { DropCtx, DropSpec, PlacementKind } from "../types";

export interface AtomLocation {
  editor: Editor;
  node: PMNode;
  from: number;
  to: number;
}

export interface InlineAtomMoveOptions {
  /** Schema node name (e.g. "footnote") — for the default by-id resolver. */
  nodeName?: string;
  /** Attribute carrying the entity id (e.g. "footnoteId") — by-id resolver. */
  idAttr?: string;
  /**
   * Override source resolution. The in-text grab passes this to resolve
   * the source from a position captured at mousedown rather than by
   * scanning for an id (the id-less kinds have no id to scan by). When
   * absent, falls back to the by-id scan (`nodeName` + `idAttr`).
   */
  resolveSource?: (cardKey: string, ctx: DropCtx) => AtomLocation | null;
  /** Reject cross-editor drops (the in-text grab is same-editor only). */
  sameEditorOnly?: boolean;
  /** Post-move selection: select the moved node (default) or a caret
   *  just after it. */
  select?: "node" | "caret-after";
  /** Placement geometries this spec accepts (default ["inline-cursor"]). */
  allowedPlacements?: ReadonlyArray<PlacementKind>;
}

export function inlineAtomMoveSpec(opts: InlineAtomMoveOptions): DropSpec {
  const resolve = (cardKey: string, ctx: DropCtx): AtomLocation | null =>
    opts.resolveSource
      ? opts.resolveSource(cardKey, ctx)
      : locateAtom(opts, extractId(cardKey), ctx.mainEditor);

  return {
    allowedPlacements: opts.allowedPlacements ?? ["inline-cursor"],
    targetScope: "any-editor",
    classifyDrop(placement, cardKey, ctx) {
      if (placement.kind !== "inline-cursor") return { kind: "no-op" };
      const src = resolve(cardKey, ctx);
      if (!src) return { kind: "no-op" };
      // The in-text grab is same-editor only (v1): a cross-editor move
      // splits into two transactions and would fire an unsuppressed
      // footnote-orphan event in the source editor.
      if (opts.sameEditorOnly && placement.editor !== src.editor) {
        return { kind: "no-op" };
      }
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
      const src = resolve(cardKey, ctx);
      if (!src) return;
      const { editor: targetEditor, pos: insertPos } = placement;
      const { editor: sourceEditor, node, from, to } = src;
      if (targetEditor === sourceEditor) {
        // Single transaction: delete + adjusted insert (see helper).
        moveInlineAtomWithin(targetEditor, node, from, to, insertPos, opts.select);
        return;
      }
      // Cross-editor move: insert first (preserves node identity), then
      // delete in source. Order matters less for atoms than for
      // paragraphs because PM positions are decoupled across editors.
      // (Unreachable when sameEditorOnly — classifyDrop already no-op'd.)
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

/**
 * Same-editor delete+insert preserving node identity. `select` picks the
 * post-move selection: "node" (default — a NodeSelection on the moved
 * atom, the legacy float-header behavior) or "caret-after" (a caret just
 * past the atom — uniform across kinds, no chrome asymmetry on the
 * `selectable:false` atoms). NEVER `.scrollIntoView()`: that would
 * resurrect the ~100px scroll-jump that `selectable:false` was added to
 * avoid (footnote.ts / citation.ts).
 */
function moveInlineAtomWithin(
  editor: Editor,
  node: PMNode,
  from: number,
  to: number,
  insertPos: number,
  select: "node" | "caret-after" = "node",
): void {
  const adjustedInsert = insertPos > to ? insertPos - (to - from) : insertPos;
  const tr = editor.state.tr.delete(from, to);
  tr.insert(adjustedInsert, node);
  try {
    tr.setSelection(
      select === "caret-after"
        ? TextSelection.create(tr.doc, adjustedInsert + node.nodeSize)
        : NodeSelection.create(tr.doc, adjustedInsert),
    );
  } catch {
    /* position couldn't host the selection — skip silently */
  }
  editor.view.dispatch(tr);
  editor.view.focus();
}

/** Walk the main editor first, then every other registered editor,
 *  looking for an inline atom with the matching id. Used by the by-id
 *  (float-header) resolver only. */
function locateAtom(
  opts: InlineAtomMoveOptions,
  id: string | null,
  mainEditor: Editor | null,
): AtomLocation | null {
  if (!id || !opts.nodeName || !opts.idAttr) return null;
  const nodeName = opts.nodeName;
  const idAttr = opts.idAttr;
  const editors: Editor[] = [];
  if (mainEditor) editors.push(mainEditor);
  for (const e of getRegisteredEditors()) {
    if (e !== mainEditor) editors.push(e);
  }
  for (const editor of editors) {
    let found: AtomLocation | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (found) return false;
      if (node.type.name !== nodeName) return true;
      if (node.attrs?.[idAttr] !== id) return true;
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
