import { describe, expect, it } from "vitest";
import {
  blockIntoExpexDropAdapter,
  exampleItemDropAdapter,
  isCompatibleParent,
  listItemDropAdapter,
  topLevelDropAdapter,
} from "../drop-adapters";
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
});

describe("blockIntoExpexDropAdapter", () => {
  // Feature A1/A2 — the adapter is kind-agnostic AND now schema-driven: it keys
  // ONLY on `target.canDropDirect` (the immediate insert parent's
  // canReplaceWith, computed by the spec), not the collapsed parentKind. The
  // same decisions hold for all three block kinds (text/picture/equation).
  const KINDS: TextObjectKind[] = ["graphicsBlock", "paragraph", "displayMath"];
  for (const kind of KINDS) {
    describe(`${kind}`, () => {
      it("wraps in a fresh exampleItem when the parent REJECTS a bare block but ACCEPTS an exampleItem (canDropDirect false + canWrapHere) — case a", () => {
        // The multi between-items gap: immediate parent exampleItemList (content
        // `exampleItem+`) rejects a bare block (canDropDirect=false) but ACCEPTS an
        // exampleItem (canWrapHere=true) → wrap. REGRESSION TRAP — this case and the
        // single-body case below BOTH classify as parentKind "exampleBlock";
        // canDropDirect separates those two, and canWrapHere (A2 edge-fix) keeps the
        // wrap from firing at a non-expex rejected position where an exampleItem is
        // ALSO invalid (that drops-direct — covered by the real-schema lock).
        const result = blockIntoExpexDropAdapter(
          { kind, id: "s1", sourceContext: {} },
          {
            kind: "inside-incompatible-parent",
            parentKind: "exampleBlock",
            canDropDirect: false,
            canWrapHere: true,
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
