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
  nestFootnoteChildren,
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
