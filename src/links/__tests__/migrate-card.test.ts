import { describe, it, expect } from "vitest";
import { migrateCardLinks } from "../migrate-card";

describe("migrateCardLinks", () => {
  it("returns existing links[] (already in new shape) unchanged content-wise", () => {
    const existingLinks = [
      {
        id: "abc",
        kind: "anchor" as const,
        anchor: {
          type: "textObject" as const,
          targetKind: "paragraph" as const,
          textObjectIds: ["p1"],
          margin: { side: "right" as const },
        },
        target: { type: "card" as const, ref: { kind: "note" as const, id: "n1" } },
        createdAt: "2026-01-01T00:00:00Z",
      },
    ];
    const result = migrateCardLinks("note", { id: "n1", links: existingLinks });
    expect(result).toEqual(existingLinks);
  });

  it("derives links[] from legacy paragraphIds (Mode A)", () => {
    const result = migrateCardLinks("note", {
      id: "n1",
      paragraphIds: ["p-uuid-1", "p-uuid-2"],
    });
    expect(result).toHaveLength(2);
    expect(result[0].kind).toBe("anchor");
    expect(result[0].target).toEqual({ type: "card", ref: { kind: "note", id: "n1" } });
    expect(result[0].anchor.type).toBe("textObject");
    if (result[0].anchor.type === "textObject") {
      expect(result[0].anchor.targetKind).toBe("paragraph");
      expect(result[0].anchor.textObjectIds).toEqual(["p-uuid-1"]);
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
    if (result[0].anchor.type === "textObject") {
      expect(result[0].anchor.targetKind).toBe("linkedRange");
      expect(result[0].anchor.textRange?.anchorId).toBe("anchor-xyz");
      expect(result[0].anchor.textRange?.textSnapshot).toBe("the quick brown fox");
    }
  });

  it("returns empty array for an unanchored card (no legacy fields, no links)", () => {
    expect(migrateCardLinks("note", { id: "n1" })).toEqual([]);
  });

  it("is idempotent: migrate twice yields equivalent links[]", () => {
    const raw = { id: "n1", paragraphIds: ["p1"] };
    const first = migrateCardLinks("note", raw);
    const withLinks = { ...raw, links: first };
    const second = migrateCardLinks("note", withLinks);
    expect(second).toEqual(first);
  });

  it("ignores non-object input", () => {
    expect(migrateCardLinks("note", null)).toEqual([]);
    expect(migrateCardLinks("note", undefined)).toEqual([]);
    expect(migrateCardLinks("note", "garbage")).toEqual([]);
  });

  it("works across card kinds (cutter-comment, archive, todo, report)", () => {
    const legacy = { id: "x1", paragraphIds: ["p1"] };
    for (const kind of ["cutter-comment", "archive", "todo", "report"] as const) {
      const links = migrateCardLinks(kind, legacy);
      expect(links).toHaveLength(1);
      expect(links[0].target).toEqual({ type: "card", ref: { kind, id: "x1" } });
    }
  });

  describe("D8 anchor-shape migration (legacy links[] with old type='anchor')", () => {
    it("migrates Mode A legacy anchor links to type='textObject' + targetKind='paragraph'", () => {
      const legacyLinks = [
        {
          id: "lk1",
          kind: "anchor",
          anchor: {
            type: "anchor",
            paragraphIds: ["p1", "p2"],
            margin: { side: "right" },
          },
          target: { type: "card", ref: { kind: "note", id: "n1" } },
          createdAt: "2026-01-01T00:00:00Z",
        },
      ];
      const result = migrateCardLinks("note", { id: "n1", links: legacyLinks });
      expect(result).toHaveLength(1);
      expect(result[0].anchor.type).toBe("textObject");
      if (result[0].anchor.type === "textObject") {
        expect(result[0].anchor.targetKind).toBe("paragraph");
        expect(result[0].anchor.textObjectIds).toEqual(["p1", "p2"]);
        expect(result[0].anchor.margin).toEqual({ side: "right" });
        expect(result[0].anchor.textRange).toBeUndefined();
      }
    });

    it("migrates Mode B legacy anchor links to type='textObject' + targetKind='linkedRange'", () => {
      const legacyLinks = [
        {
          id: "lk2",
          kind: "anchor",
          anchor: {
            type: "anchor",
            paragraphIds: ["p1"],
            margin: { side: "left" },
            textRange: { anchorId: "a-xyz", textSnapshot: "hello world" },
          },
          target: { type: "card", ref: { kind: "report", id: "q1" } },
          createdAt: "2026-01-01T00:00:00Z",
        },
      ];
      const result = migrateCardLinks("report", { id: "q1", links: legacyLinks });
      expect(result).toHaveLength(1);
      expect(result[0].anchor.type).toBe("textObject");
      if (result[0].anchor.type === "textObject") {
        expect(result[0].anchor.targetKind).toBe("linkedRange");
        expect(result[0].anchor.textObjectIds).toEqual(["p1"]);
        expect(result[0].anchor.textRange).toEqual({
          anchorId: "a-xyz",
          textSnapshot: "hello world",
        });
      }
    });

    it("leaves inline-atom links unchanged", () => {
      const links = [
        {
          id: "fn1",
          kind: "footnote",
          anchor: { type: "inline-atom", nodeName: "footnote", pos: 42 },
          target: { type: "card", ref: { kind: "footnote", id: "fn1" } },
          createdAt: "2026-01-01T00:00:00Z",
        },
      ];
      const result = migrateCardLinks("footnote", { id: "fn1", links });
      expect(result[0].anchor).toEqual({
        type: "inline-atom",
        nodeName: "footnote",
        pos: 42,
      });
    });

    it("passes new-shape links through unchanged", () => {
      const newShape = [
        {
          id: "lk3",
          kind: "anchor",
          anchor: {
            type: "textObject",
            targetKind: "paragraph",
            textObjectIds: ["p1"],
            margin: { side: "right" },
          },
          target: { type: "card", ref: { kind: "note", id: "n2" } },
          createdAt: "2026-01-01T00:00:00Z",
        },
      ];
      const result = migrateCardLinks("note", { id: "n2", links: newShape });
      expect(result[0].anchor).toEqual(newShape[0].anchor);
    });

    it("handles a mixed array of legacy and new-shape links", () => {
      const mixed = [
        {
          id: "lk-old",
          kind: "anchor",
          anchor: {
            type: "anchor",
            paragraphIds: ["p1"],
            margin: { side: "right" },
          },
          target: { type: "card", ref: { kind: "note", id: "n3" } },
          createdAt: "",
        },
        {
          id: "lk-new",
          kind: "anchor",
          anchor: {
            type: "textObject",
            targetKind: "paragraph",
            textObjectIds: ["p2"],
            margin: { side: "right" },
          },
          target: { type: "card", ref: { kind: "note", id: "n3" } },
          createdAt: "",
        },
      ];
      const result = migrateCardLinks("note", { id: "n3", links: mixed });
      expect(result).toHaveLength(2);
      expect(result[0].anchor.type).toBe("textObject");
      expect(result[1].anchor.type).toBe("textObject");
      if (result[0].anchor.type === "textObject") {
        expect(result[0].anchor.textObjectIds).toEqual(["p1"]);
      }
      if (result[1].anchor.type === "textObject") {
        expect(result[1].anchor.textObjectIds).toEqual(["p2"]);
      }
    });
  });
});
