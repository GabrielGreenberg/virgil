/**
 * **The linked-range float's write door** — the float→main leg of a popped-out
 * text range, measured before it lands (task 842).
 *
 * A linked-range float mounts the main doc's `[from, to)` cut in its OWN
 * editor (`buildEditorExtensions({ surface: "float" })`) and writes every edit
 * back by replacing the WHOLE range in main. That replace is only safe if the
 * float actually HELD everything it replaces. Two ways it might not:
 *
 *  1. SEED LOSS — the range carries a node (or a content shape) the float
 *     schema cannot represent. TipTap mounts with `enableContentCheck: false`,
 *     so the float silently mounts an EMPTY doc (see `schema-mount.ts`), and
 *     the first keystroke replaced the user's whole range with one paragraph.
 *     (`maketitleMarker` was main-only until this task — the one live case.)
 *  2. PARSE LOSS — a float child the MAIN schema cannot rebuild. The old
 *     write-back `try{}catch{}`-SKIPPED such a child and replaced the range
 *     anyway, so the block was gone from the paper — with
 *     `addToHistory: false`, not even undoable.
 *
 * Both are the capture/schema-symmetry law ("never delete what you cannot
 * restore") and the write-path law ("a write the user did not ask for is
 * measured"). So the door ASKS both schemas before building a transaction and
 * REFUSES — no dispatch — rather than skipping. Pure (no React, no view): the
 * body dispatches what this returns, and the tests drive it directly.
 *
 * Cost: one slice + one `nodeFromJSON` of the RANGE per float edit — the same
 * order as the `getJSON` the write-back already pays; never document-sized.
 */
import type { JSONContent } from "@tiptap/core";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { blocksToRangeSlice, rangeSliceToBlocks } from "./linked-anchor-range";
import {
  canMountInSchema,
  invalidContentNodes,
  unsupportedConstructs,
} from "./tiptap/schema-mount";

/**
 * The float's view of `doc`'s `[from, to)`: the shared `rangeSliceToBlocks`
 * transform (an inline run → one paragraph; a multi-block cut → its blocks —
 * the SAME transform the `text-range-move` drop uses), wrapped as a doc.
 * `null` when the cut cannot be taken — a caller must treat that as "cannot
 * represent", never substitute an empty paragraph for it.
 */
export function linkedRangeAsDoc(
  doc: PMNode,
  range: { from: number; to: number },
): JSONContent | null {
  try {
    const blocks = rangeSliceToBlocks(
      doc.slice(range.from, range.to),
      doc.type.schema,
    );
    return {
      type: "doc",
      content: blocks.map((n) => n.toJSON() as JSONContent),
    };
  } catch {
    return null;
  }
}

/** Why a linked range cannot round-trip through its float. */
export interface LinkedRangeRefusal {
  ok: false;
  /** ProseMirror's own message, for the console. */
  reason: string;
  /** What to NAME to the user: the node/mark types the schema lacks, else the
   *  node types whose content it cannot hold in that shape. May be empty. */
  constructs: string[];
}

function refusal(schema: Schema, json: unknown, reason: string): LinkedRangeRefusal {
  const missing = unsupportedConstructs(schema, json);
  return {
    ok: false,
    reason,
    constructs: missing.length > 0 ? missing : invalidContentNodes(schema, json),
  };
}

/**
 * Can the float schema hold the source range? Asked at seed (so the float can
 * say so and stay read-only) and again on every write (the authority — main
 * may have changed under the float since it was seeded).
 */
export function checkLinkedRangeRepresentable(
  floatSchema: Schema,
  source: JSONContent | null,
): { ok: true } | LinkedRangeRefusal {
  if (!source) {
    return {
      ok: false,
      reason: "the linked range could not be sliced from the document",
      constructs: [],
    };
  }
  const check = canMountInSchema(floatSchema, source);
  return check.ok ? check : refusal(floatSchema, source, check.reason);
}

/**
 * Build the float→main write-back for `range`, or refuse.
 *
 * - `{ ok: true, tr: null }` — nothing to write (unchanged, or no blocks).
 * - `{ ok: true, tr }` — dispatch it (the caller adds its own metas).
 * - `{ ok: false, … }` — do NOT write; main is untouched.
 */
export function planLinkedRangeWriteBack(
  state: EditorState,
  range: { from: number; to: number },
  floatDoc: JSONContent,
  floatSchema: Schema,
): { ok: true; tr: Transaction | null } | LinkedRangeRefusal {
  // 1. Did the float hold everything the replace would remove?
  const held = checkLinkedRangeRepresentable(
    floatSchema,
    linkedRangeAsDoc(state.doc, range),
  );
  if (!held.ok) return held;
  // 2. Can main rebuild EVERY child the float would write? All or nothing —
  //    a skipped child is a deleted block.
  const parsed = canMountInSchema(state.schema, floatDoc);
  if (!parsed.ok) return refusal(state.schema, floatDoc, parsed.reason);
  const blocks: PMNode[] = (floatDoc.content ?? []).map((c) =>
    state.schema.nodeFromJSON(c),
  );
  if (blocks.length === 0) return { ok: true, tr: null };
  // The faithful INVERSE of the seed extraction: a Slice that reuses the
  // current cut's open depths (or unwraps a single inline paragraph), so an
  // unedited round-trip is byte-identical and an edited one preserves the
  // boundary paragraphs (the L3f-7 bug was replacing with closed blocks).
  const slice = blocksToRangeSlice(state.doc, range, blocks);
  const tr = state.tr.replace(range.from, range.to, slice);
  // A replace step counts as `docChanged` even when it rebuilds the same
  // content; an unedited round trip must not reach main as a write at all.
  return { ok: true, tr: tr.docChanged && !tr.doc.eq(state.doc) ? tr : null };
}

/** The noun phrase a refusal names: its constructs, else a generic phrase. */
export function describeLinkedRangeRefusal(r: LinkedRangeRefusal): string {
  const names = r.constructs.map((n) => `“${n}”`);
  if (names.length === 0) return "content";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
