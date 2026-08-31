// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { EditorState, Plugin, TextSelection } from "@tiptap/pm/state";
import { lift } from "@tiptap/pm/commands";
import { Schema } from "@tiptap/pm/model";
import type { Node as PMNode } from "@tiptap/pm/model";
import { blockUuidBackfillPlugin } from "@/lib/tiptap/block-uuid-backfill";
import {
  applyDiff,
  buildInitial,
  docStructureKey,
  EMPTY_DIFF,
  inspectSteps,
  type DocStructure,
  type StructureDiff,
} from "@/lib/tiptap/doc-structure";
import { doc, paragraph, testSchema } from "../doc-structure/__tests__/fixtures";

// Mirrors the real observer's plugin-state shape (observer-plugin.ts). The
// explicit `Plugin<PluginState>` generic is load-bearing: without it the state
// type is inferred from `init`'s return, narrowing `pendingDiff` to the literal
// `null` so `apply` can't return a `StructureDiff`.
interface PluginState {
  structure: DocStructure;
  pendingMaps: readonly never[];
  pendingDiff: StructureDiff | null;
}

// A faithful stand-in for DocStructureObserver's PM plugin, built from the same
// exported primitives the real observer uses (`buildInitial` / `inspectSteps` /
// `applyDiff`). It populates the exact plugin state `readDocStructure` /
// `readPendingDiff` read, so the backfill sees a real known-uuid set — without
// needing a full TipTap Editor + view. Position-mapping is the only omission;
// the backfill never reads structure positions (only uuid keys), so it's
// irrelevant here.
function observerPlugin(): Plugin<PluginState> {
  return new Plugin<PluginState>({
    key: docStructureKey,
    state: {
      init: (_c, state) => ({ structure: buildInitial(state.doc), pendingMaps: [], pendingDiff: null }),
      apply: (tr, prev) => {
        if (!tr.docChanged) {
          return prev.pendingDiff !== null
            ? { structure: prev.structure, pendingMaps: [], pendingDiff: null }
            : prev;
        }
        const diff = inspectSteps(tr, tr.before, tr.doc, prev.structure);
        if (diff === EMPTY_DIFF) return { structure: prev.structure, pendingMaps: [], pendingDiff: null };
        return { structure: applyDiff(prev.structure, diff), pendingMaps: [], pendingDiff: diff };
      },
    },
  });
}

function makeState(initial: PMNode): EditorState {
  return EditorState.create({
    schema: testSchema,
    doc: initial,
    plugins: [observerPlugin(), blockUuidBackfillPlugin()],
  });
}

/** Every paragraph/heading uuid in the doc, in document order. */
function blockUuids(d: PMNode): Array<string | null> {
  const out: Array<string | null> = [];
  d.descendants((n) => {
    if (n.type.name === "paragraph" || n.type.name === "heading") {
      out.push((n.attrs.uuid as string | null) ?? null);
    }
  });
  return out;
}

/** Position of the gap right after the first top-level block. */
function afterFirstBlock(state: EditorState): number {
  const first = state.doc.firstChild;
  return first ? first.nodeSize : 0;
}

// ── A container schema, for the LIFT case (ReplaceAroundStep) ───────────────
// `fixtures.testSchema` has no wrapper node, and the lift transition needs one:
// a `paragraph` inside a DEFERRING_PARENT (`blockquote`) correctly carries no
// uuid of its own, and becomes anchorable the moment it reaches top level.
const quoteSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      attrs: { uuid: { default: null } },
      toDOM: () => ["p", 0],
    },
    blockquote: {
      group: "block",
      content: "block+",
      attrs: { uuid: { default: null } },
      toDOM: () => ["blockquote", 0],
    },
    text: { group: "inline" },
  },
});

const quoteDoc = (...blocks: PMNode[]) => quoteSchema.node("doc", null, blocks);
const qPara = (uuid: string | null, txt: string) =>
  quoteSchema.node("paragraph", { uuid }, txt ? [quoteSchema.text(txt)] : []);
const blockquote = (...blocks: PMNode[]) =>
  quoteSchema.node("blockquote", { uuid: "Q1" }, blocks);

function quoteState(initial: PMNode): EditorState {
  return EditorState.create({
    schema: quoteSchema,
    doc: initial,
    plugins: [observerPlugin(), blockUuidBackfillPlugin()],
  });
}

function quoteBlockUuids(d: PMNode): Array<string | null> {
  const out: Array<string | null> = [];
  d.descendants((n) => {
    if (n.type.name === "paragraph") out.push((n.attrs.uuid as string | null) ?? null);
    return true;
  });
  return out;
}

describe("BlockUuidBackfill", () => {
  it("backfills a null uuid AND re-mints a duplicate, keeping the first occurrence", () => {
    // Pre-existing block carries uuid "aaaa".
    const state = makeState(doc(paragraph("aaaa", "Original")));
    const at = afterFirstBlock(state);

    // One transaction inserts three blocks after it:
    //   • a bare null-uuid paragraph (the dropped/pasted-run case),
    //   • a paragraph carrying the DUPLICATE uuid "aaaa",
    //   • a paragraph with a fresh, legitimate uuid "bbbb".
    const tr = state.tr.insert(at, [
      paragraph(null, "Dropped run"),
      paragraph("aaaa", "Duplicate"),
      paragraph("bbbb", "Fresh"),
    ]);
    const { state: next, transactions } = state.applyTransaction(tr);

    // Exactly one backfill transaction was appended (root + 1 backfill) — and
    // no more, proving the appendTransaction loop terminates (no re-trigger).
    expect(transactions).toHaveLength(2);

    const uuids = blockUuids(next.doc);
    expect(uuids).toHaveLength(4);
    // None null.
    expect(uuids.every((u) => typeof u === "string" && u.length > 0)).toBe(true);
    // All unique.
    expect(new Set(uuids).size).toBe(4);
    // First occurrence ("aaaa") preserved on the original block.
    expect(uuids[0]).toBe("aaaa");
    // The legitimately-fresh "bbbb" is preserved (not a duplicate of anything).
    expect(uuids).toContain("bbbb");
    // The duplicate "aaaa" was re-minted to a fresh 4-hex id (not "aaaa").
    expect(uuids[2]).not.toBe("aaaa");
    expect(uuids[2]).toMatch(/^[0-9a-f]{4}$/);
    // The null one was filled with a fresh 4-hex id.
    expect(uuids[1]).toMatch(/^[0-9a-f]{4}$/);
  });

  it("makes a single inserted null-uuid block graspable (the reported drop bug)", () => {
    const state = makeState(doc(paragraph("p001", "Body")));
    const at = afterFirstBlock(state);
    const tr = state.tr.insert(at, paragraph(null, "Just dropped"));
    const { state: next } = state.applyTransaction(tr);

    const uuids = blockUuids(next.doc);
    expect(uuids).toHaveLength(2);
    expect(uuids[1]).toMatch(/^[0-9a-f]{4}$/); // the dropped block now has identity
    expect(new Set(uuids).size).toBe(2);
  });

  it("does NO work on a structurally-null keystroke (no backfill, no churn)", () => {
    const state = makeState(doc(paragraph("p001", "Hello")));
    // Type " world" inside the paragraph (pos 6 = end of "Hello", before close).
    const tr = state.tr.insertText(" world", 6);
    const { state: next, transactions } = state.applyTransaction(tr);

    // No appended backfill transaction — the plugin early-returned.
    expect(transactions).toHaveLength(1);
    // uuid untouched, text grew, still one block.
    const uuids = blockUuids(next.doc);
    expect(uuids).toEqual(["p001"]);
    expect(next.doc.firstChild?.textContent).toBe("Hello world");
  });

  it("preserves a block's uuid across a move (remove + re-insert in one tx)", () => {
    const state = makeState(
      doc(paragraph("aaaa", "Movable"), paragraph("bbbb", "Anchor")),
    );
    const firstSize = state.doc.firstChild!.nodeSize;
    // One transaction: delete the "aaaa" block, re-insert a block carrying the
    // SAME uuid at the end. A move must keep its identity, not get re-minted.
    const tr = state.tr.delete(0, firstSize);
    tr.insert(tr.doc.content.size, paragraph("aaaa", "Movable (moved)"));
    const { state: next, transactions } = state.applyTransaction(tr);

    // Nothing needed fixing → no backfill appended.
    expect(transactions).toHaveLength(1);
    const uuids = blockUuids(next.doc);
    expect(uuids).toHaveLength(2);
    expect(uuids).toContain("aaaa"); // identity preserved across the move
    expect(uuids).toContain("bbbb");
    expect(new Set(uuids).size).toBe(2);
  });

  // ── Per-step coordinates (task 320) ──────────────────────────────────────
  // The net was blind to the exact transaction shape every relocation gesture
  // uses: delete here, insert there, in ONE transaction. It read every step's
  // positions against `tr.before` and mapped them through the FULL `tr.mapping`,
  // re-applying the earlier steps' maps to positions that already reflected
  // them — for an insert BELOW the deleted range that collapses the inserted
  // range to nothing, so zero candidates, no backfill, and a duplicate uuid
  // reaching the document with CI green. The direction matters: the same tx with
  // the insert ABOVE the cut happened to map correctly and did fire, which is
  // why one of these two cases passed all along.
  it("re-mints a duplicate inserted BELOW the deleted range in the same tx", () => {
    const state = makeState(
      doc(paragraph("aaaa", "Source"), paragraph("bbbb", "Tail")),
    );
    // Cut the SOURCE's text only (a text-bounded range move: the block survives
    // as an empty shell still holding "aaaa"), then insert a copy at the end.
    const tr = state.tr.delete(1, 1 + "Source".length);
    tr.insert(tr.doc.content.size, paragraph("aaaa", "Source"));
    const { state: next, transactions } = state.applyTransaction(tr);

    expect(transactions).toHaveLength(2); // the backfill fired
    const uuids = blockUuids(next.doc);
    expect(uuids).toHaveLength(3);
    expect(new Set(uuids).size).toBe(3);
    expect(uuids[0]).toBe("aaaa"); // first occurrence keeps it
    expect(uuids[2]).toMatch(/^[0-9a-f]{4}$/);
    expect(uuids[2]).not.toBe("aaaa");
  });

  it("still preserves identity across a multi-step MOVE (delete + re-insert below)", () => {
    // The mirror of the case above, and the one the per-step fix must not
    // break: the source block is removed WHOLE, so the re-inserted copy is a
    // move and keeps its uuid. This only holds if the removed-range walk reads
    // each step against the doc BEFORE that step.
    const state = makeState(
      doc(paragraph("aaaa", "Movable"), paragraph("bbbb", "Anchor")),
    );
    const firstSize = state.doc.firstChild!.nodeSize;
    const tr = state.tr.delete(0, firstSize);
    tr.insert(tr.doc.content.size, paragraph("aaaa", "Movable (moved)"));
    const { state: next, transactions } = state.applyTransaction(tr);

    expect(transactions).toHaveLength(1); // nothing needed fixing
    expect(blockUuids(next.doc)).toEqual(["bbbb", "aaaa"]);
  });

  // The other half of the per-step change, and the direction that bites HARDEST
  // if the range is taken from the step's StepMap instead of its span: a
  // `ReplaceAroundStep`'s map reports only its two SIDE ranges and deliberately
  // omits the GAP — the preserved content that changes PARENT. Anchorability
  // here is a function of the parent (`isDeferredInnerParagraph`), so a
  // paragraph LIFTED out of a blockquote / listItem becomes a first-class text
  // object entirely inside that gap. Read from the map alone, every
  // toggle-list-off, toggle-blockquote-off and Backspace-at-list-start left the
  // lifted block with a NULL uuid — no `data-uuid`, no grab handle, unreachable
  // as a card/marginalia anchor: verbatim the bug this plugin exists to fix.
  // RENEGOTIATED IN PLACE (task 499). This leg was written for the task-320
  // half — "read the range from the StepMap and the lifted block gets NO id at
  // all" — and pinned a FRESH id as the contract, which was the best the net
  // could do while it only ever MINTED. It is the wrong contract: what left the
  // document was the container's identity, and a fresh id on the lifted block
  // is exactly the stranger the reported bug is about (the card follows the
  // dead uuid, the orphan guard strips its links, the resurrection guard leaves
  // an empty husk above the user's own text). The 320 property this leg exists
  // for — the gap is walked at all, so the lifted block is anchorable — is
  // unchanged and still asserted: a non-null id lands either way, and neutering
  // the per-step span still fails this leg.
  it("CONSERVES the container's uuid for a block LIFTED out of it (ReplaceAroundStep gap)", () => {
    const state = quoteState(
      quoteDoc(blockquote(qPara(null, "inner")), qPara("zzzz", "after")),
    );
    // Caret inside the quoted paragraph, then lift it to top level — one
    // ReplaceAroundStep whose gap carries the paragraph across parents.
    const sel = TextSelection.create(state.doc, 3);
    const lifted = state.apply(state.tr.setSelection(sel));
    let out: EditorState = lifted;
    lift(lifted, (tr) => {
      out = lifted.apply(tr);
    });

    const uuids = quoteBlockUuids(out.doc);
    expect(out.doc.firstChild?.type.name).toBe("paragraph"); // it really lifted
    expect(uuids).toHaveLength(2);
    // The lifted paragraph is anchorable — and it is the SUCCESSOR of the
    // blockquote the lift dissolved, so it carries that blockquote's identity
    // rather than a stranger's.
    expect(uuids[0]).toBe("Q1");
    expect(uuids[1]).toBe("zzzz");
  });

  // ── the re-parent transfer's two quiet guards (task 499) ─────────────────
  // Both are one-line conditions inside `planReparentTransfer` whose absence
  // changes nothing about any gesture in the app, so neither is visible to the
  // behavioural sweep in `reparent-identity-conservation.test.ts`. An invariant
  // with no leg is a habit.

  it("a deliberate attribute write is NOT read as a re-parenting", () => {
    // `tr.setNodeMarkup` IS a `ReplaceAroundStep` of exactly the RETYPE shape
    // (`gapFrom = from + 1`, `insert = 1`), so without the type-change gate the
    // transfer would hand a uuid straight back to the node whose attrs the
    // caller has just written — silently undoing a deliberate clear.
    const state = makeState(doc(paragraph("aaaa", "Body")));
    const tr = state.tr.setNodeMarkup(0, undefined, {
      ...state.doc.firstChild!.attrs,
      uuid: null,
    });
    const { state: next } = state.applyTransaction(tr);
    // The clear stands; the net then mints a FRESH id (its ordinary job for a
    // bare anchorable block), never the one the caller removed.
    const [only] = blockUuids(next.doc);
    expect(only).toMatch(/^[0-9a-f]{4}$/);
    expect(only).not.toBe("aaaa");
  });

  it("a freed identity that something else in the batch RE-CREATED is not handed on", () => {
    // The liveness gate. Lift the quoted paragraph out (freeing `Q1`) and, in
    // the SAME transaction, insert another blockquote still carrying `Q1`.
    // `Q1` is not free, so the lifted paragraph must mint rather than collide.
    const state = quoteState(
      quoteDoc(blockquote(qPara(null, "inner")), qPara("zzzz", "after")),
    );
    const sel = TextSelection.create(state.doc, 3);
    const lifted = state.apply(state.tr.setSelection(sel));
    let out: EditorState = lifted;
    lift(lifted, (tr) => {
      tr.insert(tr.doc.content.size, blockquote(qPara(null, "clone")));
      out = lifted.apply(tr);
    });

    const all: Array<string | null> = [];
    out.doc.descendants((n) => {
      if (n.type.name === "paragraph" || n.type.name === "blockquote") {
        all.push((n.attrs.uuid as string | null) ?? null);
      }
      return true;
    });
    // Exactly one live `Q1` — the re-created blockquote — and the lifted
    // paragraph carries a fresh id instead of a duplicate.
    expect(all.filter((u) => u === "Q1")).toHaveLength(1);
    expect(out.doc.firstChild?.type.name).toBe("paragraph");
    expect(out.doc.firstChild?.attrs.uuid).toMatch(/^[0-9a-f]{4}$/);
    expect(out.doc.firstChild?.attrs.uuid).not.toBe("Q1");
  });

  it("fills every block of a multi-block paste (all null uuids → all unique)", () => {
    const state = makeState(doc(paragraph("p001", "Body")));
    const at = afterFirstBlock(state);
    const tr = state.tr.insert(at, [
      paragraph(null, "Pasted A"),
      paragraph(null, "Pasted B"),
      paragraph(null, "Pasted C"),
    ]);
    const { state: next } = state.applyTransaction(tr);

    const uuids = blockUuids(next.doc);
    expect(uuids).toHaveLength(4);
    expect(uuids[0]).toBe("p001"); // pre-existing block untouched
    // The three pasted blocks each got a fresh 4-hex id.
    for (const u of uuids.slice(1)) expect(u).toMatch(/^[0-9a-f]{4}$/);
    expect(new Set(uuids).size).toBe(4); // all distinct, none collide with "p001"
  });
});
