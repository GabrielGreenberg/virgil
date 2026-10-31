/**
 * Position-mapped caret restore across a `setContent` re-seed.
 *
 * The embedded/float editors (ExampleCard's expex body, every
 * `src/text-objects/floats/*` body via `float-sync`) re-seed themselves from
 * the live main doc by replacing the whole document (`dispatchReseed` below —
 * never `setContent`, which records the replace in undo history). That
 * rebuilds the doc wholesale, so the user's caret would collapse to the start
 * unless it is explicitly re-applied afterward.
 *
 * The naive restore re-applies the SAME numeric `{from,to}` offsets clamped to
 * the new doc size. That is correct only when the foreign edit landed at or
 * AFTER the caret. When the foreign edit inserted (or deleted) text BEFORE the
 * caret, the content shifts but the raw offset does not, so the caret lands at
 * the wrong logical position (EX-F8-02 + the shared float-sync class).
 *
 * The fix: diff the old card/float doc against the incoming doc and map the
 * saved position through the single changed region, exactly as ProseMirror
 * maps a position across a transaction. We reconstruct that change as a
 * `StepMap` over the `[diffStart, oldDiffEnd)` → `[diffStart, newDiffEnd)`
 * region (the minimal edited span both `Fragment.findDiffStart` /
 * `findDiffEnd` identify), then `map()` the position through it.
 *
 * `bias` mirrors ProseMirror's mapping bias: a caret sitting exactly at the
 * boundary of an insertion maps forward (`bias > 0`) so it stays on the
 * trailing edge of typed text, matching how the live editor maps a selection.
 */

import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import { TextSelection, type Transaction } from "@tiptap/pm/state";
import { StepMap, Transform } from "@tiptap/pm/transform";
import { createDocument } from "@tiptap/core";
import type { Editor, JSONContent } from "@tiptap/react";

/**
 * Map a caret/anchor position from `oldDoc`'s coordinate space into `newDoc`'s,
 * accounting for the structural difference between them. Returns a position
 * already clamped to `[0, newDoc.content.size]`, safe to hand to
 * `setTextSelection`.
 *
 * When the docs are identical (the common echo / no-op re-derivation case) the
 * input position is returned unchanged (clamped) — no StepMap is built.
 */
/**
 * Rebuild a node with every node's attrs (and marks' attrs) stripped to the
 * defaults, recursively. Attrs DO NOT affect ProseMirror positions — a
 * paragraph with uuid "a" and one with uuid "b" occupy the identical token
 * span — so the normalized tree maps 1:1 onto the real tree's position space.
 *
 * Why this matters: `setContent` re-mints volatile attrs on editor-managed
 * artifacts (notably the trailing empty paragraph's `uuid`). `findDiffStart`/
 * `findDiffEnd` compare node markup INCLUDING attrs, so that one churned uuid
 * at the tail makes `findDiffEnd` fail to find the common suffix — collapsing
 * the whole region into one StepMap and dragging an interior caret to the
 * region start. Diffing the attr-normalized projections instead ignores that
 * noise while preserving every position, so a real text edit upstream of the
 * caret maps the caret correctly.
 */
function stripAttrs(node: PMNode): PMNode {
  const content = node.content.size
    ? Fragment.fromArray(node.content.content.map(stripAttrs))
    : node.content;
  const marks = node.marks.map((m) => m.type.create());
  if (node.isText) {
    // `type.create` rejects text; rebuild via the text node's own copy with
    // normalized marks (text carries no attrs of its own).
    return node.mark(marks);
  }
  return node.type.create(null, content, marks);
}

export function mapPosThroughReseed(
  oldDoc: PMNode,
  newDoc: PMNode,
  pos: number,
  bias = 1,
): number {
  const newSize = newDoc.content.size;
  const clampNew = (p: number) => Math.min(Math.max(p, 0), newSize);

  // Diff attr-normalized projections so volatile attr churn (e.g. a re-minted
  // trailing-paragraph uuid) can't widen the diff window past the caret. The
  // projections share the real docs' exact position space (attrs are zero-size).
  const oldFrag: Fragment = stripAttrs(oldDoc).content;
  const newFrag: Fragment = stripAttrs(newDoc).content;

  // `findDiffStart` returns the first DIVERGING position (in doc-content
  // coordinates, i.e. the same coordinate space as a ProseMirror position
  // minus the implicit doc-open token — which is 0 for both, so positions are
  // directly comparable). Null means the fragments are identical.
  const diffStart = oldFrag.findDiffStart(newFrag);
  if (diffStart == null) {
    // Identical content — only clamp (handles a shrunk doc, though that can't
    // happen when content is equal; defensive).
    return clampNew(pos);
  }

  // `findDiffEnd` returns the matching tail boundaries in each fragment. The
  // edited region is [diffStart, oldEnd) replaced by [diffStart, newEnd).
  const diffEndRes = oldFrag.findDiffEnd(newFrag);
  // findDiffEnd is non-null whenever findDiffStart is non-null.
  const oldEnd = diffEndRes ? diffEndRes.a : oldFrag.size;
  const newEnd = diffEndRes ? diffEndRes.b : newFrag.size;

  // Guard against an overlapping diff window (can occur on repeated single
  // chars, e.g. "aa" → "aaa"): clamp the replaced spans to be non-negative so
  // the StepMap is well-formed.
  const oldLen = Math.max(0, oldEnd - diffStart);
  const newLen = Math.max(0, newEnd - diffStart);

  // A StepMap step is [start, oldSize, newSize]: the region at `diffStart`
  // spanning `oldLen` tokens became `newLen` tokens. Mapping a position
  // through this reproduces ProseMirror's own position mapping for that edit.
  const map = new StepMap([diffStart, oldLen, newLen]);
  return clampNew(map.map(pos, bias));
}

/**
 * THE re-seed door: replace an embedded editor's whole document with
 * `nextDoc` as a NON-USER transaction (task 1398).
 *
 * A re-seed mirrors content that changed ELSEWHERE (main doc, a sibling float,
 * a parent's value) into this editor. It is not an edit the user made here, so
 * it must never enter this editor's undo history. TipTap's
 * `setContent` with `emitUpdate: false` sets only `preventUpdate` —
 * never `addToHistory: false` — so every re-seed through it became an undoable
 * step (grouped with the user's own typing inside the 500 ms newGroupDelay).
 * Cmd-Z in a float then reverted the FOREIGN edit, `onUpdate` wrote that revert
 * back into main through the float write-back (itself `addToHistory: false`),
 * and the foreign text was gone from both histories.
 *
 * So the replace is ONE transaction stamped `preventUpdate` (no onUpdate echo)
 * AND `addToHistory: false` (prosemirror-history maps the user's own earlier
 * steps through it, the standard foreign-change rebase). An optional
 * `selection` callback picks the post-seed selection inside the SAME tr.
 */
function dispatchReseed(
  editor: Editor,
  nextDoc: JSONContent,
  selection?: (oldDoc: PMNode, newDoc: PMNode) => { from: number; to: number },
): void {
  const { state } = editor;
  const doc = createDocument(nextDoc, editor.schema, undefined, {
    errorOnInvalidContent: editor.options.enableContentCheck,
  });
  const tr = state.tr;
  replaceMinimally(tr, state.doc, doc);
  tr.setMeta("preventUpdate", true).setMeta("addToHistory", false);
  if (selection) {
    const { from, to } = selection(state.doc, tr.doc);
    try {
      // Same clamp `setTextSelection` applies: into the doc's text range.
      const minPos = TextSelection.atStart(tr.doc).from;
      const maxPos = TextSelection.atEnd(tr.doc).to;
      const clamp = (p: number) => Math.min(Math.max(p, minPos), maxPos);
      tr.setSelection(TextSelection.create(tr.doc, clamp(from), clamp(to)));
    } catch {
      /* selection target may not be a valid text position post-reset; OK */
    }
  }
  editor.view.dispatch(tr);
}

/**
 * Replace `oldDoc` with `newDoc` in `tr` by its CHANGED region only — the span
 * between the common prefix and common suffix — not the whole document. A
 * whole-doc replace deletes every position, so prosemirror-history could map
 * none of the user's earlier steps through it and their Cmd-Z would silently
 * do nothing; a minimal step lets history rebase them past the foreign change.
 * Falls back to the whole-doc replace if the minimal step does not reproduce
 * `newDoc` exactly (it always should; the guard keeps the door total).
 */
function replaceMinimally(tr: Transaction, oldDoc: PMNode, newDoc: PMNode) {
  const start = oldDoc.content.findDiffStart(newDoc.content);
  if (start == null) return; // identical — nothing to replace
  const end = oldDoc.content.findDiffEnd(newDoc.content);
  let endA = end ? end.a : oldDoc.content.size;
  let endB = end ? end.b : newDoc.content.size;
  // Repeated content ("aa" → "aaa") can make the suffix overlap the prefix.
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) {
    endA += overlap;
    endB += overlap;
  }
  try {
    const trial = new Transform(oldDoc).replace(
      start,
      endA,
      newDoc.slice(start, endB),
    );
    if (trial.doc.eq(newDoc)) {
      for (const step of trial.steps) tr.step(step);
      return;
    }
  } catch {
    /* fall through to the whole-doc replace */
  }
  tr.replaceWith(0, oldDoc.content.size, newDoc);
}

/**
 * Re-seed an editor the user is NOT typing in (unfocused card field, read-only
 * borrowed body) — through the one door, so it stays out of undo history.
 */
export function reseedEditor(editor: Editor, nextDoc: JSONContent): void {
  dispatchReseed(editor, nextDoc);
}

/**
 * Re-seed an embedded TipTap editor from `nextDoc` and restore its caret to the
 * position it logically occupied BEFORE the foreign edit, mapped through the
 * structural change rather than re-applied as a raw offset (EX-F8-02 + the
 * shared float-sync class).
 *
 * Captures the live selection, replaces the content through the re-seed door
 * (`onUpdate` suppressed, out of undo history), and applies the mapped
 * selection in the same transaction. Single owner for both the ExampleCard
 * body and every float body's caret restore so the mapping can't drift
 * between copies.
 */
export function reseedPreservingCaret(
  editor: Editor,
  nextDoc: JSONContent,
): void {
  const { from, to } = editor.state.selection;
  dispatchReseed(editor, nextDoc, (oldDoc, newDoc) => {
    // A FOREIGN edit (not the user's own typing) inserted exactly AT the caret
    // should leave the caret in place rather than push it along — so a
    // collapsed caret maps both ends with the same backward (`-1`) bias and
    // stays collapsed. A real range selection keeps its anchor backward / head
    // forward so a foreign insert at either boundary widens it the natural way.
    const collapsed = from === to;
    const mappedFrom = mapPosThroughReseed(oldDoc, newDoc, from, -1);
    const mappedTo = collapsed
      ? mappedFrom
      : mapPosThroughReseed(oldDoc, newDoc, to, 1);
    return {
      from: Math.min(mappedFrom, mappedTo),
      to: Math.max(mappedFrom, mappedTo),
    };
  });
}
