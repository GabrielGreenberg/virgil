// @vitest-environment jsdom
//
// Phase 1a (pending AI changes): the widened suggestion-card status union
// (`pending | applied | stale | accepted | rejected`) must round-trip through
// the Revisions + Cutter migrate paths. Before the safe-list was extended, an
// unknown status normalized to `"pending"`, so a persisted `applied`/`stale`
// card would silently reset on load. These pin that:
//   - an `applied` card loads back `applied` AND keeps its `appliedChange`
//     descriptor unchanged;
//   - a `stale` card loads back `stale`;
//   - `accepted`/`rejected`/`pending` keep behaving exactly as before;
//   - a genuinely unknown status still normalizes to `"pending"`.
// Mirrors card-archived-persist.test.ts (same storage-mock + renderHook plumbing).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const mockRead = vi.fn();
const mockWrite = vi.fn();

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule({
    readSidecar: (...a: unknown[]) => mockRead(...a),
    readSidecarIfExists: (...a: unknown[]) => mockRead(...a),
    writeSidecar: (...a: unknown[]) => mockWrite(...a),
  }),
);

import { useRevisions } from "../useRevisions";
import { useCutter } from "../useCutter";
import {
  beginDocPipeline,
  __resetForTests,
} from "@/lib/multi-window/doc-pipeline";

beforeEach(() => {
  mockRead.mockReset();
  mockWrite.mockReset();
  mockWrite.mockResolvedValue(undefined);
  __resetForTests();
});

const base = { createdAt: "2026-01-01T00:00:00.000Z", links: [] };
const suggestionFields = {
  author: "ai",
  original_text: "Before.",
  suggested_text: "After.",
  explanation: "",
  user_text: "",
  instructions: "",
};
const appliedChange = {
  anchorId: "anc-1",
  anchorUuid: "uuid-1",
  originalText: "Before.",
  replacement: "After.",
  mode: "replace" as const,
  appliedAt: "2026-01-02T00:00:00.000Z",
};

describe("suggestion status union round-trips through migrate (revisions)", () => {
  it("an applied card loads back applied + keeps appliedChange", async () => {
    beginDocPipeline("rev-applied");
    mockRead.mockResolvedValue({
      cards: [
        { kind: "suggestion", id: "s-applied", status: "applied", appliedChange, ...suggestionFields, ...base },
      ],
    });
    const { result } = renderHook(() => useRevisions("rev-applied"));
    await waitFor(() => expect(result.current.cards.length).toBe(1));
    const card = result.current.cards[0];
    expect(card.kind).toBe("suggestion");
    if (card.kind !== "suggestion") throw new Error("expected suggestion");
    expect(card.status).toBe("applied");
    expect(card.appliedChange).toEqual(appliedChange);
  });

  it("a stale card loads back stale", async () => {
    beginDocPipeline("rev-stale");
    mockRead.mockResolvedValue({
      cards: [{ kind: "suggestion", id: "s-stale", status: "stale", ...suggestionFields, ...base }],
    });
    const { result } = renderHook(() => useRevisions("rev-stale"));
    await waitFor(() => expect(result.current.cards.length).toBe(1));
    expect(result.current.cards[0].kind === "suggestion" && result.current.cards[0].status).toBe("stale");
  });

  it("accepted/rejected/pending are preserved; unknown → pending", async () => {
    beginDocPipeline("rev-known");
    mockRead.mockResolvedValue({
      cards: [
        { kind: "suggestion", id: "s-acc", status: "accepted", ...suggestionFields, ...base },
        { kind: "suggestion", id: "s-rej", status: "rejected", ...suggestionFields, ...base },
        { kind: "suggestion", id: "s-pen", status: "pending", ...suggestionFields, ...base },
        { kind: "suggestion", id: "s-bad", status: "bogus", ...suggestionFields, ...base },
      ],
    });
    const { result } = renderHook(() => useRevisions("rev-known"));
    await waitFor(() => expect(result.current.cards.length).toBe(4));
    const byId = Object.fromEntries(
      result.current.cards.map((c) => [c.id, c.kind === "suggestion" ? c.status : null]),
    );
    expect(byId["s-acc"]).toBe("accepted");
    expect(byId["s-rej"]).toBe("rejected");
    expect(byId["s-pen"]).toBe("pending");
    expect(byId["s-bad"]).toBe("pending");
  });
});

describe("suggestion status union round-trips through migrate (cutter)", () => {
  it("an applied card loads back applied + keeps appliedChange", async () => {
    beginDocPipeline("cut-applied");
    mockRead.mockResolvedValue({
      cards: [
        { kind: "suggestion", id: "c-applied", status: "applied", appliedChange, ...suggestionFields, ...base },
      ],
    });
    const { result } = renderHook(() => useCutter("cut-applied"));
    await waitFor(() => expect(result.current.cards.length).toBe(1));
    const card = result.current.cards[0];
    if (card.kind !== "suggestion") throw new Error("expected suggestion");
    expect(card.status).toBe("applied");
    expect(card.appliedChange).toEqual(appliedChange);
  });

  it("a stale card loads back stale; unknown → pending", async () => {
    beginDocPipeline("cut-stale");
    mockRead.mockResolvedValue({
      cards: [
        { kind: "suggestion", id: "c-stale", status: "stale", ...suggestionFields, ...base },
        { kind: "suggestion", id: "c-bad", status: "bogus", ...suggestionFields, ...base },
      ],
    });
    const { result } = renderHook(() => useCutter("cut-stale"));
    await waitFor(() => expect(result.current.cards.length).toBe(2));
    const byId = Object.fromEntries(
      result.current.cards.map((c) => [c.id, c.kind === "suggestion" ? c.status : null]),
    );
    expect(byId["c-stale"]).toBe("stale");
    expect(byId["c-bad"]).toBe("pending");
  });
});
