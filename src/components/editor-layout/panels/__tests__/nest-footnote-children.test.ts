// Phase 1 — footnote-child card nesting (citations only).
//
// Pins the contract that a footnote-nested citation (tagged
// `nestedInFootnoteId` on the DocStructureObserver `CitationEntry`):
//   1. gets `parentCardId` stamped = its footnote's omni-item key;
//   2. is reordered to immediately follow its parent footnote item; and
//   3. routes to the FOOTNOTE filter category (not citations) — the
//      "suppressed from the flat Citations list, shows exactly once" rule.
//
// These are PURE helpers (no card components, no storage barrel), so this
// loads without the storage mock the omni-builder tests need.

import { describe, it, expect } from "vitest";
import {
  buildNestedContainerChildMap,
  buildNestedContainerInfoMap,
  buildNestedFootnoteChildMap,
  buildNestedFootnoteInfoMap,
  nestContainerChildren,
  nestFootnoteChildren,
  partitionDockedCitations,
  type NestedContainer,
  type NestedContainerInfo,
  type NestedFootnoteInfo,
} from "../nest-footnote-children";
import type { OmniItem } from "@/panels/_shared/types";
import type { DocStructure } from "@/lib/tiptap/doc-structure/types";
import { EMPTY_STRUCTURE } from "@/lib/tiptap/doc-structure/types";
import { cardPopKey, getPanelByCardKind } from "@/panels/panel-registry";
import { parseAnyKey } from "@/floats/float-key";

/** Build a minimal OmniItem stub (content is irrelevant to the transform). */
function item(id: string, extra: Partial<OmniItem> = {}): OmniItem {
  return {
    id,
    pos: 1,
    anchorState: "anchored",
    content: null,
    ...extra,
  };
}

/** The omni keys the footnote / citation / example builders use. */
const fnKey = (id: string) => cardPopKey("footnote", id);
const citKey = (id: string) => cardPopKey("citation", id);
const exKey = (id: string) => cardPopKey("example", id);

describe("buildNestedFootnoteChildMap", () => {
  it("maps only citations carrying nestedInFootnoteId → host footnote id", () => {
    const structure: DocStructure = {
      ...EMPTY_STRUCTURE,
      citations: [
        { id: "c1", pos: 5, command: "\\cite{a}", displayText: "A" }, // top-level
        {
          id: "c2",
          pos: 10,
          command: "\\cite{b}",
          displayText: "B",
          nestedInFootnoteId: "fn1",
        },
      ],
    };
    const map = buildNestedFootnoteChildMap(structure);
    expect(map.size).toBe(1);
    expect(map.get("c2")).toBe("fn1");
    expect(map.has("c1")).toBe(false);
  });

  it("is empty when no citation is footnote-nested", () => {
    const structure: DocStructure = {
      ...EMPTY_STRUCTURE,
      citations: [{ id: "c1", pos: 5, command: "\\cite{a}", displayText: "A" }],
    };
    expect(buildNestedFootnoteChildMap(structure).size).toBe(0);
  });

  // Regression (adversarial-review finding 1): the footnote omni item is keyed
  // by the RAW `footnoteId` (`cardPopKey("footnote", fn.footnoteId)`), while
  // structure-index once set `nestedInFootnoteId = linkId || footnoteId`. When a
  // footnote carries a non-empty `linkId` that DIFFERS from `footnoteId`, the
  // child→parent lookup keyed `cardPopKey("footnote", nestedInFootnoteId)` missed
  // the footnote item and the nested cite silently degraded to a flat card. The
  // fix aligns `nestedInFootnoteId` to the raw `footnoteId`; this end-to-end test
  // pins that a structure snapshot whose nested-in id equals the footnote's RAW
  // id still nests — i.e. the map value resolves to the footnote item's key.
  it("nests a child whose footnote has a linkId differing from footnoteId", () => {
    // `fn.footnoteId` (the omni item / FootnoteEntry id) is "fnRaw"; the footnote
    // node's `linkId` would have been "fnLink" — a DIFFERENT value. structure-
    // index must tag the nested cite with the RAW footnoteId ("fnRaw"), not the
    // linkId, so the parent lookup below resolves.
    const RAW_FOOTNOTE_ID = "fnRaw";
    const structure: DocStructure = {
      ...EMPTY_STRUCTURE,
      citations: [
        {
          id: "cNested",
          pos: 10,
          command: "\\cite{b}",
          displayText: "B",
          // Post-fix structure-index value: the RAW footnoteId, NOT the linkId.
          nestedInFootnoteId: RAW_FOOTNOTE_ID,
        },
      ],
    };
    const map = buildNestedFootnoteChildMap(structure);
    expect(map.get("cNested")).toBe(RAW_FOOTNOTE_ID);

    // The footnote omni item is keyed by the raw footnoteId — so the nesting
    // transform must resolve the child's parent to that exact key and nest it.
    const items: OmniItem[] = [
      item(fnKey(RAW_FOOTNOTE_ID)),
      item(citKey("cNested")),
    ];
    const out = nestFootnoteChildren(items, map);
    const child = out.find((i) => i.id === citKey("cNested"))!;
    expect(child.parentCardId).toBe(fnKey(RAW_FOOTNOTE_ID));
    // Ordered immediately after its footnote (nested, not degraded to flat).
    const fnIdx = out.findIndex((i) => i.id === fnKey(RAW_FOOTNOTE_ID));
    expect(out.findIndex((i) => i.id === citKey("cNested"))).toBe(fnIdx + 1);
  });
});

describe("nestFootnoteChildren", () => {
  it("stamps parentCardId, orders the child after its footnote, and routes it to the footnote category", () => {
    // Source order mirrors document order: footnote, then (later) the nested cite.
    const items: OmniItem[] = [
      item(fnKey("fn1")),
      item(citKey("cTop")), // unrelated top-level cite
      item(citKey("cNested")), // the footnote-nested cite
    ];
    const map = new Map<string, string>([["cNested", "fn1"]]);

    const out = nestFootnoteChildren(items, map);

    // Child is stamped with its footnote's omni key.
    const child = out.find((i) => i.id === citKey("cNested"))!;
    expect(child.parentCardId).toBe(fnKey("fn1"));

    // Child is ordered IMMEDIATELY after its parent footnote item.
    const fnIdx = out.findIndex((i) => i.id === fnKey("fn1"));
    const childIdx = out.findIndex((i) => i.id === citKey("cNested"));
    expect(childIdx).toBe(fnIdx + 1);

    // The unrelated top-level cite is untouched (no parentCardId).
    const top = out.find((i) => i.id === citKey("cTop"))!;
    expect(top.parentCardId).toBeUndefined();

    // The child appears EXACTLY once.
    expect(out.filter((i) => i.id === citKey("cNested")).length).toBe(1);
    expect(out.length).toBe(items.length);

    // Suppression-from-flat-list mechanism: the child's filter category resolves
    // to FOOTNOTES (via its parentCardId), so the Citations filter row never
    // shows it — it shows once, under its footnote.
    const parsed = parseAnyKey(child.parentCardId!)!;
    expect(getPanelByCardKind(parsed.kind as never)?.kind).toBe("footnotes");
    // Sanity: its own key would otherwise have routed it to citations.
    expect(getPanelByCardKind(parseAnyKey(child.id)!.kind as never)?.kind).toBe(
      "citations",
    );
  });

  it("keeps two nested cites under one footnote in order, both stamped", () => {
    const items: OmniItem[] = [
      item(fnKey("fn1")),
      item(citKey("cA")),
      item(citKey("cB")),
    ];
    // Insertion order = document order: cA before cB.
    const map = new Map<string, string>([
      ["cA", "fn1"],
      ["cB", "fn1"],
    ]);

    const out = nestFootnoteChildren(items, map);
    const ids = out.map((i) => i.id);
    expect(ids).toEqual([fnKey("fn1"), citKey("cA"), citKey("cB")]);
    expect(out[1].parentCardId).toBe(fnKey("fn1"));
    expect(out[2].parentCardId).toBe(fnKey("fn1"));
  });

  it("falls back to a flat card (no parentCardId) when the host footnote item is absent", () => {
    // Footnote was deleted / not built — only the nested cite remains.
    const items: OmniItem[] = [item(citKey("cNested"))];
    const map = new Map<string, string>([["cNested", "fnGone"]]);

    const out = nestFootnoteChildren(items, map);
    expect(out).toBe(items); // identity-stable: nothing nested
    expect(out[0].parentCardId).toBeUndefined();
  });

  it("returns the same array reference when nothing nests", () => {
    const items: OmniItem[] = [item(fnKey("fn1")), item(citKey("cTop"))];
    expect(nestFootnoteChildren(items, new Map())).toBe(items);
  });
});

// ---------------------------------------------------------------------------
// Part B — DOCKED surface. The kind-segregated docked Citations panel pulls a
// footnote-nested cite out of the flat list and renders it as an indented child
// tagged with its host footnote ("in footnote N"). Same snapshot datum, same
// 16px indent token; pure helpers below.
// ---------------------------------------------------------------------------

describe("buildNestedFootnoteInfoMap", () => {
  it("maps a footnote-nested cite → host footnote id + live number", () => {
    const structure: DocStructure = {
      ...EMPTY_STRUCTURE,
      footnotes: [
        { id: "fn1", pos: 8, thanks: false, number: 3 },
        { id: "fn2", pos: 20, thanks: false, number: 4 },
      ],
      citations: [
        { id: "cTop", pos: 5, command: "\\cite{a}", displayText: "A" },
        {
          id: "cNested",
          pos: 8,
          command: "\\cite{b}",
          displayText: "B",
          nestedInFootnoteId: "fn1",
        },
      ],
    };
    const map = buildNestedFootnoteInfoMap(structure);
    expect(map.size).toBe(1);
    expect(map.get("cNested")).toEqual({ footnoteId: "fn1", footnoteNumber: 3 });
    expect(map.has("cTop")).toBe(false);
  });

  it("falls back to a null number when the host footnote is not in the snapshot", () => {
    const structure: DocStructure = {
      ...EMPTY_STRUCTURE,
      // No footnotes array entry for fnGone (e.g. mid-edit / pre-renumber).
      citations: [
        {
          id: "cNested",
          pos: 8,
          command: "\\cite{b}",
          displayText: "B",
          nestedInFootnoteId: "fnGone",
        },
      ],
    };
    const map = buildNestedFootnoteInfoMap(structure);
    expect(map.get("cNested")).toEqual({
      footnoteId: "fnGone",
      footnoteNumber: null,
    });
  });

  it("is empty when no citation is footnote-nested", () => {
    const structure: DocStructure = {
      ...EMPTY_STRUCTURE,
      footnotes: [{ id: "fn1", pos: 8, thanks: false, number: 1 }],
      citations: [{ id: "cTop", pos: 5, command: "\\cite{a}", displayText: "A" }],
    };
    expect(buildNestedFootnoteInfoMap(structure).size).toBe(0);
  });
});

describe("partitionDockedCitations", () => {
  const info = (footnoteId: string, footnoteNumber: number | null): NestedFootnoteInfo => ({
    footnoteId,
    footnoteNumber,
  });

  it("splits flat vs nested, preserving order within each group", () => {
    const citations = [
      { id: "a" },
      { id: "bNested" },
      { id: "c" },
      { id: "dNested" },
    ];
    const map = new Map<string, NestedFootnoteInfo>([
      ["bNested", info("fn1", 1)],
      ["dNested", info("fn2", 2)],
    ]);
    const { topLevel, nested } = partitionDockedCitations(citations, map);
    expect(topLevel.map((c) => c.id)).toEqual(["a", "c"]);
    expect(nested.map((n) => n.citation.id)).toEqual(["bNested", "dNested"]);
    expect(nested[0].info).toEqual(info("fn1", 1));
    expect(nested[1].info).toEqual(info("fn2", 2));
  });

  it("is identity-stable (same topLevel ref, empty nested) when the map is empty", () => {
    const citations = [{ id: "a" }, { id: "b" }];
    const { topLevel, nested } = partitionDockedCitations(citations, new Map());
    expect(topLevel).toBe(citations);
    expect(nested).toEqual([]);
  });

  it("is identity-stable when the map has entries but none match the citations", () => {
    const citations = [{ id: "a" }, { id: "b" }];
    // Map references a cite that isn't in this panel's list (host footnote
    // gone / cite deleted) → no actual nesting, so passthrough.
    const map = new Map<string, NestedFootnoteInfo>([["zzz", info("fn1", 1)]]);
    const { topLevel, nested } = partitionDockedCitations(citations, map);
    expect(topLevel).toBe(citations);
    expect(nested).toEqual([]);
  });

  it("two nested cites under one footnote stay grouped after the flat cites, in order", () => {
    const citations = [{ id: "flat" }, { id: "n1" }, { id: "n2" }];
    const map = new Map<string, NestedFootnoteInfo>([
      ["n1", info("fn1", 7)],
      ["n2", info("fn1", 7)],
    ]);
    const { topLevel, nested } = partitionDockedCitations(citations, map);
    expect(topLevel.map((c) => c.id)).toEqual(["flat"]);
    expect(nested.map((n) => n.citation.id)).toEqual(["n1", "n2"]);
    // Combined render order (what the panel feeds CardListPanel + the cycle):
    // every flat cite, then the nested group.
    const combined = [...topLevel, ...nested.map((n) => n.citation)];
    expect(combined.map((c) => c.id)).toEqual(["flat", "n1", "n2"]);
  });
});

// ---------------------------------------------------------------------------
// Phase 2a — GENERALIZED container nesting (footnote OR example). Same render
// treatment (parentCardId + indent + ordered-under-parent), one transform.
// ---------------------------------------------------------------------------

describe("buildNestedContainerChildMap", () => {
  it("maps citations carrying nestedInContainerId for BOTH kinds; leaves top-level cites out", () => {
    const structure: DocStructure = {
      ...EMPTY_STRUCTURE,
      citations: [
        { id: "cTop", pos: 1, command: "\\cite{t}", displayText: "T" }, // top-level
        {
          id: "cFn",
          pos: 5,
          command: "\\cite{f}",
          displayText: "F",
          nestedInFootnoteId: "fn1",
          nestedInContainerId: { kind: "footnote", id: "fn1" },
        },
        {
          id: "cEx",
          pos: 9,
          command: "\\cite{e}",
          displayText: "E",
          nestedInContainerId: { kind: "example", id: "ex1" },
        },
      ],
    };
    const map = buildNestedContainerChildMap(structure);
    expect(map.size).toBe(2);
    expect(map.get("cFn")).toEqual({ kind: "footnote", id: "fn1" });
    expect(map.get("cEx")).toEqual({ kind: "example", id: "ex1" });
    expect(map.has("cTop")).toBe(false);
  });
});

describe("nestContainerChildren — example", () => {
  it("nests an example-nested cite under the example's omni card (parentCardId + order)", () => {
    const items: OmniItem[] = [
      item(exKey("ex1")),
      item(citKey("cTop")), // unrelated top-level cite
      item(citKey("cInEx")), // the example-nested cite
    ];
    const map = new Map<string, NestedContainer>([
      ["cInEx", { kind: "example", id: "ex1" }],
    ]);

    const out = nestContainerChildren(items, map);

    const child = out.find((i) => i.id === citKey("cInEx"))!;
    expect(child.parentCardId).toBe(exKey("ex1"));
    // Ordered IMMEDIATELY after its example item.
    const exIdx = out.findIndex((i) => i.id === exKey("ex1"));
    expect(out.findIndex((i) => i.id === citKey("cInEx"))).toBe(exIdx + 1);
    // Unrelated top-level cite untouched.
    expect(out.find((i) => i.id === citKey("cTop"))!.parentCardId).toBeUndefined();
    // The child's parent key routes to the EXAMPLES panel (suppressed from the
    // flat Citations list — surfaces once, under its example).
    const parsed = parseAnyKey(child.parentCardId!)!;
    expect(getPanelByCardKind(parsed.kind as never)?.kind).toBe("examples");
  });

  it("keeps two cites under one example in document order, both stamped", () => {
    const items: OmniItem[] = [
      item(exKey("ex1")),
      item(citKey("cA")),
      item(citKey("cB")),
    ];
    const map = new Map<string, NestedContainer>([
      ["cA", { kind: "example", id: "ex1" }],
      ["cB", { kind: "example", id: "ex1" }],
    ]);

    const out = nestContainerChildren(items, map);
    expect(out.map((i) => i.id)).toEqual([
      exKey("ex1"),
      citKey("cA"),
      citKey("cB"),
    ]);
    expect(out[1].parentCardId).toBe(exKey("ex1"));
    expect(out[2].parentCardId).toBe(exKey("ex1"));
  });

  it("degrades to a flat card (no parentCardId) when the example item is absent", () => {
    // Example deleted / owner resolves null — only the cite remains.
    const items: OmniItem[] = [item(citKey("cInEx"))];
    const map = new Map<string, NestedContainer>([
      ["cInEx", { kind: "example", id: "exGone" }],
    ]);
    const out = nestContainerChildren(items, map);
    expect(out).toBe(items); // identity-stable: nothing nested
    expect(out[0].parentCardId).toBeUndefined();
  });

  it("nests footnote AND example children side by side under their own parents", () => {
    const items: OmniItem[] = [
      item(fnKey("fn1")),
      item(exKey("ex1")),
      item(citKey("cFn")),
      item(citKey("cEx")),
    ];
    const map = new Map<string, NestedContainer>([
      ["cFn", { kind: "footnote", id: "fn1" }],
      ["cEx", { kind: "example", id: "ex1" }],
    ]);

    const out = nestContainerChildren(items, map);
    // Each child follows ITS parent (footnote run, then example run).
    expect(out.map((i) => i.id)).toEqual([
      fnKey("fn1"),
      citKey("cFn"),
      exKey("ex1"),
      citKey("cEx"),
    ]);
    expect(out[1].parentCardId).toBe(fnKey("fn1"));
    expect(out[3].parentCardId).toBe(exKey("ex1"));
  });

  it("returns the same array reference when nothing nests", () => {
    const items: OmniItem[] = [item(exKey("ex1")), item(citKey("cTop"))];
    expect(nestContainerChildren(items, new Map())).toBe(items);
  });
});

describe("nestFootnoteChildren delegates to the generalized engine (no Phase 1 regression)", () => {
  it("still stamps + orders a footnote-nested cite exactly as before", () => {
    const items: OmniItem[] = [item(fnKey("fn1")), item(citKey("cNested"))];
    const map = new Map<string, string>([["cNested", "fn1"]]);
    const out = nestFootnoteChildren(items, map);
    const child = out.find((i) => i.id === citKey("cNested"))!;
    expect(child.parentCardId).toBe(fnKey("fn1"));
    expect(out.findIndex((i) => i.id === citKey("cNested"))).toBe(
      out.findIndex((i) => i.id === fnKey("fn1")) + 1,
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 2a — DOCKED surface generalization. The docked Citations panel now
// pulls BOTH footnote-nested AND example-nested cites out of the flat list,
// resolving each container's live display number ("in footnote N" /
// "in example N"). Footnote behavior stays byte-identical (back-compat).
// ---------------------------------------------------------------------------

describe("buildNestedContainerInfoMap", () => {
  it("maps a footnote-nested cite (number from footnotes) AND an example-nested cite (number from examples); leaves top-level out", () => {
    const structure: DocStructure = {
      ...EMPTY_STRUCTURE,
      footnotes: [{ id: "fn1", pos: 8, thanks: false, number: 3 }],
      examples: [
        {
          id: "ex1",
          uuid: "ex1",
          pos: 12,
          tag: "myex",
          label: "",
          number: 7,
        },
      ],
      citations: [
        { id: "cTop", pos: 5, command: "\\cite{a}", displayText: "A" }, // top-level
        {
          id: "cFn",
          pos: 8,
          command: "\\cite{b}",
          displayText: "B",
          nestedInFootnoteId: "fn1",
          nestedInContainerId: { kind: "footnote", id: "fn1" },
        },
        {
          id: "cEx",
          pos: 12,
          command: "\\cite{c}",
          displayText: "C",
          nestedInContainerId: { kind: "example", id: "ex1" },
        },
      ],
    };
    const map = buildNestedContainerInfoMap(structure);
    expect(map.size).toBe(2);
    expect(map.get("cFn")).toEqual({ kind: "footnote", id: "fn1", number: 3 });
    expect(map.get("cEx")).toEqual({ kind: "example", id: "ex1", number: 7 });
    expect(map.has("cTop")).toBe(false);
  });

  it("resolves a string-valued example number (e.g. '(3a)')", () => {
    const structure: DocStructure = {
      ...EMPTY_STRUCTURE,
      examples: [
        { id: "ex1", uuid: "ex1", pos: 12, tag: "", label: "", number: "(3a)" },
      ],
      citations: [
        {
          id: "cEx",
          pos: 12,
          command: "\\cite{c}",
          displayText: "C",
          nestedInContainerId: { kind: "example", id: "ex1" },
        },
      ],
    };
    expect(buildNestedContainerInfoMap(structure).get("cEx")).toEqual({
      kind: "example",
      id: "ex1",
      number: "(3a)",
    });
  });

  it("falls back to a null number when the host container is absent (degrade)", () => {
    const structure: DocStructure = {
      ...EMPTY_STRUCTURE,
      // No examples entry for exGone (e.g. mid-edit / deleted).
      citations: [
        {
          id: "cEx",
          pos: 12,
          command: "\\cite{c}",
          displayText: "C",
          nestedInContainerId: { kind: "example", id: "exGone" },
        },
      ],
    };
    expect(buildNestedContainerInfoMap(structure).get("cEx")).toEqual({
      kind: "example",
      id: "exGone",
      number: null,
    });
  });

  it("is empty when no citation carries nestedInContainerId", () => {
    const structure: DocStructure = {
      ...EMPTY_STRUCTURE,
      citations: [{ id: "cTop", pos: 5, command: "\\cite{a}", displayText: "A" }],
    };
    expect(buildNestedContainerInfoMap(structure).size).toBe(0);
  });
});

describe("buildNestedFootnoteInfoMap — back-compat over the generalized map", () => {
  it("still maps a footnote-nested cite → { footnoteId, footnoteNumber } and ignores example-nested cites", () => {
    const structure: DocStructure = {
      ...EMPTY_STRUCTURE,
      footnotes: [{ id: "fn1", pos: 8, thanks: false, number: 3 }],
      examples: [
        { id: "ex1", uuid: "ex1", pos: 12, tag: "", label: "", number: 7 },
      ],
      citations: [
        {
          id: "cFn",
          pos: 8,
          command: "\\cite{b}",
          displayText: "B",
          nestedInFootnoteId: "fn1",
          nestedInContainerId: { kind: "footnote", id: "fn1" },
        },
        {
          id: "cEx",
          pos: 12,
          command: "\\cite{c}",
          displayText: "C",
          nestedInContainerId: { kind: "example", id: "ex1" },
        },
      ],
    };
    const map = buildNestedFootnoteInfoMap(structure);
    // Footnote shape unchanged; the example-nested cite is NOT in the
    // footnote-only map.
    expect(map.size).toBe(1);
    expect(map.get("cFn")).toEqual({ footnoteId: "fn1", footnoteNumber: 3 });
    expect(map.has("cEx")).toBe(false);
  });
});

describe("partitionDockedCitations — example-nested", () => {
  const exInfo = (id: string, number: string | number | null): NestedContainerInfo => ({
    kind: "example",
    id,
    number,
  });
  const fnInfo = (id: string, number: string | number | null): NestedContainerInfo => ({
    kind: "footnote",
    id,
    number,
  });

  it("pulls an example-nested cite into the nested group (not topLevel) with its example info", () => {
    const citations = [{ id: "flat" }, { id: "cInEx" }];
    const map = new Map<string, NestedContainerInfo>([
      ["cInEx", exInfo("ex1", 7)],
    ]);
    const { topLevel, nested } = partitionDockedCitations(citations, map);
    expect(topLevel.map((c) => c.id)).toEqual(["flat"]);
    expect(nested.map((n) => n.citation.id)).toEqual(["cInEx"]);
    expect(nested[0].info).toEqual(exInfo("ex1", 7));
  });

  it("nests footnote- AND example-nested cites side by side, each with its own info", () => {
    const citations = [{ id: "flat" }, { id: "cFn" }, { id: "cEx" }];
    const map = new Map<string, NestedContainerInfo>([
      ["cFn", fnInfo("fn1", 3)],
      ["cEx", exInfo("ex1", 7)],
    ]);
    const { topLevel, nested } = partitionDockedCitations(citations, map);
    expect(topLevel.map((c) => c.id)).toEqual(["flat"]);
    expect(nested.map((n) => n.citation.id)).toEqual(["cFn", "cEx"]);
    expect(nested.find((n) => n.citation.id === "cFn")!.info).toEqual(fnInfo("fn1", 3));
    expect(nested.find((n) => n.citation.id === "cEx")!.info).toEqual(exInfo("ex1", 7));
  });

  it("a cite whose example is absent from the snapshot stays flat (degrade)", () => {
    // The host example was deleted, so the host-info builder never produced an
    // entry for this cite — it isn't in the nesting map, so it stays top-level.
    const citations = [{ id: "flat" }, { id: "cInEx" }];
    const map = new Map<string, NestedContainerInfo>([
      // Map references a DIFFERENT cite (its example gone → not surfaced here).
      ["someOtherCite", exInfo("exGone", null)],
    ]);
    const { topLevel, nested } = partitionDockedCitations(citations, map);
    expect(topLevel).toBe(citations); // identity-stable passthrough
    expect(nested).toEqual([]);
  });
});
