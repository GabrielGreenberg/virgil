import { describe, it, expect } from "vitest";
import { migrateCardLinks } from "../migrate-card";

describe("migrateCardLinks", () => {
  it("returns existing links[] unchanged when non-empty", () => {
    const existingLinks = [
      {
        id: "abc",
        kind: "anchor" as const,
        anchor: {
          type: "anchor" as const,
          paragraphIds: ["p1"],
          margin: { side: "right" as const },
        },
        target: { type: "card" as const, ref: { kind: "note" as const, id: "n1" } },
        createdAt: "2026-01-01T00:00:00Z",
      },
    ];
    const result = migrateCardLinks("note", { id: "n1", links: existingLinks });
    expect(result).toBe(existingLinks);
  });

  it("derives links[] from legacy paragraphIds (Mode A)", () => {
    const result = migrateCardLinks("note", {
      id: "n1",
      paragraphIds: ["p-uuid-1", "p-uuid-2"],
    });
    expect(result).toHaveLength(2);
    expect(result[0].kind).toBe("anchor");
    expect(result[0].target).toEqual({ type: "card", ref: { kind: "note", id: "n1" } });
    expect(result[0].anchor.type).toBe("anchor");
    if (result[0].anchor.type === "anchor") {
      expect(result[0].anchor.paragraphIds).toEqual(["p-uuid-1"]);
    }
  });

  it("derives a single link with textRange for Mode B (anchorId + anchorText)", () => {
    const result = migrateCardLinks("note", {
      id: "n1",
      paragraphIds: ["p-uuid-1"],
      anchorId: "anchor-xyz",
      anchorText: "the quick brown fox",
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("anchor-xyz");
    if (result[0].anchor.type === "anchor") {
      expect(result[0].anchor.textRange?.anchorId).toBe("anchor-xyz");
      expect(result[0].anchor.textRange?.textSnapshot).toBe("the quick brown fox");
    }
  });

  it("returns empty array for an unanchored card (no legacy fields, no links)", () => {
    expect(migrateCardLinks("note", { id: "n1" })).toEqual([]);
  });

  it("is idempotent: migrate twice yields the same links[]", () => {
    const raw = { id: "n1", paragraphIds: ["p1"] };
    const first = migrateCardLinks("note", raw);
    const withLinks = { ...raw, links: first };
    const second = migrateCardLinks("note", withLinks);
    expect(second).toBe(first);
  });

  it("ignores non-object input", () => {
    expect(migrateCardLinks("note", null)).toEqual([]);
    expect(migrateCardLinks("note", undefined)).toEqual([]);
    expect(migrateCardLinks("note", "garbage")).toEqual([]);
  });

  it("works across card kinds (cutter-comment, archive, todo, quotation)", () => {
    const legacy = { id: "x1", paragraphIds: ["p1"] };
    for (const kind of ["cutter-comment", "archive", "todo", "quotation"] as const) {
      const links = migrateCardLinks(kind, legacy);
      expect(links).toHaveLength(1);
      expect(links[0].target).toEqual({ type: "card", ref: { kind, id: "x1" } });
    }
  });
});
