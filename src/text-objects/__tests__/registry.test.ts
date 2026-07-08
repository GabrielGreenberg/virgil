import { describe, expect, it } from "vitest";
import {
  TEXT_OBJECT_REGISTRY,
  isTextObjectKind,
  textObjectPopoutKey,
  parseTextObjectPopoutKey,
} from "../text-object-registry";
import type { TextObjectKind } from "../types";

describe("TEXT_OBJECT_REGISTRY", () => {
  it("declares an entry for every TextObjectKind", () => {
    const kinds: TextObjectKind[] = [
      "paragraph",
      "heading",
      "bulletList",
      "orderedList",
      "blockquote",
      "codeBlock",
      "displayMath",
      "titleField",
      "latexComment",
      "texBlock",
      "figureBlock",
      "graphicsBlock",
      "exampleBlock",
      "listItem",
      "exampleItem",
      "linkedRange",
    ];
    for (const kind of kinds) {
      expect(TEXT_OBJECT_REGISTRY[kind]).toBeDefined();
      expect(TEXT_OBJECT_REGISTRY[kind].label).toBeTruthy();
    }
  });

  // task 066: the former conflated `isAtomBlock` split into two facets. The
  // SELECTION facet (`selectsAsNode`) tracks true schema atomicity — pinned to
  // the live schema in block-atom-facet-parity.test.ts. The GATING facet
  // (`isMeaningfulBlockAtom`) tracks "nonsensical heading/block-convert target +
  // meaningful-when-empty for archive". They DIVERGE on exactly one kind:
  // latexComment (a content block since task-017, but still a meaningful comment).
  it("classifies the SELECTION facet (selectsAsNode = true schema atom) correctly", () => {
    // The three true ProseMirror atoms select as a whole node.
    expect(TEXT_OBJECT_REGISTRY.texBlock.selectsAsNode).toBe(true);
    expect(TEXT_OBJECT_REGISTRY.graphicsBlock.selectsAsNode).toBe(true);
    expect(TEXT_OBJECT_REGISTRY.displayMath.selectsAsNode).toBe(true);
    // latexComment is a CONTENT block (`content: "text*"`) → caret/text range,
    // NOT a NodeSelection. This is the divergence the split exists for.
    expect(TEXT_OBJECT_REGISTRY.latexComment.selectsAsNode).toBe(false);
    // figureBlock has a figureCaption child — NOT an atom.
    expect(TEXT_OBJECT_REGISTRY.figureBlock.selectsAsNode).toBe(false);
    // Prose kinds.
    expect(TEXT_OBJECT_REGISTRY.paragraph.selectsAsNode).toBe(false);
    expect(TEXT_OBJECT_REGISTRY.heading.selectsAsNode).toBe(false);
  });

  it("classifies the GATING facet (isMeaningfulBlockAtom) correctly", () => {
    // All four meaningful block atoms — a nonsensical heading/block-convert
    // target, and meaningful-when-empty for the archive bail. latexComment
    // KEEPS this facet even though its selection facet flipped.
    expect(TEXT_OBJECT_REGISTRY.texBlock.isMeaningfulBlockAtom).toBe(true);
    expect(TEXT_OBJECT_REGISTRY.graphicsBlock.isMeaningfulBlockAtom).toBe(true);
    expect(TEXT_OBJECT_REGISTRY.displayMath.isMeaningfulBlockAtom).toBe(true);
    expect(TEXT_OBJECT_REGISTRY.latexComment.isMeaningfulBlockAtom).toBe(true);
    // figureBlock is meaningful-for-confirm but must stay "ok" for the
    // block/heading gates → NOT flagged here (added separately to
    // MEANINGFUL_BLOCK_ATOM_NODE_NAMES).
    expect(TEXT_OBJECT_REGISTRY.figureBlock.isMeaningfulBlockAtom).toBe(false);
    // Prose kinds.
    expect(TEXT_OBJECT_REGISTRY.paragraph.isMeaningfulBlockAtom).toBe(false);
    expect(TEXT_OBJECT_REGISTRY.heading.isMeaningfulBlockAtom).toBe(false);
  });

  it("classifies sub-objects correctly", () => {
    expect(TEXT_OBJECT_REGISTRY.listItem.isSubObject).toBe(true);
    expect(TEXT_OBJECT_REGISTRY.listItem.parentKind).toBe("bulletList");
    expect(TEXT_OBJECT_REGISTRY.exampleItem.isSubObject).toBe(true);
    expect(TEXT_OBJECT_REGISTRY.exampleItem.parentKind).toBe("exampleBlock");
    // Top-level kinds have no parentKind.
    expect(TEXT_OBJECT_REGISTRY.paragraph.isSubObject).toBe(false);
    expect(TEXT_OBJECT_REGISTRY.paragraph.parentKind).toBeUndefined();
  });

  it("classifies the range kind", () => {
    expect(TEXT_OBJECT_REGISTRY.linkedRange.isRange).toBe(true);
    // No other kind is a range.
    for (const kind of Object.keys(TEXT_OBJECT_REGISTRY) as TextObjectKind[]) {
      if (kind === "linkedRange") continue;
      expect(TEXT_OBJECT_REGISTRY[kind].isRange).toBe(false);
    }
  });

  it("flags sub-objects with their parent kind (chip-2 retired decorationSafety)", () => {
    // Horizontal placement no longer carries a per-kind constant — the handle
    // hugs the block's MEASURED markerLeft from block-frame.ts. What remains is
    // the sub-object identity (used for the markerless-container step-out).
    expect(TEXT_OBJECT_REGISTRY.listItem.isSubObject).toBe(true);
    expect(TEXT_OBJECT_REGISTRY.listItem.parentKind).toBe("bulletList");
    expect(TEXT_OBJECT_REGISTRY.exampleItem.isSubObject).toBe(true);
    expect(TEXT_OBJECT_REGISTRY.exampleItem.parentKind).toBe("exampleBlock");
    expect(TEXT_OBJECT_REGISTRY.paragraph.isSubObject).toBe(false);
    expect(TEXT_OBJECT_REGISTRY.heading.isSubObject).toBe(false);
    // The retired field is gone from every entry.
    expect("decorationSafety" in TEXT_OBJECT_REGISTRY.listItem).toBe(false);
  });
});

describe("isTextObjectKind", () => {
  it("returns true for known kinds and false otherwise", () => {
    expect(isTextObjectKind("paragraph")).toBe(true);
    expect(isTextObjectKind("exampleItem")).toBe(true);
    expect(isTextObjectKind("linkedRange")).toBe(true);
    expect(isTextObjectKind("nope")).toBe(false);
    expect(isTextObjectKind("footnote")).toBe(false); // inline atom, not a TO
  });
});

describe("textObjectPopoutKey / parseTextObjectPopoutKey", () => {
  it("round-trips a ref through key construction + parse", () => {
    const refs = [
      { kind: "paragraph" as const, id: "abcd" },
      { kind: "exampleItem" as const, id: "1234" },
      { kind: "linkedRange" as const, id: "ef56" },
    ];
    for (const ref of refs) {
      const key = textObjectPopoutKey(ref);
      expect(key).toBe(`float:textobject:${ref.kind}:${ref.id}`);
      const parsed = parseTextObjectPopoutKey(key);
      expect(parsed).toEqual(ref);
    }
  });

  it("returns null for malformed keys", () => {
    expect(parseTextObjectPopoutKey("paragraph:abcd")).toBeNull();
    expect(parseTextObjectPopoutKey("textobject:nope:abcd")).toBeNull();
    expect(parseTextObjectPopoutKey("textobject:paragraph")).toBeNull();
    expect(parseTextObjectPopoutKey("textobject::abcd")).toBeNull();
    expect(parseTextObjectPopoutKey("")).toBeNull();
  });
});
