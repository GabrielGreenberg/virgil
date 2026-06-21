// @vitest-environment jsdom
//
// BUG #55 — footnotes join the per-card AI-request model.
//
// `useFootnotes(...).setFootnoteAiRequest(id, value)` must do TWO things,
// mirroring the note/todo/comment `setXAiRequest` callbacks:
//   1. flip the per-footnote flag in the `footnotes.json` sidecar
//      (FootnoteRef.aiRequest), and
//   2. bridge the toggle into the unified `ai-requests.json` queue via
//      `bridgeCardAiRequestFlag` — a `kind: "footnote"` entry linked to
//      `{ panel: "footnotes", cardId }` (the registry-declared routing, pinned
//      byte-for-byte by ai-request-routing-contract.test.ts).
//
// Untoggling drops the bridged request again (no orphan inbox entry).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { AiRequestsState, FootnotesState } from "@/lib/types";

// In-memory disk keyed by filename. `useFootnotes` reads/writes footnotes.json;
// `bridgeCardAiRequestFlag` reads/writes ai-requests.json. Both go through the
// same mocked storage barrel (the require("@/lib/storage-fsa") alias gotcha).
const DISK: Record<string, unknown> = {};
const writes: Array<{ file: string; data: unknown }> = [];

vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(async (_docId: string, file: string, dflt: unknown) =>
    file in DISK ? DISK[file] : dflt,
  ),
  writeSidecar: vi.fn(async (_handle: unknown, file: string, data: unknown) => {
    DISK[file] = data;
    writes.push({ file, data });
  }),
}));

import { useFootnotes } from "../useFootnotes";
import {
  beginDocPipeline,
  __resetForTests,
} from "@/lib/multi-window/doc-pipeline";

const DOC = "doc-fn-ai";

beforeEach(() => {
  __resetForTests();
  for (const k of Object.keys(DISK)) delete DISK[k];
  writes.length = 0;
});

function lastWrite(file: string) {
  return [...writes].reverse().find((w) => w.file === file)?.data;
}

describe("useFootnotes — per-card AI-request flag (BUG #55)", () => {
  it("setFootnoteAiRequest(true) flips the sidecar flag AND bridges a footnote request", async () => {
    beginDocPipeline(DOC);
    // Seed one footnote ref so the setter has a target.
    DISK["footnotes.json"] = {
      footnotes: [
        {
          id: "fn-1",
          content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a note body" }] }] },
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    } satisfies FootnotesState;

    const { result } = renderHook(() => useFootnotes(DOC));
    await waitFor(() => expect(result.current.footnoteRefs).toHaveLength(1));

    await act(async () => {
      result.current.setFootnoteAiRequest("fn-1", true);
    });

    // (1) sidecar flag flipped on the ref.
    await waitFor(() => {
      const s = lastWrite("footnotes.json") as FootnotesState | undefined;
      expect(s?.footnotes.find((f) => f.id === "fn-1")?.aiRequest).toBe(true);
    });

    // (2) bridged a unified-queue entry with the FROZEN footnote routing.
    await waitFor(() => {
      const q = lastWrite("ai-requests.json") as AiRequestsState | undefined;
      expect(q).toBeTruthy();
      expect(q!.requests).toHaveLength(1);
    });
    const req = (lastWrite("ai-requests.json") as AiRequestsState).requests[0];
    expect(req.kind).toBe("footnote");
    expect(req.status).toBe("pending");
    expect(req.linkedTo).toEqual({ panel: "footnotes", cardId: "fn-1" });
    // The request text is a plain-text summary of the footnote body.
    expect(req.text).toContain("a note body");
  });

  it("setFootnoteAiRequest(false) drops the bridged request and clears the flag", async () => {
    beginDocPipeline(DOC);
    DISK["footnotes.json"] = {
      footnotes: [
        {
          id: "fn-2",
          aiRequest: true,
          content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "body" }] }] },
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    } satisfies FootnotesState;
    // Pre-existing bridged request linked to fn-2.
    DISK["ai-requests.json"] = {
      requests: [
        {
          id: "req-1",
          kind: "footnote",
          text: "body",
          createdAt: "2026-01-01T00:00:00.000Z",
          status: "pending",
          linkedTo: { panel: "footnotes", cardId: "fn-2" },
        },
      ],
    } satisfies AiRequestsState;

    const { result } = renderHook(() => useFootnotes(DOC));
    await waitFor(() => expect(result.current.footnoteRefs).toHaveLength(1));

    await act(async () => {
      result.current.setFootnoteAiRequest("fn-2", false);
    });

    await waitFor(() => {
      const s = lastWrite("footnotes.json") as FootnotesState | undefined;
      expect(s?.footnotes.find((f) => f.id === "fn-2")?.aiRequest).toBe(false);
    });
    await waitFor(() => {
      const q = lastWrite("ai-requests.json") as AiRequestsState | undefined;
      expect(q!.requests).toHaveLength(0);
    });
  });

  it("the aiRequest flag survives syncFromEditor (an in-text edit re-sync)", async () => {
    beginDocPipeline(DOC);
    DISK["footnotes.json"] = {
      footnotes: [
        {
          id: "fn-3",
          aiRequest: true,
          content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "old" }] }] },
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    } satisfies FootnotesState;

    const { result } = renderHook(() => useFootnotes(DOC));
    await waitFor(() => expect(result.current.footnoteRefs).toHaveLength(1));

    await act(async () => {
      result.current.syncFromEditor([
        {
          footnoteId: "fn-3",
          content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "edited" }] }] },
        },
      ]);
    });

    // syncFromEditor spreads `...existing`, so the flag must ride along.
    const ref = result.current.footnoteRefs.find((f) => f.id === "fn-3");
    expect(ref?.aiRequest).toBe(true);
  });
});
