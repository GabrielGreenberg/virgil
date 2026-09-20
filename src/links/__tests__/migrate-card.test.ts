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
      // TASK 664 — a legacy MULTI-paragraph Mode-A anchor fans out to the ONE
      // canonical multi-anchor shape (N links x 1 id), the shape
      // `derivedLinksForCard` and every live write path already emit. It used
      // to stay a single link carrying `["p1","p2"]` — a second shape whose
      // readers (`resolveCardAnchor` rung 1, `isModeAOrphaned`) only ever
      // looked at `[0]`.
      expect(result).toHaveLength(2);
      expect(result.map((l) => l.id)).toEqual(["n1@p1", "n1@p2"]);
      for (const [i, pid] of ["p1", "p2"].entries()) {
        expect(result[i].anchor.type).toBe("textObject");
        const anchor = result[i].anchor;
        if (anchor.type !== "textObject") continue;
        expect(anchor.targetKind).toBe("paragraph");
        expect(anchor.textObjectIds).toEqual([pid]);
        // The legacy blob's `margin: { side }` is DROPPED, not carried (task
        // 205): the side a card's margin chrome sits on is resolved live from
        // its panel's dock, so a migrated anchor must not resurrect a frozen
        // copy of it.
        expect((anchor as Record<string, unknown>).margin).toBeUndefined();
        expect(anchor.textRange).toBeUndefined();
        // Everything outside the anchor rides along on every fanned link.
        expect(result[i].kind).toBe("anchor");
        expect(result[i].target).toEqual({
          type: "card",
          ref: { kind: "note", id: "n1" },
        });
        expect(result[i].createdAt).toBe("2026-01-01T00:00:00Z");
      }
    });

    it("a SINGLE-paragraph legacy Mode-A anchor keeps its own link id", () => {
      // The fan-out must not churn the overwhelmingly common single-anchor
      // case: same one link, same id, only the anchor shape migrated.
      const result = migrateCardLinks("note", {
        id: "n1",
        links: [
          {
            id: "lk-solo",
            kind: "anchor",
            anchor: { type: "anchor", paragraphIds: ["p1"] },
            target: { type: "card", ref: { kind: "note", id: "n1" } },
            createdAt: "2026-01-01T00:00:00Z",
          },
        ],
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("lk-solo");
      if (result[0].anchor.type === "textObject") {
        expect(result[0].anchor.textObjectIds).toEqual(["p1"]);
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

  describe("legacy target.ref.kind normalization (load funnel)", () => {
    /** A pre-refactor revision-card link exactly as persisted on disk:
     *  legacy anchor shape AND legacy "comment" ref kind. */
    const legacyRevisionLink = {
      id: "lk-legacy-rev",
      kind: "anchor",
      anchor: {
        type: "anchor",
        paragraphIds: ["p1"],
        margin: { side: "right" },
      },
      target: { type: "card", ref: { kind: "comment", id: "rc1" } },
      createdAt: "2026-01-01T00:00:00Z",
    };

    it("normalizes the pre-refactor 'comment' token to 'revision-comment' end-to-end", () => {
      const result = migrateCardLinks("revision-comment", {
        id: "rc1",
        links: [legacyRevisionLink],
      });
      expect(result).toHaveLength(1);
      expect(result[0].target.ref).toEqual({ kind: "revision-comment", id: "rc1" });
      // Anchor migration still runs on the normalized link.
      expect(result[0].anchor.type).toBe("textObject");
    });

    it("normalizes the legacy cuts[] 'cut' token to 'cutter-comment'", () => {
      const result = migrateCardLinks("cutter-comment", {
        id: "cc1",
        links: [
          {
            ...legacyRevisionLink,
            id: "lk-legacy-cut",
            target: { type: "card", ref: { kind: "cut", id: "cc1" } },
          },
        ],
      });
      expect(result).toHaveLength(1);
      expect(result[0].target.ref.kind).toBe("cutter-comment");
    });

    it("keeps a link with an unmappable kind as-is (never drops it)", () => {
      const result = migrateCardLinks("note", {
        id: "q1",
        links: [
          {
            ...legacyRevisionLink,
            id: "lk-quotation",
            target: { type: "card", ref: { kind: "quotation", id: "q1" } },
          },
        ],
      });
      expect(result).toHaveLength(1);
      // Unknown token preserved verbatim — the runtime-total crosswalk
      // accessors are the backstop, not the funnel.
      expect(result[0].target.ref).toEqual({ kind: "quotation", id: "q1" });
      // Anchor migration still applies to the kept link.
      expect(result[0].anchor.type).toBe("textObject");
    });

    it("leaves spine-kind links untouched (idempotent on already-clean data)", () => {
      const clean = [
        {
          id: "lk-clean",
          kind: "anchor",
          anchor: {
            type: "textObject",
            targetKind: "paragraph",
            textObjectIds: ["p1"],
            margin: { side: "right" },
          },
          target: { type: "card", ref: { kind: "revision-comment", id: "rc2" } },
          createdAt: "2026-01-01T00:00:00Z",
        },
      ];
      const result = migrateCardLinks("revision-comment", { id: "rc2", links: clean });
      expect(result).toEqual(clean);
    });

    it("tolerates a malformed link with no target", () => {
      const malformed = [
        {
          id: "lk-broken",
          kind: "anchor",
          anchor: {
            type: "textObject",
            targetKind: "paragraph",
            textObjectIds: ["p1"],
            margin: { side: "right" },
          },
          createdAt: "2026-01-01T00:00:00Z",
        },
      ];
      const result = migrateCardLinks("note", { id: "n9", links: malformed });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("lk-broken");
    });
  });
});

// ===========================================================================
// TASK 664 — the two migration branches emit ONE shape
//
// `migrateCardLinks` reaches for `derivedLinksForCard` when the sidecar has
// no `links[]` at all, and migrates in place when it has a legacy
// `type:"anchor"` one. Both branches canonicalise the SAME legacy fact —
// "this card is anchored to these paragraphs" — and they used to produce two
// different shapes for it (one link x N ids vs N links x one id), neither of
// which had a consumer that read all of it. Same fixture, same shape out.
// ===========================================================================

describe("task 664 — one canonical multi-anchor shape", () => {
  /** Everything about a link the two branches CAN agree on. `createdAt` is
   *  deliberately excluded: branch 1 preserves the legacy link's stamp,
   *  branch 2 has none to preserve. */
  const shapeOf = (links: ReturnType<typeof migrateCardLinks>) =>
    links.map((l) => ({ id: l.id, kind: l.kind, anchor: l.anchor, target: l.target }));

  it("Mode A: a legacy links[] blob and bare paragraphIds migrate identically", () => {
    const pids = ["p1", "p2", "p3"];
    const fromLegacyLinks = migrateCardLinks("note", {
      id: "n1",
      links: [
        {
          id: "lk1",
          kind: "anchor",
          anchor: { type: "anchor", paragraphIds: pids },
          target: { type: "card", ref: { kind: "note", id: "n1" } },
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
    });
    const fromBareFields = migrateCardLinks("note", { id: "n1", paragraphIds: pids });
    expect(shapeOf(fromLegacyLinks)).toEqual(shapeOf(fromBareFields));
    // …and that one shape is the N-links one every live write path emits.
    expect(fromLegacyLinks).toHaveLength(3);
    for (const l of fromLegacyLinks) {
      expect(l.anchor.type === "textObject" && l.anchor.textObjectIds).toHaveLength(1);
    }
  });

  it("Mode B: the two branches already agreed, and still do", () => {
    const fromLegacyLinks = migrateCardLinks("report", {
      id: "q1",
      links: [
        {
          id: "a-xyz",
          kind: "anchor",
          anchor: {
            type: "anchor",
            paragraphIds: ["p1"],
            textRange: { anchorId: "a-xyz", textSnapshot: "hello world" },
          },
          target: { type: "card", ref: { kind: "report", id: "q1" } },
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
    });
    const fromBareFields = migrateCardLinks("report", {
      id: "q1",
      paragraphIds: ["p1"],
      anchorId: "a-xyz",
      anchorText: "hello world",
    });
    expect(shapeOf(fromLegacyLinks)).toEqual(shapeOf(fromBareFields));
  });
});
