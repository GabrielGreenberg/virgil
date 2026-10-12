// @vitest-environment jsdom
/**
 * Task 1075 — Tab / Shift-Tab inside an interlinear-gloss row traverse EVERY
 * cell in order. Tab used to compute the next cell as `rowStart + 1 +
 * currentCell.nodeSize`, which is cell 1 only when the caret is in cell 0 —
 * from cell ≥ 1 it landed back in the current cell (equal widths) or in an
 * arbitrary one. Both directions now read boundaries through the ONE pure
 * `glossCellTab`, so they cannot diverge again.
 *
 * (The extension barrel transitively imports `@/lib/storage` — stubbed, the
 * sibling expex tests' pattern.)
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { getSchema } from "@tiptap/core";
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { glossCellTab } from "@/lib/tiptap/expex";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}

const schema: Schema = getSchema(buildEditorExtensions(mainCtx()));

/** A gloss block with ONE aligned row of the given cell texts. */
function glossDoc(cells: string[]): PMNode {
  const cell = (t: string) =>
    schema.nodes.glossCell.create(null, t ? schema.text(t) : undefined);
  const row = schema.nodes.alignedGlossRow.create(null, cells.map(cell));
  const gloss = schema.nodes.exampleGloss.create(null, [row]);
  return schema.nodes.doc.create(null, [
    schema.nodes.exampleBlock.create({ kind: "single" }, [gloss]),
  ]);
}

/** Content-start position of every glossCell, in document order. */
function cellStarts(doc: PMNode): { start: number; size: number }[] {
  const out: { start: number; size: number }[] = [];
  doc.descendants((n, pos) => {
    if (n.type.name === "glossCell") out.push({ start: pos + 1, size: n.content.size });
    return true;
  });
  return out;
}

function stateAt(doc: PMNode, pos: number): EditorState {
  const s = EditorState.create({ schema, doc });
  return s.apply(s.tr.setSelection(TextSelection.create(doc, pos)));
}

/** The transaction, asserting the key produced one. */
function must(r: Transaction | null | false): Transaction {
  if (!r) throw new Error(`expected a transaction, got ${String(r)}`);
  return r;
}

/** Which cell (index) holds `pos`, or -1. */
function cellOf(doc: PMNode, pos: number): number {
  return cellStarts(doc).findIndex((c) => pos >= c.start && pos <= c.start + c.size);
}

describe("glossCellTab (task 1075)", () => {
  // Unequal widths so a wrong sum can't accidentally land right.
  const doc = glossDoc(["the", "big", "ran-away"]);
  const cells = cellStarts(doc);

  it("Tab from every non-last cell lands at the START of the next cell", () => {
    for (let i = 0; i < cells.length - 1; i++) {
      const tr = must(glossCellTab(stateAt(doc, cells[i].start + 1), 1));
      expect(tr.selection.from).toBe(cells[i + 1].start);
    }
  });

  it("Tab from the last cell appends an empty cell and puts the caret inside it", () => {
    const tr = must(glossCellTab(stateAt(doc, cells[2].start + 2), 1));
        const after = cellStarts(tr.doc);
    expect(after).toHaveLength(4);
    expect(after[3].size).toBe(0);
    expect(tr.selection.from).toBe(after[3].start);
    expect(cellOf(tr.doc, tr.selection.from)).toBe(3);
  });

  it("Shift-Tab from every non-first cell lands at the END of the previous cell", () => {
    for (let i = 1; i < cells.length; i++) {
      const tr = must(glossCellTab(stateAt(doc, cells[i].start + 1), -1));
      expect(tr.selection.from).toBe(
        cells[i - 1].start + cells[i - 1].size,
      );
    }
  });

  it("Shift-Tab in the first cell is consumed with no transaction", () => {
    expect(glossCellTab(stateAt(doc, cells[0].start + 1), -1)).toBeNull();
  });

  it("Tab then Shift-Tab is a round trip through every cell", () => {
    let state = stateAt(doc, cells[0].start);
    const visited: number[] = [];
    for (let k = 0; k < cells.length - 1; k++) {
      state = state.apply(must(glossCellTab(state, 1)));
      visited.push(cellOf(state.doc, state.selection.from));
    }
    expect(visited).toEqual([1, 2]);
    for (let k = 0; k < cells.length - 1; k++) {
      state = state.apply(must(glossCellTab(state, -1)));
    }
    expect(cellOf(state.doc, state.selection.from)).toBe(0);
  });

  it("falls through (false) outside a gloss cell", () => {
    const d = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, schema.text("hello")),
    ]);
    expect(glossCellTab(stateAt(d, 2), 1)).toBe(false);
    expect(glossCellTab(stateAt(d, 2), -1)).toBe(false);
  });
});
