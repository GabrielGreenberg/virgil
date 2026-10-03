// Task 2026-10-03-922 — what a node contributes to the structure snapshot is
// answered ONCE (`extractEntitiesAt`). Before 922 the load walk
// (`buildInitial`) and the step walk (`inspectNodeAt`) each hand-built every
// entry kind, and each divergence bug in this module (213, 651, 652) was one
// field drifting between the copies.
//
// Two guards:
//   1. CONGRUENCE — inserting a varied document from empty and folding the
//      step diff yields the same snapshot `buildInitial` builds from scratch.
//   2. STATIC — neither walk file branches on a node type name to construct
//      an entity; that belongs to the extractor alone.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EditorState } from "@tiptap/pm/state";
import { inspectSteps } from "../step-inspector";
import { applyDiff, buildInitial } from "../structure-index";
import type { DocStructure } from "../types";
import {
  anchoredText,
  citationNode,
  doc,
  exampleBlock,
  exampleItem,
  exampleItemWith,
  figureBlock,
  footnoteNode,
  heading,
  paragraph,
  testSchema,
} from "./fixtures";

function varied() {
  return doc(
    heading("h1", 1, "Intro", { label: "sec:intro" }),
    heading("h2", 2, "Unlabelled", { numbered: false }),
    testSchema.nodes.paragraph.create({ uuid: "p1", parTitle: "A title" }, [
      testSchema.text("see "),
      citationNode("c1", "citep", "Smith 2020"),
      testSchema.text(" and "),
      footnoteNode("fn1", 1),
      testSchema.text(" "),
      anchoredText("marked", "a1", "highlight"),
      testSchema.text(" plain "),
      anchoredText("again", "a1", "highlight"),
    ]),
    figureBlock("f1", "fig:one"),
    figureBlock("f2", "", false),
    exampleBlock("e1", { tag: "ex1", label: "ex:one" }, [
      exampleItem({ label: "ex:item" }, "first"),
      exampleItemWith({}, [testSchema.text("cite "), citationNode("c2", "cite", "Doe")]),
    ]),
    exampleBlock("", { tag: "", label: "ex:labelonly" }),
    paragraph("p2", "tail"),
  );
}

/** Order-insensitive projection of a snapshot (the incremental fold need not
 *  reproduce array order to be congruent; every field must match). */
function project(s: DocStructure) {
  const byKey = <T>(xs: Iterable<T>, k: (x: T) => string) =>
    [...xs].sort((a, b) => k(a).localeCompare(k(b)));
  return {
    blocks: byKey(s.blocks.values(), (b) => b.uuid),
    headings: byKey(s.headings, (h) => h.uuid),
    figures: byKey(s.figures, (f) => f.uuid),
    examples: byKey(s.examples, (e) => e.id),
    footnotes: byKey(s.footnotes, (f) => f.id),
    citations: byKey(s.citations, (c) => c.id),
    labels: byKey(s.labels.values(), (l) => l.id),
    anchors: byKey(s.anchors.values(), (a) => a.id),
  };
}

describe("entity extractor — load path ≡ step path (task 922)", () => {
  it("folding a from-empty insertion equals buildInitial of the same content", () => {
    const target = varied();
    const start = EditorState.create({ schema: testSchema, doc: doc(paragraph("p0", "")) });
    const tr = start.tr.replaceWith(0, start.doc.content.size, target.content);
    const folded = applyDiff(buildInitial(start.doc), inspectSteps(tr, start.doc, tr.doc));
    const fresh = buildInitial(tr.doc);

    expect(project(folded)).toEqual(project(fresh));
    // Not vacuous: every entity kind is present.
    const p = project(fresh);
    for (const [kind, xs] of Object.entries(p)) {
      expect(xs.length, kind).toBeGreaterThan(0);
    }
    expect(p.labels.map((l) => l.id)).toEqual(
      ["ex:item", "ex:labelonly", "ex:one", "fig:one", "sec:intro"],
    );
    expect(p.citations.find((c) => c.id === "c2")?.nestedInContainerId).toEqual({
      kind: "example",
      id: "e1",
    });
  });

  it("neither walk constructs entities by branching on a node type name", () => {
    for (const file of ["structure-index.ts", "step-inspector.ts"]) {
      const src = readFileSync(join(__dirname, "..", file), "utf8");
      for (const kind of ["heading", "figureBlock", "exampleItem", "citation"]) {
        expect(src, `${file} branches on "${kind}"`).not.toMatch(
          new RegExp(`typeName === "${kind}"`),
        );
      }
      expect(src, `${file} calls the shared extractor`).toMatch(/extractEntitiesAt\(/);
    }
  });
});
