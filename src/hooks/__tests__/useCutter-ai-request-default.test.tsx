// @vitest-environment jsdom
//
// task 2026-07-03-016 (6b) — a comment/request is an AI request BY DEFAULT, and
// the default reaches the unified `ai-requests.json` inbox WITHOUT a manual
// checkbox toggle. The bridge follows the same pristine gate as sidecar
// persistence, so:
//
//   - a comment created WITH content is committed at birth → bridged now;
//   - an empty pristine comment is NOT bridged until it first commits (a body
//     edit) — a click-away discard therefore leaves no orphan inbox entry;
//   - the bridged entry carries the FROZEN cutter routing (wire kind
//     "suggestion", linkedTo panel "cutter") so the drain finds it.
//
// useCutter is the representative kind here; useRevisions / useReports share the
// identical seam (bridgeComment / bridgeRequest).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { AiRequestsState, CutterState } from "@/lib/types";
import type { JSONContent } from "@tiptap/react";

const DISK: Record<string, unknown> = {};
const writes: Array<{ file: string; data: unknown }> = [];

vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(async (_docId: string, file: string, dflt: unknown) =>
    file in DISK ? DISK[file] : dflt,
  ),
  // usePersistentState reads through readSidecarIfExists (undefined when absent
  // → keep the in-memory default rather than overwrite).
  readSidecarIfExists: vi.fn(async (_docId: string, file: string) =>
    file in DISK ? DISK[file] : undefined,
  ),
  writeSidecar: vi.fn(async (_handle: unknown, file: string, data: unknown) => {
    DISK[file] = data;
    writes.push({ file, data });
  }),
  // The serialized read-modify-write door (task 220) the ai-requests authority
  // uses: read the in-memory disk INSIDE the write, apply, persist. `null` from
  // the mutator means nothing to change — no write, no recorded entry.
  mutateSidecar: vi.fn(
    async (
      _handle: unknown,
      file: string,
      dflt: unknown,
      mutate: (current: unknown) => unknown,
    ) => {
      const next = mutate(file in DISK ? DISK[file] : dflt);
      if (next === null) return null;
      DISK[file] = next;
      writes.push({ file, data: next });
      return next;
    },
  ),
}));

import { useCutter } from "../useCutter";
import {
  beginDocPipeline,
  __resetForTests,
} from "@/lib/multi-window/doc-pipeline";

const DOC = "doc-cutter-ai";

beforeEach(() => {
  __resetForTests();
  for (const k of Object.keys(DISK)) delete DISK[k];
  writes.length = 0;
});

function lastAiRequests(): AiRequestsState | undefined {
  return [...writes].reverse().find((w) => w.file === "ai-requests.json")
    ?.data as AiRequestsState | undefined;
}

const BODY: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "please cut this bit" }] }],
};

describe("useCutter — default-on-create AI request bridges to the inbox (6b)", () => {
  it("a comment created WITH content defaults aiRequest:true AND bridges immediately", async () => {
    beginDocPipeline(DOC);
    const { result } = renderHook(() => useCutter(DOC));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      result.current.addComment("para-uuid-1", BODY);
    });

    // The seeded comment carries the default flag on the sidecar card.
    await waitFor(() =>
      expect(
        (result.current.cards.find((c) => c.kind === "comment") as { aiRequest?: boolean } | undefined)
          ?.aiRequest,
      ).toBe(true),
    );

    // …and the bridge wrote a unified-queue entry with the FROZEN cutter routing.
    await waitFor(() => {
      const q = lastAiRequests();
      expect(q?.requests).toHaveLength(1);
    });
    const req = lastAiRequests()!.requests[0];
    expect(req.kind).toBe("suggestion"); // cutter-comment → wire kind "suggestion"
    expect(req.status).toBe("pending");
    expect(req.linkedTo).toEqual({ panel: "cutter", cardId: expect.any(String) });
    expect(req.paragraphIds).toEqual(["para-uuid-1"]);
    expect(req.text).toContain("please cut this bit");
  });

  it("an EMPTY pristine comment does NOT bridge until it first commits (no orphan on discard)", async () => {
    beginDocPipeline(DOC);
    const { result } = renderHook(() => useCutter(DOC));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    let newId = "";
    await act(async () => {
      newId = result.current.addComment("para-uuid-2").id; // no content → pristine
    });

    // Nothing bridged yet — an empty pristine comment is not in the inbox.
    expect(lastAiRequests()).toBeUndefined();

    // First body edit commits it → bridges the default flag now.
    await act(async () => {
      result.current.updateCommentContent(newId, BODY);
    });
    await waitFor(() => {
      const q = lastAiRequests();
      expect(q?.requests).toHaveLength(1);
    });
    const req = lastAiRequests()!.requests[0];
    expect(req.linkedTo).toEqual({ panel: "cutter", cardId: newId });
    expect(req.paragraphIds).toEqual(["para-uuid-2"]);
    expect(req.text).toContain("please cut this bit");
  });

  it("discarding an empty pristine comment leaves the inbox clean (never bridged)", async () => {
    beginDocPipeline(DOC);
    const { result } = renderHook(() => useCutter(DOC));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      result.current.addComment("para-uuid-3"); // empty pristine, never committed
    });
    await act(async () => {
      result.current.discardPristineCards();
    });

    // The card is gone and no `ai-requests.json` entry was ever written.
    expect(result.current.cards.find((c) => c.kind === "comment")).toBeUndefined();
    expect(lastAiRequests()).toBeUndefined();
  });
});
