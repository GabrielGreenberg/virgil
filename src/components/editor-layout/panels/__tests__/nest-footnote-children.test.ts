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
  buildNestedFootnoteChildMap,
  buildNestedFootnoteInfoMap,
  nestFootnoteChildren,
  partitionDockedCitations,
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

/** The omni keys the footnote / citation builders use. */
const fnKey = (id: string) => cardPopKey("footnote", id);
const citKey = (id: string) => cardPopKey("citation", id);

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
