/**
 * `smartInsertBlock` — the ONE container-aware block-atom insert helper
 * (CHIP 6a, MEMO_ACTION_ALIGNMENT.md §3 figure/image/math row, DA-2).
 *
 * # Why this exists
 *
 * Before this, every block-atom insert (figure / graphics / displayMath) was an
 * ad-hoc `editor.chain().focus().deleteSelection().insertContent({…})` call
 * duplicated at each call site (`insertFigureBlock`, `insertGraphicsBlock`, the
 * grid math cells). Each re-implemented the same fragile dance — the
 * `deleteSelection()`-before-`insertContent()` ordering (a block-level atom
 * insert silently no-ops when straddling a paragraph selection), the
 * uuid-collision scan, and the post-insert node lookup — with subtly different
 * behavior and NO shared SSOT. The selected text was, in every case, dropped on
 * the floor with no acknowledgement.
 *
 * `smartInsertBlock` is the single canonical primitive those paths now share, so
 * the lightning grid cell and any future figure/graphics FILE-DROP path insert
 * a block-atom the SAME way (the DA-2 convergence). It is pure ProseMirror
 * (operates on an `EditorView`) — no React, no bridge — so it is callable from
 * both React-land (the grid cell, with `editor.view`) and plugin-land.
 *
 * # Selection policy (documented — NEVER a silent strip)
 *
 * A block atom (figure / graphics / displayMath) is an opaque leaf: it cannot
 * absorb inline text the way a paragraph or an example item can. So when there
 * is a non-empty selection, the only sane behavior is to REPLACE the selection
 * with the block — the selected range is deleted and the new block lands in its
 * place. This is a deliberate, documented policy, not a silent drop:
 *
 *   - the caller decides whether replacing is appropriate for its block kind
 *     (figure/graphics/displayMath all replace — there is nowhere to PUT the
 *     selected inline content inside an atom);
 *   - a WRAP-based action (inline/display math that turns the *selected text*
 *     into the atom's `latex`) does NOT use this helper — it harvests the
 *     selection first and seeds the atom, then there is nothing left to strip.
 *     `mathRun` in the action registry owns that wrap path; `smartInsertBlock`
 *     owns the cursor-insert path (figure/graphics, and the empty-selection
 *     math case).
 *
 * The replace policy matches the prior `deleteSelection().insertContent` behavior
 * exactly (byte-for-byte: same node, same position), so no existing flow changes
 * — the difference is that the policy now lives in ONE documented place instead
 * of being an unstated side effect copy-pasted across call sites.
 *
 * # Container-awareness
 *
 * `replaceSelectionWith` places the block at the selection (collapsed to the
 * caret after `deleteSelection`). ProseMirror lifts the insert out of any inline
 * container (a paragraph) automatically when the block-atom node isn't a valid
 * child there — the same placement logic the schema enforces — so the block
 * lands at the nearest valid block position rather than corrupting the
 * paragraph. We additionally `scrollIntoView()` so the freshly-inserted block is
 * visible (matching the former per-call-site behavior).
 */

import type { Editor } from "@tiptap/core";
import type { Node as PMNode, NodeType } from "@tiptap/pm/model";
import { generateShortId } from "@/lib/uuid";
import { posHostsBlockInsert } from "@/text-objects/text-object-registry";

/** The outcome of a `smartInsertBlock` call. */
export interface SmartInsertResult {
  /** The `uuid` minted onto (or already present on) the inserted node. Empty
   *  string when the node type carries no `uuid` attr (none of today's callers,
   *  but kept honest). The caller uses this to LOCATE the just-inserted node in
   *  the resulting doc (its position shifts under `deleteSelection`), e.g. to
   *  drive a source-editing popover. */
  uuid: string;
  /** The document position of the inserted block node in the post-dispatch doc,
   *  or -1 if it could not be relocated (defensive — should not happen). */
  pos: number;
}

/**
 * Scan the doc for every existing `uuid` on nodes of `typeName`, so a freshly
 * minted id is collision-free within that node family. Mirrors the per-block
 * `collect*Uuids` helpers (figure-block / graphics-block / tex-block), unified
 * here so the smart-insert path has one scan. Exported so the view-only block
 * creators in the action registry (`texRun` / `forestRun`, which operate on
 * `ctx.view` and so cannot go through `smartInsertBlock`, which needs a live
 * TipTap `Editor`) mint against the SAME scan rather than a third copy of it.
 */
export function collectUuids(doc: PMNode, typeName: string): Set<string> {
  const set = new Set<string>();
  doc.descendants((node) => {
    if (node.type.name === typeName && node.attrs.uuid) {
      set.add(node.attrs.uuid as string);
    }
    return true;
  });
  return set;
}

export interface SmartInsertBlockArgs {
  /** The live editor — `editor.view` is where the transaction is dispatched.
   *  We `focus()` first (the grid cell is a toolbar button, so focus may be on
   *  the button, not the doc) to match the former per-call-site behavior. */
  editor: Editor;
  /** The block node type to insert (e.g. `figureBlock`). Resolved off the live
   *  schema by the caller so this helper stays schema-agnostic. */
  type: NodeType;
  /** The node attrs. When the caller has already minted a `uuid` (and passed it
   *  here), it is preserved; otherwise — when `type` declares a `uuid` attr and
   *  `attrs.uuid` is absent/empty — `smartInsertBlock` mints a collision-free
   *  one. Passing a pre-minted uuid lets the caller stamp it on disk-side data
   *  before the insert (the `cite`/`tex` pattern). */
  attrs?: Record<string, unknown>;
  /** Optional initial content for the block (e.g. a `figureCaption` child).
   *  ProseMirror-JSON node specs, same shape `insertContent` accepts. */
  content?: Record<string, unknown>[];
}

/**
 * Insert a block-atom node at the caret, container-aware, replacing any
 * non-empty selection (see the selection-policy docstring above). Returns the
 * `{ uuid, pos }` of the inserted node so the caller can locate it (e.g. to open
 * a source popover anchored to it).
 *
 * Pure ProseMirror — no React, no bridge. Runs on a user gesture (a grid-cell
 * click / a file drop), never per keystroke.
 */
export function smartInsertBlock(args: SmartInsertBlockArgs): SmartInsertResult {
  const { editor, type, content } = args;
  // Focus the doc first (the grid cell is a toolbar button — focus may be on
  // the button). Matches the former `editor.chain().focus()` prelude.
  editor.chain().focus().run();

  const { state } = editor.view;
  // CONTAINER GUARD (task 147 + 229, defense-in-depth): a block atom inserted at
  // a caret inside a block that can't host a block child would SPLIT the
  // container. Two shapes corrupt — the caret's own textblock (titleField
  // singleton → `\title{}` data-loss; codeBlock / latexComment verbatim), AND a
  // fine textblock whose PARENT can't re-host the atom (a `figureCaption` in a
  // single-slot `figureBlock` → the figure splits into two dup-uuid copies,
  // silently lost on reload). Threading `type` engages the schema-precise
  // container check for the latter. figure/graphics are lightning-only (greyed
  // by `blockInsertApplies`); this guards the low-level primitive so ANY caller
  // (the standalone `insertFigureBlock`/`insertGraphicsBlock`, a future file
  // drop) can't corrupt. Returns the not-inserted sentinel.
  if (!posHostsBlockInsert(state.doc, state.selection.from, type)) {
    return { uuid: "", pos: -1 };
  }
  const carriesUuid = "uuid" in type.spec.attrs!;
  // Mint a collision-free uuid iff the node type declares one and the caller
  // didn't already supply it. A caller that pre-mints (to stamp disk data first)
  // passes its uuid in `attrs`; we preserve it.
  const suppliedUuid =
    typeof args.attrs?.uuid === "string" && args.attrs.uuid
      ? (args.attrs.uuid as string)
      : "";
  const uuid =
    carriesUuid && !suppliedUuid
      ? generateShortId(collectUuids(state.doc, type.name))
      : suppliedUuid;
  const attrs = {
    ...(args.attrs ?? {}),
    ...(carriesUuid ? { uuid } : {}),
  };

  // Build the node off the live schema. Using `nodeFromJSON` keeps the
  // content-child path (figureCaption) symmetric with the attrs-only path
  // (graphicsBlock) — one construction route for both.
  const node = state.schema.nodeFromJSON({
    type: type.name,
    attrs,
    ...(content && content.length ? { content } : {}),
  });

  // REPLACE policy: deleteSelection collapses any non-empty range to the caret
  // (the documented "block atoms can't absorb inline content" rule), then
  // replaceSelectionWith places the atom there. For a collapsed caret
  // deleteSelection is a no-op, so this is the plain cursor-insert path.
  let tr = state.tr;
  if (!state.selection.empty) tr = tr.deleteSelection();
  tr = tr.replaceSelectionWith(node);
  editor.view.dispatch(tr.scrollIntoView());

  // Locate the inserted node in the post-dispatch doc by its uuid (its position
  // shifted under deleteSelection). When the type carries no uuid we fall back
  // to a first-of-type match (single-insert-per-call, so unambiguous in
  // practice).
  let pos = -1;
  editor.state.doc.descendants((n, p) => {
    if (pos >= 0) return false;
    if (n.type.name !== type.name) return true;
    if (carriesUuid) {
      if (n.attrs.uuid === uuid) {
        pos = p;
        return false;
      }
      return true;
    }
    pos = p;
    return false;
  });

  return { uuid, pos };
}
