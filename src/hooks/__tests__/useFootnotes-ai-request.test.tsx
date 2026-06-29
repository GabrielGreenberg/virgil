// @vitest-environment jsdom
//
// BUG #55 / #55b — footnotes join the per-card AI-request model, drainably.
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
// #55b — the bridged request must be DRAINABLE, not just well-shaped: it must
// carry the footnote's anchoring `paragraphIds` (the drain skill HALTS on empty
// paragraphIds), threaded from the owner's anchor resolver (EditorPane resolves
// the `\footnote` atom's enclosing paragraph). A footnote's anchor isn't in the
// sidecar, so without the resolver the request is filed unactionable.
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
import { richJsonToPlainText } from "@/lib/footnote-content";
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

    // #55b: a resolver supplies the footnote's anchoring paragraph (the
    // analogue of EditorPane resolving the `\footnote` atom position).
    const resolveAnchor = vi.fn((id: string) =>
      id === "fn-1"
        ? { paragraphIds: ["para-uuid-9"], selectedText: "the host sentence" }
        : {},
    );
    const { result } = renderHook(() => useFootnotes(DOC, undefined, resolveAnchor));
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
    // #55b: DRAINABLE — the resolver-supplied anchor rides the bridged request.
    expect(resolveAnchor).toHaveBeenCalledWith("fn-1");
    expect(req.paragraphIds).toEqual(["para-uuid-9"]);
    expect(req.selectedText).toBe("the host sentence");
  });

  it("#55b — a bridged footnote request is DRAINABLE end-to-end (carries paragraphIds the skill needs)", async () => {
    // The previous test pins the shape; this one pins FULFILLABILITY: the
    // bridged entry must satisfy the draft-footnote step-0 gate, i.e. a
    // non-empty paragraphIds (the skill HALTS otherwise). Asserting the wire
    // shape alone (kind/linkedTo/status) is NOT enough — that's the broken
    // contract #55b corrected.
    beginDocPipeline(DOC);
    DISK["footnotes.json"] = {
      footnotes: [
        {
          id: "fn-drain",
          content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "needs expanding" }] }] },
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    } satisfies FootnotesState;

    const resolveAnchor = vi.fn(() => ({ paragraphIds: ["6607"] }));
    const { result } = renderHook(() => useFootnotes(DOC, undefined, resolveAnchor));
    await waitFor(() => expect(result.current.footnoteRefs).toHaveLength(1));

    await act(async () => {
      result.current.setFootnoteAiRequest("fn-drain", true);
    });

    await waitFor(() => {
      const q = lastWrite("ai-requests.json") as AiRequestsState | undefined;
      expect(q?.requests).toHaveLength(1);
    });
    const req = (lastWrite("ai-requests.json") as AiRequestsState).requests[0];
    // The drain-gate predicate: open status + a footnote linkedTo + a non-empty
    // anchor. This is exactly what /editor/draft-footnote step 0 checks before
    // routing to the act-on-existing (edit-card) path; a request that passes it
    // is actionable, not a no-op file-and-halt.
    const drainable =
      req.kind === "footnote" &&
      req.status !== "complete" &&
      req.status !== "failed" &&
      req.linkedTo?.panel === "footnotes" &&
      req.linkedTo?.cardId === "fn-drain" &&
      Array.isArray(req.paragraphIds) &&
      req.paragraphIds.length > 0;
    expect(drainable).toBe(true);
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

// task_9768c44e — the footnotes.json sidecar `content` is a MIRROR of the editor
// node body. The edit path (EditorPane.handleEditFootnote) updates the node and
// then calls `useFootnotes.updateFootnoteContent` to keep the mirror coherent.
// Without that call the sidecar held creation-time (often empty) text, and the
// one active consumer — the AI-request inbox summary in `setFootnoteAiRequest` —
// bridged a stale/empty preview. These pin: (1) the edit reaches the sidecar and
// flows into a subsequently-bridged request; (2) the edit does NOT clear pristine
// (a still-empty footnote must stay click-away-discardable — the predecessor
// pristine fix's invariant).
function makePristineStub() {
  return {
    markNew: vi.fn(),
    markDirty: vi.fn(),
    isPristine: vi.fn(() => false),
    registerDiscard: vi.fn(() => () => {}),
    discardAll: vi.fn(),
  };
}

describe("useFootnotes — sidecar content stays coherent on edit (task_9768c44e)", () => {
  it("updateFootnoteContent persists the edited body so a later AI-request summary reflects it (not stale seed text)", async () => {
    beginDocPipeline(DOC);
    // Seed the creation-time body — the stale value the bug used to bridge.
    DISK["footnotes.json"] = {
      footnotes: [
        {
          id: "fn-edit",
          content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "stale seed" }] }] },
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    } satisfies FootnotesState;

    const resolveAnchor = vi.fn(() => ({ paragraphIds: ["para-7"] }));
    const { result } = renderHook(() => useFootnotes(DOC, undefined, resolveAnchor));
    await waitFor(() => expect(result.current.footnoteRefs).toHaveLength(1));

    // The user edits the footnote body (EditorPane routes this through the hook).
    await act(async () => {
      result.current.updateFootnoteContent("fn-edit", {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "the edited footnote body" }] }],
      });
    });

    // (1) the sidecar mirror now holds the edited body.
    await waitFor(() => {
      const s = lastWrite("footnotes.json") as FootnotesState | undefined;
      const ref = s?.footnotes.find((f) => f.id === "fn-edit");
      expect(richJsonToPlainText(ref?.content ?? {})).toContain("the edited footnote body");
    });

    // (2) a subsequently-bridged AI request carries the FRESH summary, never the seed.
    await act(async () => {
      result.current.setFootnoteAiRequest("fn-edit", true);
    });
    await waitFor(() => {
      const q = lastWrite("ai-requests.json") as AiRequestsState | undefined;
      expect(q?.requests).toHaveLength(1);
    });
    const req = (lastWrite("ai-requests.json") as AiRequestsState).requests[0];
    expect(req.text).toContain("the edited footnote body");
    expect(req.text).not.toContain("stale seed");
  });

  it("setArchived(true) flags archived + unanchored (bug sweep #3, mirror of citations)", async () => {
    beginDocPipeline(DOC);
    DISK["footnotes.json"] = {
      footnotes: [
        {
          id: "fn-arch",
          content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "keep me" }] }] },
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    } satisfies FootnotesState;

    const { result } = renderHook(() => useFootnotes(DOC));
    await waitFor(() => expect(result.current.footnoteRefs).toHaveLength(1));

    // Archive: BOTH flags so the atomless ref survives syncFromEditor and lists
    // under the panel's Archives view.
    await act(async () => {
      result.current.setArchived("fn-arch", true);
    });
    {
      const ref = result.current.footnoteRefs.find((f) => f.id === "fn-arch");
      expect(ref?.archived).toBe(true);
      expect(ref?.unanchored).toBe(true);
    }

    // The archived (atomless) ref survives a re-sync that doesn't include it.
    await act(async () => {
      result.current.syncFromEditor([]); // editor has no footnote atoms
    });
    {
      const ref = result.current.footnoteRefs.find((f) => f.id === "fn-arch");
      expect(ref?.archived).toBe(true);
      expect(ref?.unanchored).toBe(true);
      expect(richJsonToPlainText(ref?.content ?? {})).toContain("keep me");
    }

    // Unarchive: clears `archived` but leaves `unanchored` (atom NOT re-inserted;
    // the card returns re-placeable).
    await act(async () => {
      result.current.setArchived("fn-arch", false);
    });
    {
      const ref = result.current.footnoteRefs.find((f) => f.id === "fn-arch");
      expect(ref?.archived).toBe(false);
      expect(ref?.unanchored).toBe(true);
    }
  });

  it("updateFootnoteContent does NOT clear pristine (a still-empty footnote stays discardable)", async () => {
    beginDocPipeline(DOC);
    DISK["footnotes.json"] = {
      footnotes: [
        {
          id: "fn-blank",
          content: { type: "doc", content: [{ type: "paragraph" }] },
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    } satisfies FootnotesState;

    const pristine = makePristineStub();
    const { result } = renderHook(() => useFootnotes(DOC, pristine));
    await waitFor(() => expect(result.current.footnoteRefs).toHaveLength(1));

    // An edit that leaves the body empty must not mark the footnote dirty —
    // the caller (handleEditFootnote) owns that decision, gated on cardHasContent.
    await act(async () => {
      result.current.updateFootnoteContent("fn-blank", {
        type: "doc",
        content: [{ type: "paragraph" }],
      });
    });
    expect(pristine.markDirty).not.toHaveBeenCalled();

    // Contrast: delete DOES clear pristine — pins that the hook still wires
    // pristine where it should, so the above is a deliberate exemption.
    await act(async () => {
      result.current.deleteFootnote("fn-blank");
    });
    expect(pristine.markDirty).toHaveBeenCalledWith("fn-blank");
  });
});
