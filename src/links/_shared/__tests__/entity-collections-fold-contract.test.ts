import { describe, it, expect } from "vitest";
import { findEntity, ANCHORED_CARD_KINDS } from "../entity-hover";
import type { EntityCollectionSlots } from "@/cards/entity-collections";
import type { CardFloatCtx } from "@/cards/card-float-ctx";

/**
 * A3 Commit H (WS5) fold pin-test. The parallel `EntityCollections` interface
 * was retired; the linked-entity resolvers now consume the slim
 * `EntityCollectionSlots` (in `src/cards/`, cycle-safe), which `CardFloatCtx`
 * (= the heavy `PoppedCardDeps` bag) structurally satisfies — so ONE bag flows
 * to both the float renderer and the resolvers. This pins:
 *
 *   (1) the slot reconciliation — `findEntity` reads `todoItems` (not `todos`),
 *       `reportCards` (not `reports`), and resolves examples by `exampleId ?? id`;
 *   (2) the type-level structural satisfaction `CardFloatCtx ⊇ EntityCollectionSlots`,
 *       so a future bag-shape change that breaks the fold fails to compile.
 */

// ── (2) type-level: CardFloatCtx structurally satisfies EntityCollectionSlots.
//    If a slot is renamed/removed on the heavy bag, `_satisfies` stops compiling.
type AssertExtends<T extends U, U> = true;
type _Satisfies = AssertExtends<CardFloatCtx, EntityCollectionSlots>;
const _satisfies: _Satisfies = true;

describe("EntityCollections fold onto CardFloatCtx (WS5)", () => {
  it("CardFloatCtx structurally satisfies the slim EntityCollectionSlots (type-level)", () => {
    expect(_satisfies).toBe(true);
  });

  it("findEntity resolves every anchored kind from a CardFloatCtx-shaped bag", () => {
    // A bag with the heavy-bag slot NAMES (todoItems / reportCards) and the
    // ExampleInfo `exampleId` key — exactly what EditorPane now threads.
    const bag: EntityCollectionSlots = {
      notes: [{ id: "note-1" }],
      highlights: [{ id: "hl-1" }],
      cutterCards: [
        { id: "cut-c", kind: "comment" },
        { id: "cut-s", kind: "suggestion" },
      ],
      comments: [
        { id: "rev-c", kind: "comment" },
        { id: "rev-s", kind: "suggestion" },
      ],
      todoItems: [{ id: "todo-1" }],
      archiveSnippets: [{ id: "arch-1" }],
      reportCards: [
        { id: "rep", kind: "report" },
        { id: "rep-r", kind: "report-request" },
      ],
      examples: [{ exampleId: "ex-1" }],
    };

    const expected: Record<string, string> = {
      note: "note-1",
      highlight: "hl-1",
      "cutter-comment": "cut-c",
      "cutter-suggestion": "cut-s",
      "revision-comment": "rev-c",
      "revision-suggestion": "rev-s",
      todo: "todo-1",
      archive: "arch-1",
      report: "rep",
      "report-request": "rep-r",
      example: "ex-1",
    };

    for (const [kind, id] of Object.entries(expected)) {
      const hit = findEntity({ kind: kind as (typeof ANCHORED_CARD_KINDS)[number], id }, bag);
      expect(hit, `findEntity could not resolve ${kind}:${id}`).toBeDefined();
      expect(hit!.id).toBe(id);
    }

    // The slot reconciliation is real: todoItems / reportCards (not the old
    // todos / reports names) are what got read.
    expect(findEntity({ kind: "todo", id: "todo-1" }, bag)).toBeDefined();
    expect(findEntity({ kind: "report", id: "rep" }, bag)).toBeDefined();
    // The example carve-out resolves by exampleId.
    expect(findEntity({ kind: "example", id: "ex-1" }, bag)).toBeDefined();
  });

  it("the footnote/citation inline-atom kinds resolve to undefined (not in collections)", () => {
    const empty: EntityCollectionSlots = {
      notes: [],
      cutterCards: [],
      comments: [],
      todoItems: [],
      archiveSnippets: [],
      examples: [],
    };
    expect(findEntity({ kind: "footnote", id: "f" }, empty)).toBeUndefined();
    expect(findEntity({ kind: "citation", id: "c" }, empty)).toBeUndefined();
  });
});
