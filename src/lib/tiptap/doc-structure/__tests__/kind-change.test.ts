/**
 * Task 921 — identity vs KIND. A same-uuid TYPE change (a heading demoted to
 * a paragraph by `setNode`, which copies the uuid) used to emit an EMPTY diff:
 * the survivor guard asked "does this uuid survive anywhere?" when the
 * headings table's question is "does a HEADING with this uuid survive?", and
 * the block reconciler never compared `typeName`. The snapshot kept a ghost
 * heading (numbering, Outline, breadcrumb stale) and a stale `typeName`.
 *
 * Every case pins the end of the chain: `applyDiff(prev, diff)` must equal a
 * fresh `buildInitial(newDoc)` for every kind-keyed table.
 */
import { describe, expect, it } from "vitest";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { inspectSteps } from "../step-inspector";
import { applyDiff, buildInitial } from "../structure-index";
import type { DocStructure, StructureDiff } from "../types";
import { doc, figureBlock, heading, paragraph, testSchema } from "./fixtures";

const P = testSchema.nodes.paragraph;
const H = testSchema.nodes.heading;

function run(
  oldDoc: PMNode,
  edit: (tr: Transaction) => Transaction,
): { diff: StructureDiff; next: DocStructure; fresh: DocStructure } {
  const s = EditorState.create({ schema: testSchema, doc: oldDoc });
  const prev = buildInitial(oldDoc);
  const tr = edit(s.tr);
  const diff = inspectSteps(tr, s.doc, tr.doc, prev);
  return { diff, next: applyDiff(prev, diff), fresh: buildInitial(tr.doc) };
}

/**
 * Incremental-vs-rebuild congruence over every kind-keyed table. Positions are
 * compared only when the edit preserves document size: in production the
 * observer maps the previous snapshot's positions through `tr.mapping` BEFORE
 * `applyDiff` (`mapStructurePositions`), a step this harness does not repeat.
 */
function expectCongruent(next: DocStructure, fresh: DocStructure, withPos = true): void {
  const at = (pos: number) => (withPos ? `@${pos}` : "");
  const blocks = (s: DocStructure) =>
    [...s.blocks.values()]
      .map((b) => `${b.uuid}:${b.typeName}${at(b.pos)}:${b.parTitled}`)
      .sort();
  expect(blocks(next)).toEqual(blocks(fresh));
  expect(next.headings.map((h) => `${h.uuid}${at(h.pos)}`)).toEqual(
    fresh.headings.map((h) => `${h.uuid}${at(h.pos)}`),
  );
  expect(next.figures.map((f) => f.uuid)).toEqual(fresh.figures.map((f) => f.uuid));
  expect(next.examples.map((e) => e.id)).toEqual(fresh.examples.map((e) => e.id));
  expect([...next.labels.keys()].sort()).toEqual([...fresh.labels.keys()].sort());
}

describe("inspectSteps — same-uuid kind change (task 921)", () => {
  it("demoting a heading (setNodeMarkup) removes it from headings and refreshes typeName", () => {
    const { diff, next, fresh } = run(doc(heading("h1", 1, "Title"), paragraph("p2", "x")), (tr) =>
      tr.setNodeMarkup(0, P, { uuid: "h1" }),
    );
    expect(diff.removedHeadings.map((h) => h.uuid)).toEqual(["h1"]);
    expect(diff.changedBlocks.map((b) => `${b.uuid}:${b.typeName}`)).toEqual(["h1:paragraph"]);
    // Nothing moved and no title flipped — position-keyed consumers stay asleep.
    expect(diff.blockOrderChanged).toBe(false);
    expect(diff.blockParTitleChanged).toBe(false);
    // The block identity survives: not removed, not re-added.
    expect(diff.removedBlocks).toEqual([]);
    expect(diff.addedBlocks).toEqual([]);
    expect(next.headings).toEqual([]);
    expect(next.blocks.get("h1")?.typeName).toBe("paragraph");
    expectCongruent(next, fresh);
  });

  // TipTap's `setNode` copies the old attrs; the bare PM `setBlockType` does
  // not, so the uuid is passed explicitly to model the production path.
  it("demoting via setBlockType (the MenuBar / `% ` path) behaves the same", () => {
    const { diff, next, fresh } = run(
      doc(heading("h1", 1, "One"), heading("h2", 1, "Two"), paragraph("p3", "x")),
      (tr) => tr.setBlockType(0, 1, P, { uuid: "h1" }),
    );
    expect(diff.removedHeadings.map((h) => h.uuid)).toEqual(["h1"]);
    expect(next.headings.map((h) => h.uuid)).toEqual(["h2"]);
    expectCongruent(next, fresh);
  });

  it("demoting a labelled heading drops its label too", () => {
    const { diff, next, fresh } = run(
      doc(heading("h1", 1, "Title", { label: "sec:a" }), paragraph("p2", "x")),
      (tr) => tr.setNodeMarkup(0, P, { uuid: "h1" }),
    );
    expect(diff.removedLabels.map((l) => l.id)).toEqual(["sec:a"]);
    expectCongruent(next, fresh);
  });

  it("promoting a paragraph to a heading adds the heading and refreshes typeName", () => {
    const { diff, next, fresh } = run(doc(paragraph("p1", "Title"), paragraph("p2", "x")), (tr) =>
      tr.setNodeMarkup(0, H, { uuid: "p1", level: 2 }),
    );
    expect(diff.addedHeadings.map((h) => h.uuid)).toEqual(["p1"]);
    expect(diff.changedBlocks.map((b) => `${b.uuid}:${b.typeName}`)).toEqual(["p1:heading"]);
    expect(diff.blockOrderChanged).toBe(false);
    expectCongruent(next, fresh);
  });

  it("a figure that survives as a different kind leaves the figures table", () => {
    const { diff, next, fresh } = run(doc(figureBlock("f1", "fig:a"), paragraph("p2", "x")), (tr) =>
      tr.setNodeMarkup(0, P, { uuid: "f1" }),
    );
    expect(diff.removedFigures.map((f) => f.uuid)).toEqual(["f1"]);
    expect(next.figures).toEqual([]);
    expectCongruent(next, fresh);
  });

  it("a multi-step transaction (insert ahead + demote) stays congruent with a rebuild", () => {
    const { diff, next, fresh } = run(
      doc(paragraph("p0", "lead"), heading("h1", 1, "One"), heading("h2", 1, "Two")),
      (tr) => {
        tr.insertText("more ", 1);
        // heading h1 starts after p0 (now 2 + 9 = 11 tokens).
        return tr.setBlockType(11, 12, P, { uuid: "h1" });
      },
    );
    expect(diff.removedHeadings.map((h) => h.uuid)).toEqual(["h1"]);
    expect(diff.changedBlocks.map((b) => `${b.uuid}:${b.typeName}`)).toEqual(["h1:paragraph"]);
    expectCongruent(next, fresh, false);
  });

  it("an attr-only heading edit (level change) still emits no block change", () => {
    const { diff, next, fresh } = run(doc(heading("h1", 1, "Title")), (tr) =>
      tr.setNodeMarkup(0, undefined, { uuid: "h1", level: 2 }),
    );
    expect(diff.changedHeadings.map((h) => h.uuid)).toEqual(["h1"]);
    expect(diff.removedHeadings).toEqual([]);
    expect(diff.changedBlocks).toEqual([]);
    expectCongruent(next, fresh);
  });
});
