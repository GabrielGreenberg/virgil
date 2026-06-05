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
  // Feature A1 — the adapter body is kind-agnostic: the same drop-direct /
  // wrap / drop-direct decisions hold for all three block kinds that can land
  // in an expex example (text/picture/equation). Parametrize to lock that.
  const KINDS: TextObjectKind[] = ["graphicsBlock", "paragraph", "displayMath"];
  for (const kind of KINDS) {
    describe(`${kind}`, () => {
      it("drops directly inside a compatible parent (an exampleItem) — case b", () => {
        const result = blockIntoExpexDropAdapter(
          { kind, id: "s1", sourceContext: {} },
          { kind: "inside-compatible-parent", parentKind: "exampleItem" },
        );
        expect(result).toEqual({ kind: "drop-direct" });
      });

      it("wraps into a fresh exampleItem when incompatible at the exampleBlock level — case a", () => {
        const result = blockIntoExpexDropAdapter(
          { kind, id: "s1", sourceContext: {} },
          { kind: "inside-incompatible-parent", parentKind: "exampleBlock" },
        );
        expect(result).toEqual({ kind: "wrap", parentKind: "exampleItem" });
      });

      it("drops directly at top level (its normal placement, unchanged)", () => {
        const result = blockIntoExpexDropAdapter(
          { kind, id: "s1", sourceContext: {} },
          { kind: "top-level" },
        );
        expect(result).toEqual({ kind: "drop-direct" });
      });

      it("drops directly inside any OTHER incompatible parent (not exampleBlock)", () => {
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
