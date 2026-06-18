/**
 * A6/WS7 pin test — the note→highlight morph gate.
 *
 * `canMorphNoteToHighlight` (consumer-owned predicate beside the note morph
 * registration) offers the kind-chevron ONLY for notes carrying a Mode-B
 * text-range anchor; a paragraph-only Mode-A note (or an orphaned one) has
 * no range for a highlight to tint, so it's gated off. The registry morph
 * declaration itself stays static.
 */
import { describe, it, expect } from "vitest";
import { canMorphNoteToHighlight } from "@/cards/morphs";
import { CARD_REGISTRY } from "@/cards/card-registry";
import type { UserNote } from "@/lib/types";
import type { Link } from "@/links/_shared/types";

function noteWith(links: Link[]): UserNote {
  return {
    kind: "note",
    id: "n1",
    title: "",
    content: { type: "doc", content: [] },
    createdAt: "2026-01-01T00:00:00.000Z",
    aiRequest: false,
    links,
  };
}

function modeALink(): Link {
  return {
    id: "l1",
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "paragraph",
      textObjectIds: ["p1"],
      margin: { side: "right" },
      // No textRange — Mode A paragraph anchor only.
    },
    target: { type: "card", ref: { kind: "note", id: "n1" } },
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function modeBLink(): Link {
  return {
    id: "l2",
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "linkedRange",
      textObjectIds: ["p1"],
      margin: { side: "right" },
      textRange: { anchorId: "a1", textSnapshot: "some linked text" },
    },
    target: { type: "card", ref: { kind: "note", id: "n1" } },
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("canMorphNoteToHighlight (A6/WS7)", () => {
  it("gates OFF a paragraph-only Mode-A note", () => {
    expect(canMorphNoteToHighlight(noteWith([modeALink()]))).toBe(false);
  });

  it("gates OFF an orphaned note (no links at all)", () => {
    expect(canMorphNoteToHighlight(noteWith([]))).toBe(false);
  });

  it("offers the morph for a Mode-B (text-range) note", () => {
    expect(canMorphNoteToHighlight(noteWith([modeBLink()]))).toBe(true);
  });

  it("a Mode-A + Mode-B mixed note is offered (the range exists to tint)", () => {
    expect(canMorphNoteToHighlight(noteWith([modeALink(), modeBLink()]))).toBe(true);
  });

  it("the registry morph declaration stays static (note⇄highlight, lossy)", () => {
    // The gate is consumer-owned; the declared pair must NOT change. The morph
    // now also declares the dropped-field set (T4 §3.2): note↔highlight drops
    // the body + title (a highlight has neither), but NOT aiRequest (it carries
    // across — both kinds declare aiRequest routing), so no spurious unbridge.
    expect(CARD_REGISTRY.note.morph).toEqual({
      to: "highlight",
      lossy: true,
      drops: ["body", "title"],
    });
    expect(CARD_REGISTRY.highlight.morph).toEqual({
      to: "note",
      lossy: true,
      drops: ["body", "title"],
    });
    // note↔highlight must NOT drop aiRequest (it's carried across in the morph
    // transform) — a spurious unbridge would strand the inbox the user wants.
    expect(CARD_REGISTRY.note.morph?.drops).not.toContain("aiRequest");
    expect(CARD_REGISTRY.highlight.morph?.drops).not.toContain("aiRequest");
  });
});
