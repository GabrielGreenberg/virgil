import { describe, expect, it } from "vitest";
import {
  EXPEX_INNER_KINDS,
  blockIntoExpexDropAdapter,
  exampleItemDropAdapter,
  isCompatibleParent,
  listItemDropAdapter,
  topLevelDropAdapter,
} from "../drop-adapters";
import { TEXT_OBJECT_REGISTRY } from "../text-object-registry";
import type { TextObjectKind } from "../types";

describe("listItemDropAdapter", () => {
  it("drops directly inside a compatible parent (bullet → bullet)", () => {
    const result = listItemDropAdapter(
      {
        kind: "listItem",
        id: "x1",
        sourceContext: { parentKind: "bulletList" },
      },
      { kind: "inside-compatible-parent", parentKind: "bulletList" },
    );
    expect(result).toEqual({ kind: "drop-direct" });
  });

  it("drops directly across compatible list parents (bullet → ordered)", () => {
    // Cross-list drop: bullet listItem into an orderedList. Both are
    // "compatible parents" — ProseMirror's content rules re-parent the
    // item to match the target list's kind.
    const result = listItemDropAdapter(
      {
        kind: "listItem",
        id: "x1",
        sourceContext: { parentKind: "bulletList" },
      },
      { kind: "inside-compatible-parent", parentKind: "orderedList" },
    );
    expect(result).toEqual({ kind: "drop-direct" });
  });

  it("wraps into a fresh list of the source's parent kind at top level", () => {
    const result = listItemDropAdapter(
      {
        kind: "listItem",
        id: "x1",
        sourceContext: { parentKind: "orderedList" },
      },
      { kind: "top-level" },
    );
    expect(result).toEqual({ kind: "wrap", parentKind: "orderedList" });
  });

  it("wraps into a bulletList by default when sourceContext lacks parentKind", () => {
    const result = listItemDropAdapter(
      { kind: "listItem", id: "x1", sourceContext: {} },
      { kind: "top-level" },
    );
    expect(result).toEqual({ kind: "wrap", parentKind: "bulletList" });
  });

  it("still wraps when canPlaceHere accepts the fresh list (real top-level gap)", () => {
    // Task 065 — the gate is a strict addition: where the fresh list fits
    // (doc/blockquote/listItem parents accept a bulletList), the wrap is
    // unchanged from pre-065.
    const result = listItemDropAdapter(
      { kind: "listItem", id: "x1", sourceContext: { parentKind: "bulletList" } },
      { kind: "top-level", canPlaceHere: (k) => k === "bulletList" },
    );
    expect(result).toEqual({ kind: "wrap", parentKind: "bulletList" });
  });

  it("NO-OPS a cross-kind drop into a foreign container's item gap (task 065)", () => {
    // A listItem dropped in the between-items gap of a multi-item exampleBlock:
    // classifyParentAt collapses to "exampleBlock", but the TRUE immediate parent
    // is `exampleItemList` (content `exampleItem+`), which rejects a bulletList.
    // The wrap would split the container + duplicate a uuid, so reject instead.
    const result = listItemDropAdapter(
      { kind: "listItem", id: "x1", sourceContext: { parentKind: "bulletList" } },
      {
        kind: "inside-incompatible-parent",
        parentKind: "exampleBlock",
        canPlaceHere: () => false, // neither bulletList nor orderedList fits here
      },
    );
    expect(result).toEqual({ kind: "no-op" });
  });
});

describe("exampleItemDropAdapter", () => {
  it("drops directly inside an exampleBlock", () => {
    const result = exampleItemDropAdapter(
      {
        kind: "exampleItem",
        id: "x1",
        sourceContext: { parentKind: "exampleBlock" },
      },
      { kind: "inside-compatible-parent", parentKind: "exampleBlock" },
    );
    expect(result).toEqual({ kind: "drop-direct" });
  });

  it("always wraps into a fresh exampleBlock at top level", () => {
    const result = exampleItemDropAdapter(
      {
        kind: "exampleItem",
        id: "x1",
        sourceContext: { parentKind: "exampleBlock" },
      },
      { kind: "top-level" },
    );
    expect(result).toEqual({ kind: "wrap", parentKind: "exampleBlock" });
  });

  it("still wraps when canPlaceHere accepts the fresh exampleBlock (real top-level gap)", () => {
    const result = exampleItemDropAdapter(
      { kind: "exampleItem", id: "x1", sourceContext: { parentKind: "exampleBlock" } },
      { kind: "top-level", canPlaceHere: (k) => k === "exampleBlock" },
    );
    expect(result).toEqual({ kind: "wrap", parentKind: "exampleBlock" });
  });

  it("NO-OPS a cross-kind drop into a foreign container's item gap (task 065)", () => {
    // The symmetric corruption: an exampleItem dropped in the between-items gap
    // of a multi-item bulletList. Immediate parent `bulletList` (content
    // `listItem+`) rejects a fresh exampleBlock; wrapping would split the list.
    const result = exampleItemDropAdapter(
      { kind: "exampleItem", id: "x1", sourceContext: { parentKind: "exampleBlock" } },
      {
        kind: "inside-incompatible-parent",
        parentKind: "bulletList",
        canPlaceHere: () => false, // exampleBlock does not fit inside a bulletList
      },
    );
    expect(result).toEqual({ kind: "no-op" });
  });
});

describe("blockIntoExpexDropAdapter", () => {
  // Feature A1/A2 — the adapter is kind-agnostic AND now schema-driven: it keys
  // ONLY on `target.canDropDirect` (the immediate insert parent's
  // canReplaceWith, computed by the spec), not the collapsed parentKind. The
  // same decisions hold for all three block kinds (text/picture/equation).
  const KINDS: TextObjectKind[] = ["graphicsBlock", "paragraph", "displayMath"];
  for (const kind of KINDS) {
    describe(`${kind}`, () => {
      it("wraps in a fresh exampleItem when the parent REJECTS a bare block but ACCEPTS an exampleItem (canDropDirect false + canPlaceHere('exampleItem')) — case a", () => {
        // The multi between-items gap: immediate parent exampleItemList (content
        // `exampleItem+`) rejects a bare block (canDropDirect=false) but ACCEPTS an
        // exampleItem (canPlaceHere('exampleItem')=true) → wrap. REGRESSION TRAP —
        // this case and the single-body case below BOTH classify as parentKind
        // "exampleBlock"; canDropDirect separates those two, and the shared
        // canPlaceHere gate (task 065; formerly the bespoke canWrapHere) keeps the
        // wrap from firing at a non-expex rejected position where an exampleItem is
        // ALSO invalid (that drops-direct — covered by the real-schema lock).
        const result = blockIntoExpexDropAdapter(
          { kind, id: "s1", sourceContext: {} },
          {
            kind: "inside-incompatible-parent",
            parentKind: "exampleBlock",
            canDropDirect: false,
            canPlaceHere: (k) => k === "exampleItem",
          },
        );
        expect(result).toEqual({ kind: "wrap", parentKind: "exampleItem" });
      });

      it("drops directly into a single example's BODY (canDropDirect true, same parentKind exampleBlock) — A2", () => {
        // Feature A2 — a single example's widened body classifies as
        // parentKind "exampleBlock" too, but the parent ACCEPTS the bare block
        // → drop-direct (NOT wrapped into a new item). The naive A1 fix
        // (parentKind==="exampleBlock" → wrap) would wrongly wrap this.
        const result = blockIntoExpexDropAdapter(
          { kind, id: "s1", sourceContext: {} },
          {
            kind: "inside-incompatible-parent",
            parentKind: "exampleBlock",
            canDropDirect: true,
          },
        );
        expect(result).toEqual({ kind: "drop-direct" });
      });

      it("drops directly inside a compatible exampleItem (canDropDirect true) — case b", () => {
        const result = blockIntoExpexDropAdapter(
          { kind, id: "s1", sourceContext: {} },
          {
            kind: "inside-compatible-parent",
            parentKind: "exampleItem",
            canDropDirect: true,
          },
        );
        expect(result).toEqual({ kind: "drop-direct" });
      });

      it("drops directly at top level (canDropDirect true — its normal placement, unchanged)", () => {
        const result = blockIntoExpexDropAdapter(
          { kind, id: "s1", sourceContext: {} },
          { kind: "top-level", canDropDirect: true },
        );
        expect(result).toEqual({ kind: "drop-direct" });
      });

      it("drops directly when NO schema signal is supplied (safe default — never a spurious wrap)", () => {
        // A direct caller that omits canDropDirect → drop-direct. In production
        // applyDrop always supplies it; only `=== false` (a known rejection)
        // triggers the wrap.
        const result = blockIntoExpexDropAdapter(
          { kind, id: "s1", sourceContext: {} },
          { kind: "inside-incompatible-parent", parentKind: "blockquote" },
        );
        expect(result).toEqual({ kind: "drop-direct" });
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Task 234 — rung 1 of the shared ladder, as a law over EVERY registered
// adapter rather than a fact about the two that were fixed.
//
// The bug was one adapter deciding wrap-vs-direct from `classifyParentAt`'s
// lossy verdict while the schema at the TRUE immediate parent said the bare
// node was welcome. That is not a property of `exampleItem`: it is available to
// any adapter that consults the proxy first, at any position where an
// UNREGISTERED container sits between the insert point and the nearest
// registered ancestor. So the obligation is DERIVED from the registry — a
// future adapter (or a future kind pointed at an existing one) inherits it, and
// re-introducing a proxy-first branch fails here without anyone remembering to
// extend a list.
//
// The target below is deliberately adversarial in both directions: it reports
// the proxy verdict that tempted the wrap (`inside-incompatible-parent`) AND a
// `canPlaceHere` that would sanction one. Neither may outrank the schema.
// ---------------------------------------------------------------------------
describe("canDropDirect-first is a law over every registered dropAdapter (task 234)", () => {
  const ADAPTERS = [
    ...new Set(
      (Object.keys(TEXT_OBJECT_REGISTRY) as TextObjectKind[]).map(
        (kind) => TEXT_OBJECT_REGISTRY[kind].dropAdapter,
      ),
    ),
  ];
  // A canary: if the registry stops exposing adapters (or this reads the wrong
  // facet), the loop below would pass vacuously.
  it("censuses every distinct adapter on the registry", () => {
    expect(ADAPTERS.length).toBeGreaterThanOrEqual(4);
    expect(ADAPTERS).toContain(listItemDropAdapter);
    expect(ADAPTERS).toContain(exampleItemDropAdapter);
    expect(ADAPTERS).toContain(blockIntoExpexDropAdapter);
    expect(ADAPTERS).toContain(topLevelDropAdapter);
  });

  for (const [i, adapter] of ADAPTERS.entries()) {
    it(`adapter #${i} (${adapter.name || "anonymous"}) drops DIRECT when the true immediate parent accepts the bare node`, () => {
      const result = adapter(
        {
          kind: "listItem",
          id: "s1",
          sourceContext: { parentKind: "bulletList" },
        },
        {
          kind: "inside-incompatible-parent",
          parentKind: "exampleItem",
          canDropDirect: true,
          canPlaceHere: () => true,
        },
      );
      expect(result).toEqual({ kind: "drop-direct" });
    });
  }

  it("THE ORIGINAL SHAPE: the nested-xlist signature is drop-direct, not the pre-234 no-op", () => {
    // An `exampleItem` released between two NESTED items. `classifyParentAt`
    // skips the unregistered `exampleItemList` and lands on the enclosing
    // `exampleItem` → "incompatible"; the fresh `exampleBlock` the wrap branch
    // would fabricate is invalid inside an `exampleItemList` → canPlaceHere
    // false; and the TRUE immediate parent (content `exampleItem+`) accepts the
    // bare item. Pre-234 that combination fell to the task-065 no-op and the
    // drop silently did nothing.
    const result = exampleItemDropAdapter(
      {
        kind: "exampleItem",
        id: "x1",
        sourceContext: { parentKind: "exampleBlock" },
      },
      {
        kind: "inside-incompatible-parent",
        parentKind: "exampleItem",
        canDropDirect: true,
        canPlaceHere: () => false,
      },
    );
    expect(result).toEqual({ kind: "drop-direct" });
  });

  it("and the 065 gate is untouched where the schema REFUSES the bare node", () => {
    // Same proxy verdict, opposite schema answer → still the no-op that keeps a
    // here-invalid wrap from splitting the container.
    const result = exampleItemDropAdapter(
      {
        kind: "exampleItem",
        id: "x1",
        sourceContext: { parentKind: "exampleBlock" },
      },
      {
        kind: "inside-incompatible-parent",
        parentKind: "bulletList",
        canDropDirect: false,
        canPlaceHere: () => false,
      },
    );
    expect(result).toEqual({ kind: "no-op" });
  });
});

describe("topLevelDropAdapter", () => {
  it("always drops directly", () => {
    const result = topLevelDropAdapter(
      { kind: "paragraph", id: "p1", sourceContext: {} },
      { kind: "top-level" },
    );
    expect(result).toEqual({ kind: "drop-direct" });
  });
});

describe("isCompatibleParent", () => {
  const cases: Array<[TextObjectKind, TextObjectKind, boolean]> = [
    ["listItem", "bulletList", true],
    ["listItem", "orderedList", true],
    ["listItem", "exampleBlock", false],
    ["exampleItem", "exampleBlock", true],
    ["exampleItem", "bulletList", false],
    ["paragraph", "bulletList", false],
    // Feature A0/A1 — text/picture/equation are each compatible with an
    // exampleItem, but NOT with the exampleBlock directly (that case wraps).
    ["graphicsBlock", "exampleItem", true],
    ["graphicsBlock", "exampleBlock", false],
    ["graphicsBlock", "bulletList", false],
    ["paragraph", "exampleItem", true],
    ["paragraph", "exampleBlock", false],
    ["displayMath", "exampleItem", true],
    ["displayMath", "exampleBlock", false],
    ["displayMath", "bulletList", false],
  ];
  for (const [child, parent, expected] of cases) {
    it(`${child} in ${parent} → ${expected}`, () => {
      expect(isCompatibleParent(child, parent)).toBe(expected);
    });
  }
});

// ---------------------------------------------------------------------------
// SSOT parity (task 254) — `EXPEX_INNER_KINDS` is the ONE source of truth for
// the block kinds droppable INTO an expex example. It was formerly triplicated:
// this set, `hit-test.ts`'s `EXPEX_DROP_KINDS` literal, and the `isCompatibleParent`
// if-chain each restated `{paragraph, graphicsBlock, displayMath}` by hand. The
// registry facet `dropAdapter === blockIntoExpexDropAdapter` is the natural SSOT
// for the SAME schema fact (an `exampleItem`'s content, expex.ts). The registry
// imports drop-adapters (a cycle), so the set can't be derived from the registry
// at runtime — this test pins the two so a future registry edit and the drop
// machinery can never disagree. Mirrors block-atom-facet-parity.test.ts (066).
// ---------------------------------------------------------------------------
describe("EXPEX_INNER_KINDS ↔ registry dropAdapter facet parity (task 254)", () => {
  const registryExpexKinds = (
    Object.keys(TEXT_OBJECT_REGISTRY) as TextObjectKind[]
  ).filter(
    (kind) => TEXT_OBJECT_REGISTRY[kind].dropAdapter === blockIntoExpexDropAdapter,
  );

  it("the set of kinds whose registry dropAdapter is blockIntoExpexDropAdapter equals EXPEX_INNER_KINDS", () => {
    expect([...registryExpexKinds].sort()).toEqual([...EXPEX_INNER_KINDS].sort());
  });

  it("pins the current membership so a widening is a deliberate, reviewed edit", () => {
    expect([...EXPEX_INNER_KINDS].sort()).toEqual([
      "displayMath",
      "graphicsBlock",
      "paragraph",
    ]);
  });

  it("isCompatibleParent(kind, 'exampleItem') is true for exactly the SSOT kinds", () => {
    for (const kind of EXPEX_INNER_KINDS) {
      expect(isCompatibleParent(kind, "exampleItem")).toBe(true);
    }
    // A non-member (e.g. codeBlock) stays incompatible → drop-direct.
    expect(isCompatibleParent("codeBlock", "exampleItem")).toBe(false);
  });
});
