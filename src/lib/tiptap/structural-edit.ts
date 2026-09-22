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
import type { Fragment, Mark, Node as PMNode } from "@tiptap/pm/model";
import {
  projectInline,
  type InlineProjectionSegment,
} from "@/lib/inline-content";
import { TITLED_NODE_TYPES } from "@/lib/node-attr-sets";

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

/**
 * Build the new inline `Fragment` for a heading rename: change ONLY the
 * characters the user changed (task 707).
 *
 * The rename box was seeded from `projectInline(heading).text`; this reads the
 * SAME projection, so the seed and its inverse share one definition of what
 * each character is — editable text in some run, or display text of an opaque
 * atom (a footnote displays nothing: it is pinned between characters). Then:
 *
 *   - Diff the seed against the typed string, character by character.
 *   - An UNCHANGED text character keeps its own run's marks, so formatting the
 *     edit did not touch is byte-identical (the pre-707 splice stamped the
 *     first run's marks onto every rebuilt run: renaming one plain word of
 *     `The \emph{Tractatus} revisited` dropped the italics).
 *   - A typed character takes the marks of the text it replaced, or, for a
 *     pure insertion, of the character before it (after it at the start) —
 *     what typing at that spot in the editor would give.
 *   - Atoms are never deleted and never edited. An atom whose display chars
 *     the edit touched is kept whole, at its place; typed characters whose
 *     only effect was to overwrite or wedge into an atom's display are REFUSED
 *     (dropped) — the atom is not text. A zero-width atom is re-emitted at its
 *     boundary, after anything typed there (typing at the end of
 *     `Intro\footnote{…}` extends `Intro`).
 */
export function buildHeadingRenameFragment(
  editor: Editor,
  oldFrag: Fragment,
  newText: string,
): Fragment {
  const schema = editor.state.schema;
  const { text: oldText, segments } = projectInline(oldFrag);
  if (oldText === newText) return oldFrag;

  const children: PMNode[] = [];
  oldFrag.forEach((c) => children.push(c));
  const owner: InlineProjectionSegment[] = new Array(oldText.length);
  for (const seg of segments) {
    for (let k = seg.from; k < seg.to; k++) owner[k] = seg;
  }
  const marksOfChar = (o: number | undefined): readonly Mark[] | null =>
    o !== undefined && owner[o]?.kind === "text"
      ? children[owner[o].index].marks
      : null;

  const ops = diffChars(oldText, newText);

  // Per hunk (a maximal run of non-equal ops): do its insertions land, and
  // with which marks?
  const insMarks: (readonly Mark[] | null | "drop")[] = new Array(ops.length);
  for (let i = 0; i < ops.length; ) {
    if (ops[i].kind === "eq") { i++; continue; }
    let j = i;
    while (j < ops.length && ops[j].kind !== "eq") j++;
    const dels = ops.slice(i, j).filter((op) => op.kind === "del");
    const firstTextDel = dels.find((op) => owner[op.o].kind === "text");
    let verdict: readonly Mark[] | null | "drop";
    if (firstTextDel) {
      verdict = marksOfChar(firstTextDel.o);
    } else if (dels.length > 0) {
      verdict = "drop"; // it only overwrote atom display text
    } else {
      const prev = i > 0 ? ops[i - 1].o : undefined;
      const next = j < ops.length ? ops[j].o : undefined;
      const insideAtom =
        prev !== undefined &&
        next !== undefined &&
        owner[prev] === owner[next] &&
        owner[prev].kind === "atom";
      verdict = insideAtom ? "drop" : marksOfChar(prev) ?? marksOfChar(next) ?? [];
    }
    for (let k = i; k < j; k++) insMarks[k] = verdict;
    i = j;
  }

  const out: PMNode[] = [];
  const zeroWidth = segments.filter((s) => s.kind === "atom" && s.from === s.to);
  let zi = 0;
  const flushZeroWidth = (upTo: number) => {
    while (zi < zeroWidth.length && zeroWidth[zi].from <= upTo) {
      out.push(children[zeroWidth[zi].index]);
      zi++;
    }
  };
  const emittedAtoms = new Set<number>();
  ops.forEach((op, i) => {
    if (op.kind === "ins") {
      const m = insMarks[i];
      if (m !== "drop") out.push(schema.text(newText[op.n], m ?? undefined));
      return;
    }
    flushZeroWidth(op.o);
    const seg = owner[op.o];
    if (seg.kind === "atom") {
      if (!emittedAtoms.has(seg.index)) {
        emittedAtoms.add(seg.index);
        out.push(children[seg.index]);
      }
      return;
    }
    if (op.kind === "eq") {
      out.push(schema.text(oldText[op.o], children[seg.index].marks));
    }
  });
  flushZeroWidth(Infinity);
  return fragmentFromNodes(schema, out);
}

type DiffOp =
  | { kind: "eq"; o: number; n: number }
  | { kind: "del"; o: number; n?: undefined }
  | { kind: "ins"; n: number; o?: undefined };

/** Above this many DP cells the middle is diffed as one delete + insert. A
 *  heading is a few dozen characters; this only bounds a pathological paste. */
const MAX_DIFF_CELLS = 250_000;

/** A character diff of `a` → `b`: the common prefix and suffix are equal, the
 *  middle is a longest-common-subsequence walk (deletions before insertions on
 *  a tie). */
function diffChars(a: string, b: string): DiffOp[] {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (
    s < a.length - p &&
    s < b.length - p &&
    a[a.length - 1 - s] === b[b.length - 1 - s]
  ) s++;
  const ops: DiffOp[] = [];
  for (let k = 0; k < p; k++) ops.push({ kind: "eq", o: k, n: k });
  const n = a.length - p - s;
  const m = b.length - p - s;
  if (n === 0 || m === 0 || n * m > MAX_DIFF_CELLS) {
    for (let k = 0; k < n; k++) ops.push({ kind: "del", o: p + k });
    for (let k = 0; k < m; k++) ops.push({ kind: "ins", n: p + k });
  } else {
    const w = m + 1;
    const lcs = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * w + j] =
          a[p + i] === b[p + j]
            ? lcs[(i + 1) * w + j + 1] + 1
            : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[p + i] === b[p + j]) {
        ops.push({ kind: "eq", o: p + i, n: p + j });
        i++;
        j++;
      } else if (j >= m || (i < n && lcs[(i + 1) * w + j] >= lcs[i * w + j + 1])) {
        ops.push({ kind: "del", o: p + i });
        i++;
      } else {
        ops.push({ kind: "ins", n: p + j });
        j++;
      }
    }
  }
  for (let k = s; k > 0; k--) {
    ops.push({ kind: "eq", o: a.length - k, n: b.length - k });
  }
  return ops;
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
 * (the C2 DATA-LOSS fix, `OUT-F5-01`). `newText` is the edited
 * `projectInline` string the rename input was seeded with; this splices back
 * only the characters that changed (task 707).
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
 * Set a block's `parTitle` attr, addressed by uuid. The domain is
 * {@link TITLED_NODE_TYPES} — the set that DECLARES the attr — so the
 * mutator's reach equals the set's.
 *
 * Task 404 replaced the NEGATIVE guard this carried (`!== "heading"`, which
 * closed `OUT-F8-04` by naming the one type to refuse). A negative guard's
 * domain is "everything but heading": it happens to admit every titled kind,
 * and it also admits every type that declares no `parTitle` at all, where
 * ProseMirror silently drops the attr and the rename reads as a mis-write
 * that did nothing. The positive test refuses a heading exactly as before —
 * `heading` is not a member — and refuses the rest for the same reason.
 * A uuid that doesn't resolve to a titled block is a NO-OP (`OUT-F5-02`).
 */
export function renameParTitleByUuid(
  editor: Editor,
  uuid: string,
  newTitle: string,
): boolean {
  const trimmed = newTitle.trim();
  return editStructuredNodeByUuid(editor, uuid, {
    guard: (node) => TITLED_NODE_TYPES.has(node.type.name),
    setAttrs: (attrs) => ({ ...attrs, parTitle: trimmed ? trimmed : null }),
  });
}

