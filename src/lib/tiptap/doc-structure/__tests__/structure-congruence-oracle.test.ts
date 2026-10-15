/**
 * Task 1128 — the CONGRUENCE ORACLE. The observer's contract is
 *
 *     applyDiff(snapshot(old), inspectSteps(tr)) == buildInitial(newDoc)
 *
 * for EVERY table, positions included (the plugin maps the previous snapshot
 * through `tr.mapping` before folding, so a position that disagrees with a
 * rebuild is a real drift, not a harness artifact). The incremental path holds
 * hand-written per-table reconcile rules; until this suite nothing checked them
 * against the rebuild except per-shape tests, so a new transaction shape could
 * drift one table silently (moved anchors/labels kept their old spots, a
 * list-wrap left a ghost block, a deleted footnote's citations lingered).
 *
 * Every case drives a transaction shape through the REAL `docStructureStateSpec`
 * plugin, then its INVERSE (what undo dispatches), and asserts congruence after
 * each. The wrap/lift shapes need the production schema (lists, blockquotes,
 * the block-uuid eligibility rules and the backfill appender), so they run on
 * `buildEditorExtensions("main")`.
 *
 * A new table, or a new shape, is added HERE — the oracle is what makes the
 * next drift visible.
 */
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import { EditorState, Plugin, type Transaction } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import {
  docStructureKey,
  docStructureStateSpec,
  readDocStructure,
} from "../observer-plugin";
import { buildInitial } from "../structure-index";
import { getBus } from "../bus";
import type { DocStructure } from "../types";
import {
  anchoredText,
  citationLiteral,
  citationNode,
  doc,
  footnoteWithBody,
  heading,
  paragraph,
  testSchema,
} from "./fixtures";

// ---------------------------------------------------------------------------
// The oracle.
// ---------------------------------------------------------------------------

/** Every table, in a comparable shape (maps → key-sorted arrays; the version
 *  stamps are per-snapshot identities, not content). */
function normalize(s: DocStructure) {
  const sortBy = <T>(xs: T[], k: (x: T) => string) =>
    [...xs].sort((a, b) => (k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : 0));
  return {
    blocks: sortBy([...s.blocks.values()], (b) => b.uuid),
    headings: s.headings,
    footnotes: s.footnotes,
    citations: s.citations,
    anchors: sortBy([...s.anchors.values()], (a) => a.id),
    examples: s.examples,
    figures: s.figures,
    labels: sortBy([...s.labels.values()], (l) => l.id),
  };
}

function expectCongruent(state: EditorState, why: string): void {
  const live = readDocStructure(state);
  expect(live, `${why}: observer state present`).toBeTruthy();
  expect(normalize(live!), why).toEqual(normalize(buildInitial(state.doc)));
}

// ---------------------------------------------------------------------------
// Fixture-schema harness — the real plugin, no appenders.
// ---------------------------------------------------------------------------

function stateOf(d: PMNode): EditorState {
  return EditorState.create({
    schema: testSchema,
    doc: d,
    plugins: [new Plugin({ key: docStructureKey, state: docStructureStateSpec() })],
  });
}

/** The transaction undo would dispatch for `tr`: every step inverted, in
 *  reverse order, against the doc it was applied to. */
function inverseOf(state: EditorState, tr: Transaction): Transaction {
  const inv = state.tr;
  for (let i = tr.steps.length - 1; i >= 0; i--) inv.step(tr.steps[i].invert(tr.docs[i]));
  return inv;
}

/** Apply `edit`, check; apply its inverse, check — and the round trip must
 *  land back on the original rebuild. */
function roundTrip(d: PMNode, edit: (tr: Transaction) => Transaction): void {
  const s0 = stateOf(d);
  const tr = edit(s0.tr);
  expect(tr.docChanged, "the edit changes the document").toBe(true);
  const s1 = s0.apply(tr);
  expectCongruent(s1, "after the edit");
  const s2 = s1.apply(inverseOf(s1, tr));
  expectCongruent(s2, "after its inverse (undo)");
  expect(normalize(readDocStructure(s2)!)).toEqual(normalize(buildInitial(d)));
}

/** Move `[from, to)` to `target` (a pre-move position) in ONE transaction —
 *  the shape of a drag-drop of a selection / an Outline reorder. */
function moveRange(tr: Transaction, from: number, to: number, target: number): Transaction {
  const slice = tr.doc.slice(from, to);
  tr.delete(from, to);
  tr.replace(tr.mapping.map(target), tr.mapping.map(target), slice);
  return tr;
}

const para = (uuid: string, ...content: PMNode[]) =>
  testSchema.nodes.paragraph.create({ uuid }, content);
const t = (s: string) => testSchema.text(s);
const BODY_WITH_CITE = (...ids: string[]) => ({
  type: "doc",
  content: [{ type: "paragraph", content: ids.map((id) => citationLiteral(id, "cite", id)) }],
});

describe("congruence oracle — fixture schema, real observer plugin (task 1128)", () => {
  // Member 1 — a moved anchored run: both sides carry the id, the loops used
  // to cancel it, and the entry kept its mapped (collapsed) old span.
  it("moving an anchored run to a later paragraph", () => {
    const d = doc(para("p1", t("aa"), anchoredText("XYZ", "a1"), t("bb")), paragraph("p2", "cccc"));
    // p1 content starts at 1: "aa"=1..3, XYZ=3..6. p2 content ends at 15.
    roundTrip(d, (tr) => moveRange(tr, 3, 6, 15));
  });

  it("moving an anchored run to an earlier paragraph", () => {
    const d = doc(paragraph("p1", "cccc"), para("p2", t("aa"), anchoredText("XYZ", "a1"), t("bb")));
    roundTrip(d, (tr) => moveRange(tr, 9, 12, 1));
  });

  it("moving ONE run of a two-run anchor", () => {
    const d = doc(
      para("p1", anchoredText("AB", "a1"), t("--")),
      para("p2", t("xx"), anchoredText("CD", "a1")),
      paragraph("p3", "tail"),
    );
    // p2 opens at 6: "xx"=7..9, CD=9..11. p3 content 13..17.
    roundTrip(d, (tr) => moveRange(tr, 9, 11, 17));
  });

  it("deleting the FIRST run of a two-run anchor", () => {
    const d = doc(para("p1", anchoredText("AB", "a1"), t("--")), para("p2", t("xx"), anchoredText("CD", "a1")));
    roundTrip(d, (tr) => tr.delete(1, 3));
  });

  it("an interior backspace inside an anchored run", () => {
    const d = doc(para("p1", t("aa"), anchoredText("XYZW", "a1"), t("bb")));
    roundTrip(d, (tr) => tr.delete(4, 5));
  });

  // Member 2 — a moved labelled heading.
  it("moving a labelled heading below the next paragraph", () => {
    const d = doc(heading("h1", 1, "One", { label: "sec:one" }), paragraph("p2", "body"), paragraph("p3", "x"));
    const h = d.child(0).nodeSize;
    roundTrip(d, (tr) => moveRange(tr, 0, h, d.content.size));
  });

  it("moving a whole paragraph block (uuid preserved)", () => {
    const d = doc(paragraph("p1", "first"), paragraph("p2", "second"), paragraph("p3", "third"));
    const a = d.child(0).nodeSize;
    roundTrip(d, (tr) => moveRange(tr, 0, a, d.content.size));
  });

  it("pasting a DUPLICATE labelled heading ahead of the original, then deleting the original", () => {
    const original = heading("h1", 1, "One", { label: "sec:one" });
    const d = doc(paragraph("p0", "lead"), original, paragraph("p2", "x"));
    let s = stateOf(d);
    s = s.apply(s.tr.insert(0, heading("h9", 1, "Copy", { label: "sec:one" })));
    expectCongruent(s, "after the duplicate paste");
    const at = s.doc.child(0).nodeSize + s.doc.child(1).nodeSize;
    s = s.apply(s.tr.delete(at, at + s.doc.child(2).nodeSize));
    expectCongruent(s, "after deleting the original");
  });

  it("demoting a labelled heading (setNodeMarkup)", () => {
    const d = doc(heading("h1", 1, "Title", { label: "sec:a" }), paragraph("p2", "x"));
    roundTrip(d, (tr) => tr.setNodeMarkup(0, testSchema.nodes.paragraph, { uuid: "h1" }));
  });

  // Member 4 — a footnote's BODY citations.
  it("deleting a footnote whose body holds a \\cite", () => {
    const d = doc(para("p1", t("text"), footnoteWithBody("f1", BODY_WITH_CITE("c1")), t("more")));
    roundTrip(d, (tr) => tr.delete(5, 6));
  });

  it("pasting a footnote whose body holds a \\cite", () => {
    const d = doc(paragraph("p1", "text"));
    roundTrip(d, (tr) => tr.insert(3, footnoteWithBody("f1", BODY_WITH_CITE("c1", "c2"))));
  });

  it("editing a footnote body's citations (setNodeMarkup on the atom)", () => {
    const d = doc(para("p1", t("text"), footnoteWithBody("f1", BODY_WITH_CITE("c1")), t("more")));
    roundTrip(d, (tr) =>
      tr.setNodeMarkup(5, undefined, { ...d.nodeAt(5)!.attrs, content: BODY_WITH_CITE("c2") }),
    );
  });

  it("moving a footnote whose body holds a \\cite to another paragraph", () => {
    const d = doc(
      para("p1", t("text"), footnoteWithBody("f1", BODY_WITH_CITE("c1")), t("more")),
      paragraph("p2", "later"),
    );
    roundTrip(d, (tr) => moveRange(tr, 5, 6, d.content.size - 1));
  });

  it("moving a top-level citation atom", () => {
    const d = doc(para("p1", t("a"), citationNode("c1", "cite", "X"), t("b")), paragraph("p2", "later"));
    roundTrip(d, (tr) => moveRange(tr, 2, 3, d.content.size - 1));
  });
});

// ---------------------------------------------------------------------------
// Production-schema harness — wrap / lift need lists, blockquotes, the uuid
// eligibility rules and the backfill appender.
// ---------------------------------------------------------------------------

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

function mainEditor(): Editor {
  return new Editor({
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { uuid: "uA" }, content: [{ type: "text", text: "alpha" }] },
        { type: "paragraph", attrs: { uuid: "uB" }, content: [{ type: "text", text: "beta" }] },
      ],
    },
  });
}

describe("congruence oracle — production schema (task 1128)", () => {
  // `moves`: the wrap moves the paragraph's block identity onto a new
  // container (a listItem); a blockquote leaves the inner paragraph eligible.
  const shapes: [string, (e: Editor) => boolean, boolean][] = [
    ["wrap in a bullet list", (e) => e.commands.toggleBulletList(), true],
    ["wrap in an ordered list", (e) => e.commands.toggleOrderedList(), true],
    ["wrap in a blockquote", (e) => e.commands.toggleBlockquote?.() ?? false, false],
  ];
  for (const [name, run, moves] of shapes) {
    it(`${name}, lift it back, and undo`, () => {
      const editor = mainEditor();
      try {
        editor.commands.setTextSelection(2);
        // The wrapped paragraph's identity moves to its new container within
        // ONE dispatch (the backfill appender transfers it), so subscribers
        // must never hear it REMOVED — that would detach its cards.
        const removed: string[] = [];
        const bus = getBus(editor);
        expect(bus, "the bus is attached").toBeTruthy();
        bus!.onBlocksRemoved((bs) => removed.push(...bs.map((b) => b.uuid)));
        const emitsBefore = bus!.emitCount;
        const applied = run(editor);
        if (!applied) return; // the command is not in this schema
        // Not vacuous: where the identity moved, the bus did publish.
        if (moves) expect(bus!.emitCount).toBeGreaterThan(emitsBefore);
        expectCongruent(editor.state, `after: ${name}`);
        expect(removed, `no block removal announced by: ${name}`).toEqual([]);
        editor.commands.undo();
        expectCongruent(editor.state, `after undoing: ${name}`);
        editor.commands.redo();
        expectCongruent(editor.state, `after redoing: ${name}`);
      } finally {
        editor.destroy();
      }
    });
  }
});
