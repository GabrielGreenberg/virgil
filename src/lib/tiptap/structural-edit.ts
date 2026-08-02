/**
 * The node-tree-preserving structural-edit primitive (T3 / C2 write side).
 *
 * Every outline structural mutator used to do one of two lossy things:
 *
 *   1. **Flatten-then-reinsert.** `handleRenameHeading` did
 *      `tr.delete(from, to).insertText(newPlainText, from)` — annihilating every
 *      inline atom (`inlineMath` / `citation` / `labelRef`) and mark that lived
 *      in the heading. The new label came from a FLATTENED text projection
 *      (`extractText`, which drops every non-text node), so the loss was locked
 *      in at the seed, before the transaction even ran. This is the C2 DATA-LOSS
 *      bug `OUT-F5-01`: renaming `\section{The $G$-action on \citet{foo}}` to
 *      `The G-action on Foo 2020` would silently destroy the math and the cite.
 *
 *   2. **Address by a drift-prone integer `blockIndex`.** Each mutator captured a
 *      block index from a (debounced / possibly stale) outline snapshot and
 *      applied it to the LIVE doc with — for `handleRenameParTitle` — NO
 *      node-type guard, so a drifted index could stamp `parTitle` onto a heading
 *      or throw (`OUT-F5-02` / `OUT-F8-04`). Focus-mode already migrated off
 *      integer indices onto UUID anchoring to fix exactly this; the outline
 *      mutators never followed.
 *
 * This module replaces both with ONE primitive that:
 *   - addresses the target block by its durable `uuid` attr (drift-proof),
 *   - guards the node type (`assertType`),
 *   - edits the node's CURRENT inline content as a `Fragment` (never flattens),
 *   - or sets attrs in place (`setAttrs`, for parTitle / label),
 *   - and gates the commit on a caller predicate (`guard`, for the duplicate-
 *     label block `OUT-F8-03` / `OUT-F5-03` — the warning and the commit now
 *     read the SAME source of truth so they can never disagree).
 *
 * Keystroke sanctity: this runs ONLY in the structural rename/label/reorder
 * action path (a user clicking "rename" / committing a label), never per
 * keystroke. The flatten that seeds the rename input lives in the outline's
 * structural-counter-gated memo; nothing here subscribes to the editor.
 */

import type { Editor, JSONContent } from "@tiptap/react";
import type { Fragment, Node as PMNode } from "@tiptap/pm/model";
import { atomTextOf } from "@/lib/inline-content";

// ---------------------------------------------------------------------------
// UUID addressing
// ---------------------------------------------------------------------------

/**
 * Find the position + node of the FIRST node carrying `attrs.uuid === uuid`.
 * The outline addresses every block by its durable insert-stable uuid (the same
 * key the fold registry and focus band use), so this is the drift-proof
 * replacement for the integer `blockIndex` walk.
 *
 * O(doc) but called only on a structural action (rename / label / reorder),
 * never per keystroke.
 */
export function findNodeByUuid(
  editor: Editor,
  uuid: string,
): { node: PMNode; pos: number } | null {
  let found: { node: PMNode; pos: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found) return false;
    if (node.attrs?.uuid === uuid) {
      found = { node, pos };
      return false;
    }
    return true;
  });
  return found;
}

/**
 * Shallow attr-equality for the no-op-tx bail. Compares the UNION of own keys,
 * normalizing `undefined` ≡ `null` so a schema default that is absent on one
 * side (attr not materialized) doesn't read as a change against an explicit
 * `null` (heading/parTitle/label all default to `null`, so `null → null` must
 * compare equal and bail). Heading/parTitle/label attrs are flat primitives, so
 * a shallow compare is sufficient.
 */
export function shallowEqualAttrs(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const norm = (v: unknown) => (v === undefined ? null : v);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (norm(a[k]) !== norm(b[k])) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// editStructuredNodeByUuid — the single primitive
// ---------------------------------------------------------------------------

export interface EditStructuredNodeOpts {
  /** Node-type guard. When set, the edit is a NO-OP (returns false) unless the
   *  uuid resolves to a node of this type — closes the `OUT-F5-02` / `OUT-F8-04`
   *  drift class (a parTitle rename can no longer stamp a heading). */
  assertType?: string;
  /** Transform the node's CURRENT inline content fragment into the new one.
   *  Receives the live fragment so atoms/marks the edit doesn't touch survive
   *  untouched. Mutually compatible with `setAttrs`. */
  editInlineContent?: (frag: Fragment) => Fragment;
  /** Transform the node's attrs in place (parTitle / label). */
  setAttrs?: (attrs: Record<string, unknown>) => Record<string, unknown>;
  /** Commit gate. When it returns false the edit is a NO-OP (returns false) —
   *  the duplicate-label block reads the SAME `isLabelTaken` predicate the live
   *  warning reads, so the warning can never disagree with the commit
   *  (`OUT-F8-03` / `OUT-F5-03`). */
  guard?: (node: PMNode) => boolean;
}

/**
 * Apply a structural edit to the block whose `uuid` is `uuid`, addressing by
 * UUID (not integer index) and preserving the node tree (never flattening to
 * plaintext). Returns true if a transaction was dispatched, false on any no-op
 * (uuid not found / type mismatch / guard rejected / nothing to change).
 */
export function editStructuredNodeByUuid(
  editor: Editor,
  uuid: string,
  opts: EditStructuredNodeOpts,
): boolean {
  const hit = findNodeByUuid(editor, uuid);
  if (!hit) return false;
  const { node, pos } = hit;

  // Type guard (OUT-F5-02 / OUT-F8-04): refuse to write the wrong node kind.
  if (opts.assertType && node.type.name !== opts.assertType) return false;

  // Commit gate (OUT-F8-03 / OUT-F5-03): the duplicate-label block.
  if (opts.guard && !opts.guard(node)) return false;

  let tr = editor.state.tr;
  let changed = false;

  // Inline-content edit — preserve the node tree. Replace the heading's inner
  // range with the new fragment via `replaceWith` so marks/atoms outside the
  // edited text runs are carried through verbatim.
  if (opts.editInlineContent) {
    const nextFrag = opts.editInlineContent(node.content);
    // Only dispatch if the content actually changed (avoid a no-op tx that
    // would still bump structural counters).
    if (!node.content.eq(nextFrag)) {
      const from = pos + 1;
      const to = pos + node.nodeSize - 1;
      tr = tr.replaceWith(from, to, nextFrag);
      changed = true;
    }
  }

  // Attr edit (parTitle / label) — setNodeMarkup at the node's own pos.
  if (opts.setAttrs) {
    const nextAttrs = opts.setAttrs({ ...(node.attrs as Record<string, unknown>) });
    // Only dispatch if the attrs actually changed (avoid a no-op tx that would
    // still bump structural counters + push a phantom undo step) — mirrors the
    // `editInlineContent` guard above. A same-value commit (incl. label
    // `null → null` from blurring an unlabeled heading's "+") is now a true
    // no-op: `editStructuredNodeByUuid` returns false, the doc is not dirtied.
    if (!shallowEqualAttrs(node.attrs as Record<string, unknown>, nextAttrs)) {
      // `mapping` keeps the attr edit valid after a content replace above.
      const mappedPos = tr.mapping.map(pos);
      tr = tr.setNodeMarkup(mappedPos, undefined, nextAttrs);
      changed = true;
    }
  }

  if (!changed) return false;
  editor.view.dispatch(tr);
  return true;
}

// ---------------------------------------------------------------------------
// Heading-rename inline edit — the atom-preserving text splice (OUT-F5-01)
// ---------------------------------------------------------------------------

/** A segment of a heading's flattened projection: either a stretch of plain
 *  text (editable) or an atom (opaque, its display text is non-editable). */
interface FlatSegment {
  kind: "text" | "atom";
  /** The display text this segment contributes to the flat projection. */
  display: string;
  /** For a text segment: the source child index in the fragment (for marks). */
  node: PMNode;
}

/** The display text an inline atom contributes to a heading's flat projection —
 *  the same projection the rename input is seeded from (`flattenInlineText`).
 *  Falls back through the attr-text registry, then command/displayText. */
function atomDisplay(node: PMNode): string {
  const fromRegistry = atomTextOf(
    node.type.name,
    node.attrs as Record<string, unknown>,
  );
  if (fromRegistry !== null) return fromRegistry;
  const attrs = node.attrs as Record<string, unknown>;
  return (
    (attrs.displayText as string) ||
    (attrs.command as string) ||
    (attrs.label as string) ||
    ""
  );
}

/** Project a heading's inline fragment into ordered segments, so a rename can
 *  reason about which spans of the flat string are editable text vs opaque
 *  atoms. */
function segmentFragment(frag: Fragment): FlatSegment[] {
  const segs: FlatSegment[] = [];
  frag.forEach((child) => {
    if (child.isText) {
      segs.push({ kind: "text", display: child.text ?? "", node: child });
    } else {
      segs.push({ kind: "atom", display: atomDisplay(child), node: child });
    }
  });
  return segs;
}

/**
 * Build the new inline `Fragment` for a heading rename that PRESERVES every
 * inline atom and mark.
 *
 * Strategy (design §3b "pure-text edit around atoms"):
 *   - The old flat projection is the concatenation of segment display strings.
 *     The rename `<input>` was seeded from that exact projection.
 *   - If the new typed string still contains every atom's display substring in
 *     order (the common case — the user fixed/added words AROUND the atoms),
 *     splice the new text into the gaps between atom displays, reusing the
 *     FIRST text run's marks for each rebuilt text node, and keep the atom
 *     nodes verbatim. Atoms survive.
 *   - Otherwise (the user retyped over an atom's display position), fall back to
 *     a guarded whole-content replace: emit the new string as a single text run
 *     followed by EVERY atom the user didn't type over, appended in order — so
 *     we still never silently DELETE an atom; worst case it lands at the end.
 *
 * `schema` builds the replacement text nodes; `markFrom` supplies the marks to
 * stamp onto rebuilt text (the heading's first text run, so bold/etc. carry).
 */
export function buildHeadingRenameFragment(
  editor: Editor,
  oldFrag: Fragment,
  newText: string,
): Fragment {
  const schema = editor.state.schema;
  const segs = segmentFragment(oldFrag);
  const atoms = segs.filter((s) => s.kind === "atom");

  // Marks to carry onto rebuilt text: the first text run's marks (so a fully
  // bold heading stays bold after a rename).
  const firstText = segs.find((s) => s.kind === "text");
  const carryMarks = firstText ? firstText.node.marks : undefined;

  const mkText = (t: string): PMNode | null =>
    t.length > 0 ? schema.text(t, carryMarks) : null;

  // No atoms → a plain text replace is lossless by definition.
  if (atoms.length === 0) {
    const tn = mkText(newText);
    return fragmentFromNodes(schema, tn ? [tn] : []);
  }

  // --- Pure-text-edit fast-path: every atom display still present in order. ---
  let cursor = 0;
  let ok = true;
  const atomCutPoints: number[] = []; // [startOfAtomDisplay] in newText, in order
  for (const atom of atoms) {
    if (atom.display.length === 0) {
      // A zero-width atom (e.g. a citation with empty display) can't be located
      // by substring search; bail to the safe fallback.
      ok = false;
      break;
    }
    const at = newText.indexOf(atom.display, cursor);
    if (at < 0) {
      ok = false;
      break;
    }
    atomCutPoints.push(at);
    cursor = at + atom.display.length;
  }

  if (ok) {
    // Walk the original segment order, emitting: leading text gap, atom verbatim,
    // … using the located cut points to slice `newText` into the text gaps.
    const out: PMNode[] = [];
    let textCursor = 0;
    let atomIdx = 0;
    for (const seg of segs) {
      if (seg.kind === "atom") {
        const cut = atomCutPoints[atomIdx];
        // The text gap before this atom = newText[textCursor .. cut].
        const gap = newText.slice(textCursor, cut);
        const tn = mkText(gap);
        if (tn) out.push(tn);
        out.push(seg.node); // atom verbatim — preserved
        textCursor = cut + seg.display.length;
        atomIdx++;
      }
      // text segments are absorbed into the gaps; skip here.
    }
    // Trailing text after the last atom.
    const tail = newText.slice(textCursor);
    const tn = mkText(tail);
    if (tn) out.push(tn);
    return fragmentFromNodes(schema, out);
  }

  // --- Fallback: never DELETE an atom. New text first, then atoms verbatim. ---
  const out: PMNode[] = [];
  const head = mkText(newText);
  if (head) out.push(head);
  for (const atom of atoms) out.push(atom.node);
  return fragmentFromNodes(schema, out);
}

// ---------------------------------------------------------------------------
// Fragment helpers (schema-bound, avoid importing prosemirror-model directly)
// ---------------------------------------------------------------------------

function fragmentFromNodes(
  schema: Editor["state"]["schema"],
  nodes: PMNode[],
): Fragment {
  // Mint a fragment via a throwaway heading node so we use the schema's own
  // Fragment implementation without a direct prosemirror-model import.
  return schema.nodes.heading.create(null, nodes).content;
}

// ---------------------------------------------------------------------------
// High-level mutators (consumed by editor-ops.ts)
// ---------------------------------------------------------------------------

/**
 * Rename a heading, addressed by uuid, PRESERVING every inline atom and mark
 * (the C2 DATA-LOSS fix, `OUT-F5-01`). `newText` is the flattened display
 * string the rename input produced; this splices it back around the heading's
 * atoms instead of replacing the whole content with plaintext.
 */
export function renameHeadingByUuid(
  editor: Editor,
  uuid: string,
  newText: string,
): boolean {
  return editStructuredNodeByUuid(editor, uuid, {
    assertType: "heading",
    editInlineContent: (frag) => buildHeadingRenameFragment(editor, frag, newText),
  });
}

/**
 * Set a block's `parTitle` attr, addressed by uuid. The block can be a
 * paragraph / bulletList / orderedList — anything BUT a heading (a heading uses
 * its own rename), so we refuse a heading explicitly to close `OUT-F8-04`. A
 * uuid that doesn't resolve to a parTitle-bearing block is a NO-OP, not a
 * mis-write (`OUT-F5-02`).
 */
export function renameParTitleByUuid(
  editor: Editor,
  uuid: string,
  newTitle: string,
): boolean {
  const trimmed = newTitle.trim();
  return editStructuredNodeByUuid(editor, uuid, {
    // No heading: par titles never live on headings.
    guard: (node) => node.type.name !== "heading",
    setAttrs: (attrs) => ({ ...attrs, parTitle: trimmed ? trimmed : null }),
  });
}

/**
 * Set (or clear) a heading's `\label{}`, addressed by uuid. `isTaken` reads the
 * SAME central label registry the live warning reads, so a duplicate-label
 * commit is BLOCKED, never accepted against the advisory warning
 * (`OUT-F8-03` / `OUT-F5-03`). Clearing (newLabel null/empty) is always allowed.
 */
export function updateHeadingLabelByUuid(
  editor: Editor,
  uuid: string,
  newLabel: string | null,
  isTaken: (candidate: string, excludeLabel: string | null) => boolean,
): boolean {
  const trimmed = newLabel && newLabel.trim() ? newLabel.trim() : null;
  return editStructuredNodeByUuid(editor, uuid, {
    assertType: "heading",
    guard: (node) => {
      if (!trimmed) return true; // clearing is always allowed
      const existing = (node.attrs.label as string | null) ?? null;
      // Block when the candidate is taken by ANOTHER label (excluding our own).
      return !isTaken(trimmed, existing);
    },
    setAttrs: (attrs) => ({ ...attrs, label: trimmed }),
  });
}
