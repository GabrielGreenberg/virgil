import { describe, expect, it } from "vitest";
import {
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
  ];
  for (const [child, parent, expected] of cases) {
    it(`${child} in ${parent} → ${expected}`, () => {
      expect(isCompatibleParent(child, parent)).toBe(expected);
    });
  }
});
