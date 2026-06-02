import { describe, expect, it } from "vitest";
import { textRangeMoveDropSpec } from "../specs/text-range-move";
import type { DropCtx, Placement } from "../types";

// L3f-2: a plain selection lifts as `linkedRange` and moves as a text SLICE
// at an inline caret. These pin the scope guard (inline-cursor ONLY — block
// gaps stay inert; the between-paragraphs drop is L3f-3) and the safe no-op
// paths. The actual slice move is exercised live (it needs a real editor +
// the marked range, which can't be driven headlessly).

const rect = { x: 0, y: 0, width: 0, height: 0 };
const nullEditor = null as unknown as Placement["editor"];

describe("text-range-move drop spec (L3f-2)", () => {
  it("allows ONLY the inline-cursor placement (within-text scope)", () => {
    expect(textRangeMoveDropSpec.allowedPlacements).toEqual(["inline-cursor"]);
  });

  it("targets any editor and closes the float after a drop", () => {
    expect(textRangeMoveDropSpec.targetScope).toBe("any-editor");
    expect(textRangeMoveDropSpec.postDrop).toBe("close");
  });

  it("no-ops a non-inline placement (a block gap never moves the range)", () => {
    const placement: Placement = {
      kind: "between-blocks",
      editor: nullEditor,
      insertPos: 0,
      rect,
    };
    const ctx = { mainEditor: null } as unknown as DropCtx;
    expect(textRangeMoveDropSpec.classifyDrop(placement, "textobject:linkedRange:abcd", ctx)).toEqual({
      kind: "no-op",
    });
  });

  it("no-ops when there is no main editor to resolve the range from", () => {
    const placement: Placement = {
      kind: "inline-cursor",
      editor: nullEditor,
      pos: 5,
      rect,
    };
    const ctx = { mainEditor: null } as unknown as DropCtx;
    expect(textRangeMoveDropSpec.classifyDrop(placement, "textobject:linkedRange:abcd", ctx)).toEqual({
      kind: "no-op",
    });
  });

  it("no-ops a cardKey that isn't a linkedRange", () => {
    const placement: Placement = {
      kind: "inline-cursor",
      editor: nullEditor,
      pos: 5,
      rect,
    };
    const ctx = { mainEditor: null } as unknown as DropCtx;
    expect(textRangeMoveDropSpec.classifyDrop(placement, "textobject:paragraph:abcd", ctx)).toEqual({
      kind: "no-op",
    });
  });
});
