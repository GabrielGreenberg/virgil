// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { EditorState, Plugin } from "@tiptap/pm/state";
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
