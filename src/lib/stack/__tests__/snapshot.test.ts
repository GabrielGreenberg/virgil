import { describe, expect, it } from "vitest";
import { summarizeStackItem } from "../snapshot";
import type { StackItem } from "../types";

function noteItem(overrides: Partial<StackItem> = {}): StackItem {
  return {
    id: "stack-uuid",
    capturedAt: "2026-05-14T12:00:00.000Z",
    source: { docId: "doc1" },
    payload: {
      kind: "card",
      card: {
        cardKind: "note",
        data: {
          kind: "note",
          id: "note-1",
          title: "My note",
          content: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Hello world" }],
              },
            ],
          },
          createdAt: "2026-05-14T11:55:00.000Z",
          aiRequest: false,
          links: [],
        },
      },
    },
    ...overrides,
  } as StackItem;
}

describe("summarizeStackItem", () => {
  it("uses note title when available", () => {
    expect(summarizeStackItem(noteItem())).toBe("My note");
  });

  it("falls back to body text when title is empty", () => {
    const item = noteItem({
      payload: {
        kind: "card",
        card: {
          cardKind: "note",
          data: {
            kind: "note",
            id: "note-2",
            title: "",
            content: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Just the body" }],
                },
              ],
            },
            createdAt: "2026-05-14T11:55:00.000Z",
            aiRequest: false,
            links: [],
          },
        },
      },
    });
    expect(summarizeStackItem(item)).toBe("Just the body");
  });

  it("summarises a text payload from its plain field", () => {
    const item: StackItem = {
      id: "stack-2",
      capturedAt: "2026-05-14T12:00:00.000Z",
      source: { docId: null },
      payload: { kind: "text", slice: {}, plain: "Some captured text" },
    };
    expect(summarizeStackItem(item)).toBe("Some captured text");
  });

  it("truncates long summaries with an ellipsis", () => {
    const longText = "abc ".repeat(120).trim();
    const item: StackItem = {
      id: "stack-3",
      capturedAt: "2026-05-14T12:00:00.000Z",
      source: { docId: null },
      payload: { kind: "text", slice: {}, plain: longText },
    };
    const out = summarizeStackItem(item, 40);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith("…")).toBe(true);
  });

  // Task 2026-11-15-1630 — a card is named by its carried anchor text when its
  // own text is empty; "(highlight)" is retired.
  describe("anchor-text fallback", () => {
    function rangeLink(textSnapshot: string, archivedWith?: string) {
      return {
        id: "range-a1",
        kind: "anchor",
        anchor: {
          type: "textObject",
          targetKind: "linkedRange",
          textObjectIds: ["p1"],
          textRange: { anchorId: "a1", textSnapshot },
        },
        target: { type: "card", ref: { kind: "note", id: "c1" } },
        createdAt: "2026-01-01T00:00:00.000Z",
        ...(archivedWith ? { archivedWith } : {}),
      };
    }
    function cardItem(cardKind: string, data: Record<string, unknown>): StackItem {
      return noteItem({
        payload: { kind: "card", card: { cardKind, data } },
      } as unknown as Partial<StackItem>);
    }

    it("summarises a highlight by its live text-range snapshot", () => {
      const item = cardItem("highlight", {
        kind: "highlight",
        id: "h1",
        links: [rangeLink("the marked words")],
      });
      expect(summarizeStackItem(item)).toBe("the marked words");
    });

    it("never reads the retired constant", () => {
      const item = cardItem("highlight", { kind: "highlight", id: "h1", links: [] });
      expect(summarizeStackItem(item)).not.toContain("(highlight)");
    });

    it("a dormant-only highlight summarises to empty", () => {
      const item = cardItem("highlight", {
        kind: "highlight",
        id: "h1",
        links: [rangeLink("archived words", "arch-1")],
      });
      expect(summarizeStackItem(item)).toBe("");
    });

    it("a Mode-A relocated highlight reads its paragraphSnapshot", () => {
      const item = cardItem("highlight", {
        kind: "highlight",
        id: "h1",
        links: [
          {
            id: "pa",
            kind: "anchor",
            anchor: {
              type: "textObject",
              targetKind: "paragraph",
              textObjectIds: ["p1"],
              paragraphSnapshot: "relocated words",
            },
            target: { type: "card", ref: { kind: "highlight", id: "h1" } },
            createdAt: "",
          },
        ],
      });
      expect(summarizeStackItem(item)).toBe("relocated words");
    });

    it("a note with empty title + body falls back to its anchor text", () => {
      const item = cardItem("note", {
        kind: "note",
        id: "n1",
        title: "",
        content: { type: "doc", content: [{ type: "paragraph" }] },
        createdAt: "",
        aiRequest: false,
        links: [rangeLink("anchored phrase")],
      });
      expect(summarizeStackItem(item)).toBe("anchored phrase");
    });

    it("a blank revision comment falls back to its anchor text", () => {
      const item = cardItem("revision-comment", {
        kind: "revision-comment",
        id: "r1",
        text: "",
        links: [rangeLink("quoted passage")],
      });
      expect(summarizeStackItem(item)).toBe("quoted passage");
    });

    it("a card's own text still wins over its anchor", () => {
      const item = cardItem("note", {
        kind: "note",
        id: "n1",
        title: "Own title",
        content: { type: "doc", content: [] },
        createdAt: "",
        aiRequest: false,
        links: [rangeLink("anchored phrase")],
      });
      expect(summarizeStackItem(item)).toBe("Own title");
    });
  });
});
