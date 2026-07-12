import { describe, expect, it } from "vitest";
import { applyDiff, buildInitial } from "../structure-index";
import { EMPTY_DIFF, type StructureDiff } from "../types";
import {
  anchoredText,
  citationLiteral,
  citationNode,
  doc,
  exampleBlock,
  exampleItem,
  exampleItemWith,
  figureBlock,
  footnoteNode,
  footnoteWithBody,
  heading,
  paragraph,
  testSchema,
} from "./fixtures";

describe("buildInitial", () => {
  it("collects every entity in document order", () => {
    const d = doc(
      heading("h1", 1, "Intro"),
      paragraph("p1", "body"),
      figureBlock("fig1", "fig:fish", true),
      exampleBlock("e1", { tag: "ex", label: "ex:1" }, [
        exampleItem({ label: "ex:1:a" }),
      ]),
    );
    const s = buildInitial(d);
    expect([...s.blocks.keys()].sort()).toEqual(["e1", "fig1", "h1", "p1"]);
    expect(s.headings.map((h) => h.uuid)).toEqual(["h1"]);
    expect(s.figures.map((f) => f.uuid)).toEqual(["fig1"]);
    expect(s.examples.map((e) => e.uuid)).toEqual(["e1"]);
    expect([...s.labels.keys()].sort()).toEqual(["ex:1", "ex:1:a", "fig:fish"]);
  });

  it("captures inline footnote nodes and linked-anchor marks", () => {
    const para = testSchema.nodes.paragraph.create(
      { uuid: "p1" },
      [
        anchoredText("anchored", "a1"),
        testSchema.text(" "),
        footnoteNode("fn1", 1, false),
      ],
    );
    const s = buildInitial(doc(para));
    expect(s.footnotes.map((f) => f.id)).toEqual(["fn1"]);
    expect([...s.anchors.keys()]).toEqual(["a1"]);
  });

  it("captures inline citation nodes in document order", () => {
    const para = testSchema.nodes.paragraph.create(
      { uuid: "p1" },
      [
        testSchema.text("see "),
        citationNode("c1", "\\cite{a}", "A"),
        testSchema.text(" and "),
        citationNode("c2", "\\cite{b}", "B"),
      ],
    );
    const s = buildInitial(doc(para));
    expect(s.citations.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(s.citations[0]?.command).toBe("\\cite{a}");
  });

  it("stamps structure version 3 (Phase 2a: generalized container-nested cite owner)", () => {
    const s = buildInitial(doc(paragraph("p1", "body")));
    expect(s.version).toBe(3);
  });

  it("surfaces a footnote-NESTED citation in structure.citations with its host footnote id (T3 / C10)", () => {
    // A footnote whose body literal holds a `\cite` — `descendants()` cannot
    // enter `attrs.content`, so the load-only descend pass must surface it.
    const body = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "see " },
            citationLiteral("nested-c", "\\cite{nested}", "Nested"),
          ],
        },
      ],
    };
    const para = testSchema.nodes.paragraph.create({ uuid: "p1" }, [
      testSchema.text("body "),
      footnoteWithBody("fn1", body, { linkId: "fn1" }),
    ]);
    const s = buildInitial(doc(para));

    expect(s.footnotes.map((f) => f.id)).toEqual(["fn1"]);
    const nested = s.citations.find((c) => c.id === "nested-c");
    expect(nested).toBeDefined();
    expect(nested?.nestedInFootnoteId).toBe("fn1");
    expect(nested?.command).toBe("\\cite{nested}");
    expect(nested?.displayText).toBe("Nested");
    // Phase 2a — the generalized container owner is populated alongside the
    // retained legacy field, carrying the SAME host id under kind "footnote".
    expect(nested?.nestedInContainerId).toEqual({ kind: "footnote", id: "fn1" });
  });

  it("uses the raw footnoteId (not linkId) as the nested-cite host id, for identity-consistency with the footnote's omni-item key", () => {
    // The nested-cite host id MUST be the footnote's canonical identity — the
    // raw `footnoteId` — because that is what `FootnoteEntry.id`, `FootnoteInfo
    // .footnoteId`, and the footnote omni item key (`cardPopKey("footnote",
    // footnoteId)`) all use. The footnote-child nesting (omni) resolves a nested
    // cite to its parent by matching `nestedInFootnoteId` against that key, so a
    // `linkId`-preferred host (when linkId !== footnoteId) would silently fail
    // to nest and degrade to a flat card. linkId was a lone inconsistency with
    // no consumer until nesting landed; we unify on footnoteId.
    const body = {
      type: "doc",
      content: [
        { type: "paragraph", content: [citationLiteral("c-x", "\\cite{x}", "X")] },
      ],
    };
    const para = testSchema.nodes.paragraph.create({ uuid: "p1" }, [
      footnoteWithBody("fn-legacy", body, { linkId: "fn-link" }),
    ]);
    const s = buildInitial(doc(para));
    expect(s.citations.find((c) => c.id === "c-x")?.nestedInFootnoteId).toBe(
      "fn-legacy",
    );
  });

  it("top-level and footnote-nested citations coexist; top-level carry no host id", () => {
    const body = {
      type: "doc",
      content: [
        { type: "paragraph", content: [citationLiteral("c-nested", "\\cite{n}", "N")] },
      ],
    };
    const para = testSchema.nodes.paragraph.create({ uuid: "p1" }, [
      citationNode("c-top", "\\cite{t}", "T"),
      testSchema.text(" "),
      footnoteWithBody("fn1", body, { linkId: "fn1" }),
    ]);
    const s = buildInitial(doc(para));

    const top = s.citations.find((c) => c.id === "c-top");
    const nested = s.citations.find((c) => c.id === "c-nested");
    expect(top?.nestedInFootnoteId).toBeUndefined();
    expect(nested?.nestedInFootnoteId).toBe("fn1");
    // Both present.
    expect(s.citations.map((c) => c.id).sort()).toEqual(["c-nested", "c-top"]);
  });

  it("a footnote with no body literal contributes no nested citation", () => {
    const para = testSchema.nodes.paragraph.create({ uuid: "p1" }, [
      footnoteNode("fn1", 1, false),
    ]);
    const s = buildInitial(doc(para));
    expect(s.footnotes.map((f) => f.id)).toEqual(["fn1"]);
    expect(s.citations).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Phase 2a — EXAMPLE-nested citations. Unlike a footnote-body cite (a
  // JSONContent literal), an example child is a real PM node the walk already
  // reaches; the load-only pass tags it with its enclosing exampleBlock so its
  // Omni card nests under the example's card.
  // -------------------------------------------------------------------------

  it("tags a citation inside an example block with nestedInContainerId.kind === 'example' + the example id", () => {
    const ex = exampleBlock("ex1", { tag: "myex" }, [
      exampleItemWith({}, [
        testSchema.text("see "),
        citationNode("c-in-ex", "\\cite{e}", "E"),
      ]),
    ]);
    const s = buildInitial(doc(paragraph("p1", "before"), ex));

    expect(s.examples.map((e) => e.id)).toEqual(["ex1"]);
    const cit = s.citations.find((c) => c.id === "c-in-ex");
    expect(cit).toBeDefined();
    expect(cit?.nestedInContainerId).toEqual({ kind: "example", id: "ex1" });
    // Example nesting routes ONLY through the generalized field — the legacy
    // footnote-only field stays undefined for an example-nested cite.
    expect(cit?.nestedInFootnoteId).toBeUndefined();
    // pos is the cite's OWN PM position (a real node), so a jump lands on it.
    expect(typeof cit?.pos).toBe("number");
  });

  it("tags multiple cites inside one example, all with the same example id, in document order", () => {
    const ex = exampleBlock("ex2", {}, [
      exampleItemWith({}, [
        citationNode("c-a", "\\cite{a}", "A"),
        testSchema.text(" and "),
        citationNode("c-b", "\\cite{b}", "B"),
      ]),
    ]);
    const s = buildInitial(doc(ex));

    const inEx = s.citations.filter(
      (c) => c.nestedInContainerId?.kind === "example",
    );
    expect(inEx.map((c) => c.id)).toEqual(["c-a", "c-b"]);
    expect(inEx.every((c) => c.nestedInContainerId?.id === "ex2")).toBe(true);
  });

  it("a citation OUTSIDE any example is NOT tagged (top-level, no container owner)", () => {
    // A cite after the example must not pick up the example's id once the walk
    // has exited the block's range (the enclosing-example stack pops on exit).
    const ex = exampleBlock("ex3", {}, [
      exampleItemWith({}, [citationNode("c-inside", "\\cite{i}", "I")]),
    ]);
    const after = testSchema.nodes.paragraph.create({ uuid: "p2" }, [
      citationNode("c-outside", "\\cite{o}", "O"),
    ]);
    const s = buildInitial(doc(ex, after));

    const inside = s.citations.find((c) => c.id === "c-inside");
    const outside = s.citations.find((c) => c.id === "c-outside");
    expect(inside?.nestedInContainerId).toEqual({ kind: "example", id: "ex3" });
    expect(outside?.nestedInContainerId).toBeUndefined();
    expect(outside?.nestedInFootnoteId).toBeUndefined();
  });

  it("returns EMPTY_STRUCTURE-shaped snapshot for an empty doc", () => {
    const s = buildInitial(doc(paragraph(null, "x")));
    // null-UUID block is not tracked as a block.
    expect(s.blocks.size).toBe(0);
    expect(s.headings).toHaveLength(0);
    expect(s.footnotes).toHaveLength(0);
    expect(s.anchors.size).toBe(0);
  });

  it("ignores headings with null UUID (lazy hydration)", () => {
    const lazyHeading = testSchema.nodes.heading.create(
      { uuid: null, level: 1 },
      testSchema.text("Unhydrated"),
    );
    const s = buildInitial(doc(lazyHeading));
    expect(s.headings).toHaveLength(0);
    expect(s.blocks.size).toBe(0);
  });
});

describe("applyDiff", () => {
  function makeBaseStructure() {
    return buildInitial(
      doc(
        heading("h1", 1, "Intro", { label: null }),
        paragraph("p1", "first body"),
        paragraph("p2", "second body"),
      ),
    );
  }

  it("EMPTY_DIFF leaves the snapshot intact (version still bumps)", () => {
    const prev = makeBaseStructure();
    const next = applyDiff(prev, EMPTY_DIFF);
    expect(next.version).toBe(prev.version + 1);
    expect([...next.blocks.keys()].sort()).toEqual(["h1", "p1", "p2"]);
  });

  it("adds and removes blocks idempotently", () => {
    const prev = makeBaseStructure();
    const removeP2: StructureDiff = {
      ...EMPTY_DIFF,
      removedBlocks: [{ uuid: "p2", pos: 99, typeName: "paragraph" }],
    };
    const afterRemove = applyDiff(prev, removeP2);
    expect([...afterRemove.blocks.keys()].sort()).toEqual(["h1", "p1"]);

    const addP3: StructureDiff = {
      ...EMPTY_DIFF,
      addedBlocks: [{ uuid: "p3", pos: 50, typeName: "paragraph" }],
    };
    const afterAdd = applyDiff(afterRemove, addP3);
    expect([...afterAdd.blocks.keys()].sort()).toEqual(["h1", "p1", "p3"]);
  });

  it("changedBlocks updates a moved block's position without adding/removing identity", () => {
    const prev = makeBaseStructure();
    const moveP2: StructureDiff = {
      ...EMPTY_DIFF,
      changedBlocks: [{ uuid: "p2", pos: 3, typeName: "paragraph" }],
      blockOrderChanged: true,
    };
    const next = applyDiff(prev, moveP2);
    // Identity set unchanged; only p2's tracked position moves.
    expect([...next.blocks.keys()].sort()).toEqual(["h1", "p1", "p2"]);
    expect(next.blocks.get("p2")?.pos).toBe(3);
  });

  it("changedHeadings replaces the matching entry without touching others", () => {
    const prev = makeBaseStructure();
    const changeH1: StructureDiff = {
      ...EMPTY_DIFF,
      changedHeadings: [
        { uuid: "h1", pos: 0, level: 2, text: "Intro", label: null, numbered: true },
      ],
    };
    const next = applyDiff(prev, changeH1);
    expect(next.headings).toHaveLength(1);
    expect(next.headings[0]?.level).toBe(2);
  });

  it("changedExamples folds a moved/renumbered example's new pos + number in place and re-sorts (task 2026-07-12-101)", () => {
    // The reorder-staleness fix: a same-uuid example move/renumber arrives as
    // changedExamples carrying the NEW pos/number. applyDiff must replace the
    // entry in place (no phantom add/remove) and re-sort so the index doesn't
    // keep the moved example's stale (deleted) position.
    const prev = buildInitial(
      doc(exampleBlock("e1", { number: 1 }), exampleBlock("e2", { number: 2 })),
    );
    expect(prev.examples.map((e) => e.id)).toEqual(["e1", "e2"]);
    const e2Pos = prev.examples.find((e) => e.id === "e2")!.pos;
    // Move e1 to AFTER e2 and renumber it (1)→(2), a larger pos than e2's.
    const moveE1: StructureDiff = {
      ...EMPTY_DIFF,
      changedExamples: [
        { id: "e1", uuid: "e1", pos: e2Pos + 4, tag: "", label: "", number: 2 },
      ],
      exampleStructureChanged: true,
    };
    const next = applyDiff(prev, moveE1);
    // Identity set unchanged — no orphan/dup.
    expect(next.examples.map((e) => e.id).sort()).toEqual(["e1", "e2"]);
    const e1 = next.examples.find((e) => e.id === "e1");
    expect(e1?.pos).toBe(e2Pos + 4);
    expect(e1?.number).toBe(2);
    // Re-sorted by pos: e2 now precedes e1.
    expect(next.examples[0]?.id).toBe("e2");
  });

  it("addedFootnotes preserves doc order via sort by pos", () => {
    const prev = buildInitial(doc(paragraph("p1", "body")));
    const diff: StructureDiff = {
      ...EMPTY_DIFF,
      addedFootnotes: [
        { id: "fn-late", pos: 50, thanks: false, number: 0 },
        { id: "fn-early", pos: 10, thanks: false, number: 0 },
      ],
    };
    const next = applyDiff(prev, diff);
    expect(next.footnotes.map((f) => f.id)).toEqual(["fn-early", "fn-late"]);
  });

  it("citations: add, change-in-place, and remove keep the list correct + ordered", () => {
    const prev = buildInitial(doc(paragraph("p1", "body")));
    const add: StructureDiff = {
      ...EMPTY_DIFF,
      addedCitations: [
        { id: "c-late", pos: 50, command: "\\cite{z}", displayText: "Z" },
        { id: "c-early", pos: 10, command: "\\cite{a}", displayText: "A" },
      ],
    };
    const afterAdd = applyDiff(prev, add);
    expect(afterAdd.citations.map((c) => c.id)).toEqual(["c-early", "c-late"]);

    const change: StructureDiff = {
      ...EMPTY_DIFF,
      changedCitations: [{ id: "c-early", pos: 10, command: "\\cite{a2}", displayText: "A2" }],
    };
    const afterChange = applyDiff(afterAdd, change);
    expect(afterChange.citations.find((c) => c.id === "c-early")?.command).toBe("\\cite{a2}");
    expect(afterChange.citations).toHaveLength(2);

    const remove: StructureDiff = {
      ...EMPTY_DIFF,
      removedCitations: [{ id: "c-late", pos: 50, command: "\\cite{z}", displayText: "Z" }],
    };
    const afterRemove = applyDiff(afterChange, remove);
    expect(afterRemove.citations.map((c) => c.id)).toEqual(["c-early"]);
  });

  // ---------------------------------------------------------------------------
  // Phase 2a regression — example-nested cite must keep its container tag across
  // an in-place edit / move. `buildInitial` stamps `nestedInContainerId` from
  // the enclosing exampleBlock, but the step-inspector rebuilds a
  // `changedCitations` entry from node attrs ALONE (no enclosing container), so
  // `applyDiff` must carry the prior owner tag forward — else the cite un-nests
  // to a flat card on every citekey edit / move until reload.
  // ---------------------------------------------------------------------------

  it("changedCitations on an example-nested cite KEEPS nestedInContainerId (core regression)", () => {
    const ex = exampleBlock("ex1", { tag: "myex" }, [
      exampleItemWith({}, [
        testSchema.text("see "),
        citationNode("c-in-ex", "\\cite{e}", "E"),
      ]),
    ]);
    const prev = buildInitial(doc(paragraph("p1", "before"), ex));
    // Sanity: the load pass tagged it under the example.
    const before = prev.citations.find((c) => c.id === "c-in-ex");
    expect(before?.nestedInContainerId).toEqual({ kind: "example", id: "ex1" });

    // A citekey edit AND a new position — the rebuilt entry carries NO tag.
    const change: StructureDiff = {
      ...EMPTY_DIFF,
      changedCitations: [
        { id: "c-in-ex", pos: 999, command: "\\cite{e2}", displayText: "E2" },
      ],
    };
    const after = applyDiff(prev, change);
    const cit = after.citations.find((c) => c.id === "c-in-ex");
    // The attr edit + new pos took effect…
    expect(cit?.command).toBe("\\cite{e2}");
    expect(cit?.pos).toBe(999);
    // …but the container tag SURVIVED (the regression being fixed).
    expect(cit?.nestedInContainerId).toEqual({ kind: "example", id: "ex1" });
  });

  it("changedCitations carries a footnote-nested cite's owner tag forward too (defensive)", () => {
    // Footnote-nested cites are stamped from a JSONContent literal the diff
    // can't enter, so they typically never appear in `changedCitations` (no own
    // PM node to edit). We still defensively carry `nestedInFootnoteId` +
    // `nestedInContainerId` forward if such an entry ever surfaces, so a
    // hypothetical change can't strip the tag. This synthesizes that prev shape.
    const fnBody = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [citationLiteral("c-in-fn", "\\cite{f}", "F")],
        },
      ],
    };
    const para = paragraph("p1", "body");
    const withFn = doc(para, footnoteWithBody("fn1", fnBody));
    const prev = buildInitial(withFn);
    const before = prev.citations.find((c) => c.id === "c-in-fn");
    expect(before?.nestedInFootnoteId).toBe("fn1");
    expect(before?.nestedInContainerId).toEqual({ kind: "footnote", id: "fn1" });

    const change: StructureDiff = {
      ...EMPTY_DIFF,
      changedCitations: [
        { id: "c-in-fn", pos: 42, command: "\\cite{f2}", displayText: "F2" },
      ],
    };
    const after = applyDiff(prev, change);
    const cit = after.citations.find((c) => c.id === "c-in-fn");
    expect(cit?.command).toBe("\\cite{f2}");
    expect(cit?.nestedInFootnoteId).toBe("fn1");
    expect(cit?.nestedInContainerId).toEqual({ kind: "footnote", id: "fn1" });
  });

  it("addedCitations with NO nestedInContainerId folds in as a FLAT top-level cite (graceful-degradation contract for the live-add limitation)", () => {
    // A cite ADDED live inside an example mid-session has no tag on the live
    // `addedCitations` path (the tag is load-only). It must degrade to a flat
    // top-level card — never be dropped — until reload re-runs buildInitial.
    const prev = buildInitial(doc(paragraph("p1", "body")));
    const add: StructureDiff = {
      ...EMPTY_DIFF,
      addedCitations: [
        { id: "c-live", pos: 20, command: "\\cite{live}", displayText: "Live" },
      ],
    };
    const after = applyDiff(prev, add);
    const cit = after.citations.find((c) => c.id === "c-live");
    expect(cit).toBeDefined();
    // Folded in (not dropped) and FLAT (no owner tag).
    expect(cit?.nestedInContainerId).toBeUndefined();
    expect(cit?.nestedInFootnoteId).toBeUndefined();
  });

  it("addedAnchors and removedAnchors update the anchors Map", () => {
    const prev = buildInitial(doc(paragraph("p1", "body")));
    const diff: StructureDiff = {
      ...EMPTY_DIFF,
      addedAnchors: [{ id: "a1", from: 1, to: 5, kind: "note" }],
    };
    const after = applyDiff(prev, diff);
    expect(after.anchors.get("a1")?.kind).toBe("note");

    const removeDiff: StructureDiff = {
      ...EMPTY_DIFF,
      removedAnchors: [{ id: "a1", from: 1, to: 5, kind: "note" }],
    };
    const back = applyDiff(after, removeDiff);
    expect(back.anchors.has("a1")).toBe(false);
  });

  it("addedLabels + removedLabels keep the labels Map in sync", () => {
    const prev = buildInitial(doc(paragraph("p1", "body")));
    const addDiff: StructureDiff = {
      ...EMPTY_DIFF,
      addedLabels: [
        { id: "fig:1", owner: "figure", ownerUuid: "fig1", pos: 10 },
        { id: "sec:1", owner: "heading", ownerUuid: "h1", pos: 0 },
      ],
    };
    const after = applyDiff(prev, addDiff);
    expect([...after.labels.keys()].sort()).toEqual(["fig:1", "sec:1"]);
  });

  it("monotonic version", () => {
    const prev = makeBaseStructure();
    const a = applyDiff(prev, EMPTY_DIFF);
    const b = applyDiff(a, EMPTY_DIFF);
    expect(b.version).toBe(prev.version + 2);
  });
});
