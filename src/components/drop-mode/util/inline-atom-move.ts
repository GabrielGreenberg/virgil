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
 *
 * **Anchor the unanchored (opt-in `createAtom`):** a footnote/citation
 * card can exist with NO marker in any editor (created via the panel "+"
 * before being dropped into the prose). For such a card `locateAtom`
 * returns null, so the move path no-ops. When a `createAtom` factory is
 * configured, the no-op becomes an `apply` that BUILDS a fresh atom node
 * — carrying the card's EXISTING id — and inserts it at the drop point.
 * The branch is purely additive: with no factory the move path is
 * byte-unchanged.
 *
 * **Inline invariant:** this factory must NEVER return `{kind:"confirm"}`.
 * Inline atoms are `selectable:false`; the grab gesture is a live drag
 * with a floating ghost, and an async confirm modal would freeze that
 * ghost mid-gesture. Re-anchoring an existing atom is a silent MOVE, and
 * anchoring an unanchored card is a silent CREATE — both `apply`, never
 * `confirm`.
 */

import type { Editor } from "@tiptap/react";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { getRegisteredEditors } from "../target-registry";
import { parseAnyKey } from "@/floats/float-key";
import type { DropCtx, DropSpec, PlacementKind } from "../types";

export interface AtomLocation {
  editor: Editor;
  node: PMNode;
  from: number;
  to: number;
}

/**
 * Inputs handed to an opt-in `createAtom` factory (the "anchor the
 * unanchored" branch). The factory builds a fresh inline-atom node for a
 * card whose marker doesn't exist in any editor yet, reusing the card's
 * EXISTING id so the new atom and the card stay coupled.
 */
export interface CreateAtomArgs {
  /** The card's EXISTING entity id (footnoteId / citationId), parsed from
   *  the drop's `cardKey`. The built node MUST carry this — minting a fresh
   *  id would orphan the card from its marker. */
  id: string;
  /** Schema of the TARGET editor (where the atom will be inserted), so the
   *  factory can resolve its node type and `create(...)` the node. */
  schema: Schema;
  /** The full drop `cardKey`, for factories that need more than the id. */
  cardKey: string;
  /** The per-doc drop context, so a factory can consult a hook accessor
   *  (e.g. the citation command lookup) it needs to populate node attrs. */
  ctx: DropCtx;
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
  /**
   * OPT-IN "anchor the unanchored" branch. When source resolution finds NO
   * atom (the card has no marker in any editor yet) AND this factory is
   * configured, `classifyDrop` returns `apply` (instead of the move path's
   * no-op) and `applyDrop` inserts a freshly-built atom — carrying the
   * card's EXISTING id — at the drop position. Return `null` to DECLINE
   * (e.g. an empty draft citation with no serializable citekey, or a target
   * editor whose schema lacks the node type); declining falls back to no-op,
   * exactly as if the factory were absent.
   *
   * When ABSENT the factory is byte-unchanged: the create branch never fires,
   * so the id-less in-text atom-grab path and the by-id float-header move path
   * behave precisely as before. The branch is purely additive.
   *
   * The factory MUST reuse the doc-level node construction (the same attrs the
   * `\footnote{}` / `\cite{}` create paths build) but substitute the card's
   * EXISTING id — it must NEVER mint a new one (that orphans the card).
   */
  createAtom?: (args: CreateAtomArgs) => PMNode | null;
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
      if (!src) {
        // No marker in any editor. If a `createAtom` factory is configured
        // AND it can build a node for this card (a serializable atom), this
        // is the "anchor the unanchored" CREATE branch — apply, never
        // confirm (the inline ghost can't survive an async modal). The
        // factory declining (null) — e.g. an empty draft citation — falls
        // through to no-op, exactly as if it weren't configured.
        if (opts.createAtom && buildCreateNode(opts, placement, cardKey, ctx)) {
          return { kind: "apply" };
        }
        return { kind: "no-op" };
      }
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
      if (!src) {
        // CREATE branch (mirrors classifyDrop): no marker exists, so build a
        // fresh atom carrying the card's EXISTING id and insert it at the
        // drop position. A silent insert — never a confirm.
        if (opts.createAtom) {
          const node = buildCreateNode(opts, placement, cardKey, ctx);
          if (node) insertNewAtom(placement.editor, placement.pos, node, opts.select);
        }
        return;
      }
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
      // Park a caret at the atom's home in the SOURCE editor before the delete,
      // so that editor's undo `selectionBefore` is on-screen (same #8 rationale
      // as the same-editor path). Selection-only, addToHistory:false.
      parkCaretBeforeMove(sourceEditor, from);
      const deleteTr = sourceEditor.state.tr.delete(from, to);
      sourceEditor.view.dispatch(deleteTr);
    },
    postDrop: "keep",
  };
}

/**
 * Resolve the card's existing id and invoke the opt-in `createAtom` factory
 * to build a fresh atom node for the TARGET editor's schema. Returns the
 * built node, or null when no factory is configured, the cardKey has no id,
 * or the factory declines (e.g. an empty draft citation). Pure (no dispatch)
 * so `classifyDrop` can use it as a "can this card be created?" probe and
 * `applyDrop` can reuse the same construction.
 */
function buildCreateNode(
  opts: InlineAtomMoveOptions,
  placement: Extract<Parameters<DropSpec["applyDrop"]>[0], { kind: "inline-cursor" }>,
  cardKey: string,
  ctx: DropCtx,
): PMNode | null {
  if (!opts.createAtom) return null;
  const id = extractId(cardKey);
  if (!id) return null;
  return opts.createAtom({ id, schema: placement.editor.schema, cardKey, ctx });
}

/**
 * Insert a freshly-built inline atom at `insertPos` (the "anchor the
 * unanchored" CREATE branch). Unlike the move path there is no source atom
 * to delete and no original home to undo-park to — the card simply had no
 * marker yet — so this is a single insert transaction. `select` mirrors the
 * move's post-action selection ("node" = NodeSelection on the new atom;
 * "caret-after" = caret just past it). NEVER `.scrollIntoView()`, matching
 * the move helper (these atoms are `selectable:false`).
 */
function insertNewAtom(
  editor: Editor,
  insertPos: number,
  node: PMNode,
  select: "node" | "caret-after" = "node",
): void {
  const tr = editor.state.tr.insert(insertPos, node);
  try {
    tr.setSelection(
      select === "caret-after"
        ? TextSelection.create(tr.doc, insertPos + node.nodeSize)
        : NodeSelection.create(tr.doc, insertPos),
    );
  } catch {
    /* position couldn't host the selection — skip silently */
  }
  editor.view.dispatch(tr);
  editor.view.focus();
}

/**
 * Same-editor delete+insert preserving node identity. `select` picks the
 * post-move selection: "node" (default — a NodeSelection on the moved
 * atom, the legacy float-header behavior) or "caret-after" (a caret just
 * past the atom — uniform across kinds, no chrome asymmetry on the
 * `selectable:false` atoms). NEVER `.scrollIntoView()`: that would
 * resurrect the ~100px scroll-jump that `selectable:false` was added to
 * avoid (footnote.ts / citation.ts).
 *
 * Undo-jump guard (backlog #8): inline atoms are `selectable:false`, so the
 * grab gesture never rests a selection on the atom; at drop time the editor's
 * selection is stale (often doc-top). prosemirror-history captures
 * `selectionBefore` from the *pre-move* state, so Cmd-Z would restore that
 * stale doc-top caret with `scrollIntoView()` → the viewport jumps to the top.
 * Before building the move, `parkCaretBeforeMove` rests a `TextSelection` caret
 * adjacent to the atom's ORIGINAL location (`addToHistory:false`), so
 * `selectionBefore` lands at the atom's old home (on-screen) and undo scrolls
 * *there*, not to the top.
 */
function moveInlineAtomWithin(
  editor: Editor,
  node: PMNode,
  from: number,
  to: number,
  insertPos: number,
  select: "node" | "caret-after" = "node",
): void {
  // Park a caret at the atom's original home so the move's `selectionBefore`
  // (captured by prosemirror-history) is on-screen — see helper jsdoc.
  parkCaretBeforeMove(editor, from);
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

/**
 * Park a `TextSelection` caret adjacent to `from` (the atom's original
 * location) as a selection-only, `addToHistory:false` transaction, BEFORE the
 * move transaction is built/dispatched. This makes prosemirror-history capture
 * the move's `selectionBefore` here (on-screen, where the atom currently sits)
 * instead of a stale doc-top selection — so Cmd-Z restores a caret at the
 * atom's old home and scrolls *there* rather than jumping the viewport to the
 * top (backlog #8).
 *
 * - MUST be a `TextSelection` caret, never a `NodeSelection`: these atoms are
 *   `selectable:false`, and a NodeSelection on one would reintroduce the
 *   ~100px scroll-jump the grab gesture deliberately avoids.
 * - `addToHistory:false` keeps this parking tr out of the undo stack, so one
 *   Cmd-Z still undoes the whole move in a single step.
 * - Positions are untouched (selection-only), so the caller's `from`/`to`/
 *   `insertPos` stay valid against the post-parking state.
 *
 * `TextSelection.near` resolves the nearest valid text position to `from`,
 * tolerating atom boundaries; if no text position exists it no-ops silently.
 */
function parkCaretBeforeMove(editor: Editor, from: number): void {
  try {
    const tr = editor.state.tr;
    const $from = tr.doc.resolve(Math.min(from, tr.doc.content.size));
    tr.setSelection(TextSelection.near($from));
    tr.setMeta("addToHistory", false);
    editor.view.dispatch(tr);
  } catch {
    /* couldn't resolve a caret near the atom — skip; move still proceeds */
  }
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
  // Colon-safe via the dual-read parser (footnote/citation card floats key on
  // `float:card:<kind>:<id>` post-flip; legacy `<prefix>:<id>` still parses).
  return parseAnyKey(cardKey)?.id ?? null;
}
