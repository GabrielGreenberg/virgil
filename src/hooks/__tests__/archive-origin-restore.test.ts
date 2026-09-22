// @vitest-environment jsdom
//
// Task 712 — an agent-archived CARD is not an excerpt. Restoring a snippet that
// carries an origin record (`originalPanel` + `originalCard`, written by
// `apply_response.py cmd_archive`) must put the card back in its panel and
// NEVER land its body in the document's prose.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const mockRead = vi.fn();
const mockWrite = vi.fn();

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule({
    readSidecar: (...a: unknown[]) => mockRead(...a),
    readSidecarIfExists: (...a: unknown[]) => mockRead(...a),
    writeSidecar: (...a: unknown[]) => mockWrite(...a),
  }),
);

import { useArchive } from "../useArchive";
import { useNotes } from "../useNotes";
import { useTodos } from "../useTodos";
import { archiveOriginOf } from "@/lib/archive-origin";
import { beginDocPipeline, __resetForTests } from "@/lib/multi-window/doc-pipeline";

beforeEach(() => {
  mockRead.mockReset();
  mockWrite.mockReset();
  mockWrite.mockResolvedValue(undefined);
  __resetForTests();
});

const body = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a margin thought" }] }] };
const originalNote = {
  kind: "note",
  id: "n-1",
  title: "Why",
  content: body,
  aiRequest: false,
  createdAt: "2025-12-12T00:00:00.000Z",
  links: [{ id: "l1", anchor: { type: "textObject", targetKind: "paragraph", textObjectIds: ["p-9"] } }],
};
const originSnippet = {
  id: "n-1",
  title: "Why",
  content: body,
  createdAt: "2026-09-01T00:00:00.000Z",
  links: [],
  originalPanel: "notes",
  originalCard: originalNote,
  archivedAt: "2026-09-01T00:00:00.000Z",
};
const excerptSnippet = {
  id: "x-1",
  title: "",
  content: body,
  createdAt: "2026-09-01T00:00:00.000Z",
  links: [],
};

async function mountArchive(docId: string, snippets: unknown[]) {
  beginDocPipeline(docId);
  mockRead.mockResolvedValue({ snippets });
  const hook = renderHook(() => useArchive(docId));
  await waitFor(() => expect(hook.result.current.snippets.length).toBe(snippets.length));
  return hook;
}

describe("archiveOriginOf", () => {
  it("classifies excerpt / card / unreadable origin", () => {
    expect(archiveOriginOf({})).toEqual({ kind: "excerpt" });
    expect(archiveOriginOf(originSnippet)).toMatchObject({ kind: "card", panel: "notes" });
    expect(archiveOriginOf({ originalPanel: "footnotes", originalCard: { id: "f" } })).toEqual({
      kind: "unknown-card",
      panel: "footnotes",
    });
    expect(archiveOriginOf({ originalPanel: "notes" })).toMatchObject({ kind: "unknown-card" });
  });
});

describe("useArchive.restoreSnippet routes by origin", () => {
  it("a card with an origin goes back to its panel and never reaches the document", async () => {
    const { result } = await mountArchive("doc-1", [originSnippet, excerptSnippet]);
    const land = vi.fn(() => true);
    const reinstate = vi.fn(() => true);
    let ok = false;
    act(() => {
      ok = result.current.restoreSnippet("n-1", land, reinstate);
    });
    expect(ok).toBe(true);
    expect(land).not.toHaveBeenCalled();
    expect(reinstate).toHaveBeenCalledWith("notes", originalNote);
    // A MOVE, like cmd_restore: the snippet leaves archive.json (not set aside),
    // so the same card id is never live in two sidecars.
    expect(result.current.snippets.map((s) => s.id)).toEqual(["x-1"]);
  });

  it("with no reinstate door, an origin card refuses rather than paste into the prose", async () => {
    const { result } = await mountArchive("doc-2", [originSnippet]);
    const land = vi.fn(() => true);
    let ok = true;
    act(() => {
      ok = result.current.restoreSnippet("n-1", land);
    });
    expect(ok).toBe(false);
    expect(land).not.toHaveBeenCalled();
    expect(result.current.snippets).toHaveLength(1);
    expect(result.current.snippets[0].archived).toBeFalsy();
  });

  it("a refused reinstate leaves the snippet standing", async () => {
    const { result } = await mountArchive("doc-3", [originSnippet]);
    act(() => {
      result.current.restoreSnippet("n-1", vi.fn(() => true), () => false);
    });
    expect(result.current.snippets).toHaveLength(1);
  });

  it("an unreadable origin refuses and never lands", async () => {
    const broken = { ...originSnippet, originalPanel: "nowhere" };
    const { result } = await mountArchive("doc-4", [broken]);
    const land = vi.fn(() => true);
    const reinstate = vi.fn(() => true);
    let ok = true;
    act(() => {
      ok = result.current.restoreSnippet("n-1", land, reinstate);
    });
    expect(ok).toBe(false);
    expect(land).not.toHaveBeenCalled();
    expect(reinstate).not.toHaveBeenCalled();
    expect(result.current.snippetOrigin("n-1")).toEqual({ kind: "unknown-card", panel: "nowhere" });
  });

  it("an excerpt still lands in the document (the pre-712 path is unchanged)", async () => {
    const { result } = await mountArchive("doc-5", [excerptSnippet]);
    const land = vi.fn(() => true);
    const reinstate = vi.fn(() => true);
    act(() => {
      result.current.restoreSnippet("x-1", land, reinstate);
    });
    expect(land).toHaveBeenCalledWith(body);
    expect(reinstate).not.toHaveBeenCalled();
    expect(result.current.snippets[0].archived).toBe(true);
  });
});

describe("panel reinstate doors", () => {
  it("useNotes.reinstate appends the verbatim card (links included) and refuses a duplicate", async () => {
    beginDocPipeline("doc-n");
    mockRead.mockResolvedValue({ cards: [] });
    const { result } = renderHook(() => useNotes("doc-n"));
    await waitFor(() => expect(result.current.cards).toEqual([]));
    let ok = false;
    act(() => {
      ok = result.current.reinstate(originalNote);
    });
    expect(ok).toBe(true);
    expect(result.current.cards).toHaveLength(1);
    expect(result.current.cards[0]).toMatchObject({ kind: "note", id: "n-1", title: "Why" });
    expect(result.current.cards[0].links[0].anchor).toMatchObject({ textObjectIds: ["p-9"] });
    act(() => {
      ok = result.current.reinstate(originalNote);
    });
    expect(ok).toBe(false);
    expect(result.current.cards).toHaveLength(1);
  });

  it("useTodos.reinstate keeps the todo's done/notes fields", async () => {
    beginDocPipeline("doc-t");
    mockRead.mockResolvedValue({ items: [] });
    const { result } = renderHook(() => useTodos("doc-t"));
    await waitFor(() => expect(result.current.items).toEqual([]));
    act(() => {
      result.current.reinstate({
        id: "t-1",
        text: "Check the quote",
        notes: "p. 12",
        done: true,
        createdAt: "2025-12-12T00:00:00.000Z",
        links: [],
      });
    });
    expect(result.current.items[0]).toMatchObject({ id: "t-1", notes: "p. 12", done: true });
  });
});
