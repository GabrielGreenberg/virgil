/**
 * Task 961 — "can this card jump?" has ONE answer, `isCardAnchored`, and the
 * comment/suggestion card family reads it instead of re-typing the
 * Mode-A-or-Mode-B disjunction inline (which is where the twins' dead
 * `!isOrphaned` conjunct grew).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isCardAnchored } from "../links";
import type { Link } from "../links";

const modeA = {
  anchor: { type: "textObject", textObjectIds: ["p1"] },
} as unknown as Link;
const modeB = {
  anchor: {
    type: "textObject",
    targetKind: "linkedRange",
    textObjectIds: [],
    textRange: { anchorId: "a1", textSnapshot: "x" },
  },
} as unknown as Link;

describe("isCardAnchored", () => {
  it("is false with no links", () => {
    expect(isCardAnchored({ id: "c" })).toBe(false);
    expect(isCardAnchored({ id: "c", links: [] })).toBe(false);
  });
  it("is true for a paragraph (Mode A) link", () => {
    expect(isCardAnchored({ id: "c", links: [modeA] })).toBe(true);
  });
  it("is true for a text-range (Mode B) link", () => {
    expect(isCardAnchored({ id: "c", links: [modeB] })).toBe(true);
  });
});

describe("the comment/suggestion family reads the one predicate", () => {
  const root = join(__dirname, "..", "..");
  for (const rel of [
    "panels/Revisions/RevisionRequestCard.tsx",
    "panels/Cutter/CutterCommentCard.tsx",
    "panels/_shared/SuggestionCard.tsx",
  ]) {
    it(rel, () => {
      const src = readFileSync(join(root, rel), "utf8");
      expect(src).toContain("isCardAnchored(card)");
      expect(src).not.toMatch(
        /getLinkedTextObjectIds\(card\)\.length > 0 \|\| hasTextAnchor\(card\)/,
      );
      expect(src).not.toMatch(/const isOrphaned\b/);
    });
  }
});
