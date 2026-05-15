import { describe, expect, it } from "vitest";
import {
  shortRelativeTime,
  summarizeStackItem,
} from "../snapshot";
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
});

describe("shortRelativeTime", () => {
  const now = new Date("2026-05-14T12:00:00.000Z").getTime();
  it("returns 'now' for very recent times", () => {
    expect(shortRelativeTime("2026-05-14T11:59:50.000Z", now)).toBe("now");
  });
  it("formats minutes", () => {
    expect(shortRelativeTime("2026-05-14T11:55:00.000Z", now)).toBe("5m");
  });
  it("formats hours", () => {
    expect(shortRelativeTime("2026-05-14T10:00:00.000Z", now)).toBe("2h");
  });
  it("formats days", () => {
    expect(shortRelativeTime("2026-05-11T12:00:00.000Z", now)).toBe("3d");
  });
});
