// @vitest-environment jsdom
//
// Task 701 — `useNotes.convertCard` (the note ⇄ highlight morph's `mutate`
// step) re-derives a flagged card's open inbox row for the kind it BECOMES,
// with the TO kind's own context builder, in BOTH directions; an unflagged
// card files nothing. The row rewrite itself is pinned in
// `src/lib/__tests__/morph-rederives-ai-request-row.test.ts`.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const mockRead = vi.fn();
const mockWrite = vi.fn();
const rederive = vi.fn(async () => {});

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule({
    readSidecar: (...a: unknown[]) => mockRead(...a),
    readSidecarIfExists: (...a: unknown[]) => mockRead(...a),
    writeSidecar: (...a: unknown[]) => mockWrite(...a),
  }),
);
vi.mock("@/lib/ai-request-bridge", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai-request-bridge")>()),
  rederiveAiRequestForMorph: (...a: unknown[]) => rederive(...(a as [])),
}));

import { useNotes } from "../useNotes";
import { beginDocPipeline, __resetForTests } from "@/lib/multi-window/doc-pipeline";

beforeEach(() => {
  mockRead.mockReset();
  mockWrite.mockReset();
  mockWrite.mockResolvedValue(undefined);
  rederive.mockClear();
  __resetForTests();
});

const base = { createdAt: "2026-01-01T00:00:00.000Z", links: [] };

async function mount(docId: string, card: Record<string, unknown>) {
  beginDocPipeline(docId);
  mockRead.mockResolvedValue({ cards: [card] });
  const hook = renderHook(() => useNotes(docId));
  await waitFor(() => expect(hook.result.current.cards.length).toBe(1));
  return hook;
}

describe("useNotes.convertCard re-derives the carried inbox row (task 701)", () => {
  it("note → highlight: rederives under the highlight's context", async () => {
    const { result } = await mount("doc-a", {
      kind: "note", id: "n1", title: "Old title", content: {}, aiRequest: true, ...base,
    });
    act(() => result.current.convertCard("n1", "highlight"));
    await waitFor(() => expect(result.current.cards[0].kind).toBe("highlight"));
    expect(rederive).toHaveBeenCalledTimes(1);
    expect(rederive).toHaveBeenCalledWith("doc-a", "note", "highlight", "n1",
      expect.objectContaining({ text: "<highlight>" }));
  });

  it("highlight → note: rederives under the note's context, and the note's blank title is machine-default", async () => {
    const { result } = await mount("doc-b", {
      kind: "highlight", id: "h1", highlightColor: null, aiRequest: true, ...base,
    });
    act(() => result.current.convertCard("h1", "note"));
    await waitFor(() => expect(result.current.cards[0].kind).toBe("note"));
    expect(rederive).toHaveBeenCalledWith("doc-b", "highlight", "note", "h1",
      expect.objectContaining({ text: "<note>" }));
    const note = result.current.cards[0] as { title: string; titleAuto?: boolean };
    expect(note.title).toBe("");
    expect(note.titleAuto).toBe(true);
  });

  it("an unflagged card files nothing", async () => {
    const { result } = await mount("doc-c", {
      kind: "highlight", id: "h2", highlightColor: null, aiRequest: false, ...base,
    });
    act(() => result.current.convertCard("h2", "note"));
    await waitFor(() => expect(result.current.cards[0].kind).toBe("note"));
    expect(rederive).not.toHaveBeenCalled();
  });
});
