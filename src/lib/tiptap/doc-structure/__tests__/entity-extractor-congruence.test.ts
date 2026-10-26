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
import { CARD_ATOM_ID_ATTRS, CARD_ATOMS } from "@/lib/tiptap/atom-registry";
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

  // Every node name the extractor answers for: its structural blocks plus the
  // card atoms, which come from the atom registry (task 1300).
  const EXTRACTED_NODE_NAMES = [
    "heading",
    "figureBlock",
    "exampleBlock",
    "exampleItem",
    ...CARD_ATOMS.map((a) => a.nodeName),
  ];
  /** A type-name comparison in any form: `typeName === "x"`,
   *  `node.type.name !== "x"`, `n?.type.name === "x"`. */
  const typeNameTest = (name: string) =>
    new RegExp(`(?:\\btypeName|\\.type\\.name)\\s*[!=]==\\s*"${name}"`);

  it("neither walk constructs entities by branching on a node type name", () => {
    for (const file of ["structure-index.ts", "step-inspector.ts"]) {
      const src = readFileSync(join(__dirname, "..", file), "utf8");
      for (const name of EXTRACTED_NODE_NAMES) {
        expect(src, `${file} branches on "${name}"`).not.toMatch(typeNameTest(name));
      }
      expect(src, `${file} calls the shared extractor`).toMatch(/extractEntitiesAt\(/);
    }
  });

  // Task 1300 — the card atoms' node names AND id attrs are the registry's
  // facts. A hand-spelled `typeName === "footnote"` / `attrs.footnoteId`
  // agrees with the registry only by coincidence: a third card atom would be
  // silently absent from the snapshot. No structure file may spell either.
  it("no structure file spells a card atom's node name or id attr", () => {
    for (const file of ["entity-extractor.ts", "structure-index.ts", "step-inspector.ts"]) {
      const src = readFileSync(join(__dirname, "..", file), "utf8");
      for (const { nodeName } of CARD_ATOMS) {
        expect(src, `${file} compares a type name to "${nodeName}"`).not.toMatch(
          typeNameTest(nodeName),
        );
      }
      for (const idAttr of CARD_ATOM_ID_ATTRS) {
        expect(src, `${file} reads .${idAttr} by hand`).not.toMatch(
          new RegExp(`\\.${idAttr}\\b`),
        );
      }
    }
  });

  it("every registered card atom contributes its entry, keyed by its registry id attr", () => {
    for (const { kind, nodeName, idAttr } of CARD_ATOMS) {
      const type = testSchema.nodes[nodeName];
      expect(type, `test schema lacks "${nodeName}"`).toBeDefined();
      const d = doc(
        testSchema.nodes.paragraph.create({ uuid: "p1" }, [
          type.create({ [idAttr]: `id-${kind}` }),
        ]),
      );
      const s = buildInitial(d);
      const ids = [...s.footnotes, ...s.citations].map((e) => e.id);
      expect(ids, kind).toContain(`id-${kind}`);
    }
  });
});
