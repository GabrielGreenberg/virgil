// @vitest-environment jsdom
//
// **A sidecar write that did not land is rolled back and SAID** — task 630.
//
// Filing an AI request is optimistic: React state moves first and the disk
// write is fire-and-forget. That is fine while the write lands. It was never
// reconciled when it did NOT — and `mutateAiRequests` answered a single `null`
// for five different outcomes, so no caller could tell a mutator that declined
// (nothing to change) from a write that was refused (nothing reached disk and
// nothing will). The user got a row in the Open bucket, a lit inbox dot, a
// sidecar unchanged on disk, no skill that would ever serve it, and no
// explanation when it vanished on the next reload. The same swallow sat in the
// bib-review twin and in the card-flag bridge: three writers, three
// `console.error`s, one channel that reaches nobody.
//
// The legs here are the three the defect turns on:
//
//   1. REFUSED (no write handle / a host that refuses the file) → the phantom
//      row is reconciled off the screen AND the user is told.
//   2. FAILED (the write threw) → same, with the error's own words.
//   3. STALE (the doc switched under the write) → SILENT and NOT rolled back:
//      the new owner is authoritative and this window is about to be replaced,
//      so a notice here would be about a paper the user has already left.
//
// Plus the presentation half: the refusal reaches the user through the ONE band
// every other interrupted-document state speaks from, it yields to every `.tex`
// state, and "OK, got it" is the whole door.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { AiRequest, AiRequestsState, BibReviewState } from "@/lib/types";

// ---------------------------------------------------------------------------
// A storage backend we can refuse or fail on demand.
// ---------------------------------------------------------------------------
const DISK: { requests: AiRequest[] } = { requests: [] };
/** How the next sidecar write behaves. `"ok"` writes; `"refused"` is the shape
 *  a host that will not take the file has — `mutateSidecar` resolves `null`
 *  WITHOUT ever running the mutator; `"throw"` is a real write failure. */
const mode: { value: "ok" | "refused" | "throw" } = { value: "ok" };
const writeError = new Error("The requested file could not be written");

vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(async (_docId: string, _file: string, dflt: unknown) =>
    _file === "ai-requests.json" ? { requests: [...DISK.requests] } : dflt,
  ),
  writeSidecar: vi.fn(async () => {
    if (mode.value === "throw") throw writeError;
  }),
  mutateSidecar: vi.fn(
    async (
      _h: unknown,
      _file: string,
      _dflt: unknown,
      mutate: (current: AiRequestsState) => AiRequestsState | null,
    ) => {
      if (mode.value === "refused") return null; // the mutator never runs
      if (mode.value === "throw") throw writeError;
      const next = mutate({ requests: [...DISK.requests] });
      if (next === null) return null;
      DISK.requests = next.requests;
      return next;
    },
  ),
}));

const pipeline: { handle: { docId: string } | null; stale: boolean } = {
  handle: { docId: "doc-630" },
  stale: false,
};
vi.mock("@/lib/multi-window/doc-pipeline", () => ({
  getActiveHandle: vi.fn(() => pipeline.handle),
  isStalePipelineError: vi.fn(() => pipeline.stale),
}));

import { useAiRequests } from "@/hooks/useAiRequests";
import { useBibReview } from "@/hooks/useBibReview";
import { bridgeCardAiRequestFlag } from "@/lib/ai-request-bridge";
import { mutateAiRequests } from "@/lib/ai-requests-store";
import {
  clearSidecarRefusal,
  getSidecarRefusal,
  recordSidecarRefusal,
  resetSidecarRefusals,
  type SidecarRefusal,
} from "@/lib/sidecar-refusal";
import {
  deriveDocumentInterruption,
  type InterruptionInputs,
} from "@/lib/document-interruption";
import type { PreservationNotice } from "@/lib/preservation-notice";
import type { SaveStateView } from "@/lib/save-state";
import type { ExternalChangeState } from "@/lib/disk-watcher";

const DOC = "doc-630";

async function settle(ms = 40): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

beforeEach(() => {
  DISK.requests = [];
  mode.value = "ok";
  pipeline.handle = { docId: DOC };
  pipeline.stale = false;
  resetSidecarRefusals();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

/* ── 1. The inbox: refused / failed / stale ─────────────────────────── */

describe("useAiRequests reconciles a write that did not land", () => {
  it("REFUSED (no write handle): no phantom row survives, and the user is told", async () => {
    pipeline.handle = null;
    const { result } = renderHook(() => useAiRequests(DOC));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.addRequest("note", "please look at this");
    });
    // The optimism itself is intact — the point is that it is TAKEN BACK.
    expect(result.current.requests).toHaveLength(1);
    await settle();

    expect(DISK.requests).toHaveLength(0);
    expect(result.current.requests).toHaveLength(0);
    const refusal = getSidecarRefusal(DOC);
    expect(refusal?.reason).toBe("no-handle");
    expect(refusal?.what).toBe("AI request");
  });

  it("REFUSED (the host will not take the file): same — reconciled and said", async () => {
    mode.value = "refused";
    const { result } = renderHook(() => useAiRequests(DOC));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.addRequest("note", "on a read-only paper");
    });
    await settle();

    expect(DISK.requests).toHaveLength(0);
    expect(result.current.requests).toHaveLength(0);
    expect(getSidecarRefusal(DOC)?.reason).toBe("read-only");
  });

  it("FAILED (the write threw): reconciled, and the refusal carries the error's own words", async () => {
    mode.value = "throw";
    const { result } = renderHook(() => useAiRequests(DOC));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.addRequest("note", "quota gone");
    });
    await settle();

    expect(result.current.requests).toHaveLength(0);
    const refusal = getSidecarRefusal(DOC);
    expect(refusal?.reason).toBe("failed");
    expect(refusal?.detail).toBe(writeError.message);
  });

  it("STALE (the doc switched under the write): silent, and NOT rolled back", async () => {
    const { result } = renderHook(() => useAiRequests(DOC));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    mode.value = "throw";
    pipeline.stale = true;
    act(() => {
      result.current.addRequest("note", "mid-swap");
    });
    await settle();

    // No notice — the new owner is authoritative, and a banner about a paper
    // the user has already left is a lie, not a warning.
    expect(getSidecarRefusal(DOC)).toBeNull();
    // And no reconcile: nothing re-read this window's state out from under it.
    expect(result.current.requests).toHaveLength(1);
  });

  it("a DECLINED mutator is not a refusal — nothing said, nothing re-read", async () => {
    const { result } = renderHook(() => useAiRequests(DOC));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      // No row with this id, so the mutator returns `null`.
      result.current.updateRequestText("not-here", "edit");
    });
    await settle();

    expect(getSidecarRefusal(DOC)).toBeNull();
  });

  it("a write that LANDS says nothing", async () => {
    const { result } = renderHook(() => useAiRequests(DOC));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.addRequest("note", "this one is fine");
    });
    await settle();

    expect(DISK.requests).toHaveLength(1);
    expect(result.current.requests).toHaveLength(1);
    expect(getSidecarRefusal(DOC)).toBeNull();
  });
});

/* ── 2. The store's report is discriminated, not a sentinel ─────────── */

describe("mutateAiRequests reports WHICH outcome", () => {
  it("tells a declined mutator apart from a host that refused the file", async () => {
    expect(await mutateAiRequests(DOC, () => null)).toEqual({ kind: "declined" });
    mode.value = "refused";
    expect(await mutateAiRequests(DOC, (r) => [...r])).toEqual({ kind: "read-only" });
  });

  it("reports stale and failed as different things", async () => {
    mode.value = "throw";
    pipeline.stale = true;
    expect(await mutateAiRequests(DOC, (r) => [...r])).toEqual({ kind: "stale" });
    pipeline.stale = false;
    expect(await mutateAiRequests(DOC, (r) => [...r])).toEqual({
      kind: "failed",
      error: writeError,
    });
  });
});

/* ── 3. The other two writers on the same channel ───────────────────── */

describe("the same channel carries the other sidecar writers", () => {
  it("a card-flag bridge whose write is refused says so", async () => {
    mode.value = "refused";
    await bridgeCardAiRequestFlag(DOC, "todo", "card-1", true, { text: "do it" }, "toggle");
    expect(getSidecarRefusal(DOC)?.reason).toBe("read-only");
    expect(getSidecarRefusal(DOC)?.what).toBe("request for Virgil");
  });

  it("a bib review filed with no write handle says so, in its own noun", async () => {
    pipeline.handle = null;
    const { result } = renderHook(() => useBibReview(DOC));
    await settle();
    act(() => {
      result.current.requestReview("smith2020", "fields");
    });
    await settle();
    const refusal = getSidecarRefusal(DOC);
    expect(refusal?.reason).toBe("no-handle");
    expect(refusal?.what).toBe("bibliography review");
  });
});

/* ── 4. The channel itself ──────────────────────────────────────────── */

describe("the sidecar-refusal store", () => {
  it("keeps the FIRST refusal's clock and counts the rest", () => {
    recordSidecarRefusal({ docId: DOC, what: "AI request", reason: "read-only", now: 1000 });
    recordSidecarRefusal({ docId: DOC, what: "AI request", reason: "read-only", now: 9000 });
    const r = getSidecarRefusal(DOC)!;
    expect(r.at).toBe(1000);
    expect(r.refusals).toBe(2);
  });

  it("acknowledging clears it, and only for that doc", () => {
    recordSidecarRefusal({ docId: DOC, what: "AI request", reason: "failed" });
    recordSidecarRefusal({ docId: "other", what: "AI request", reason: "failed" });
    clearSidecarRefusal(DOC);
    expect(getSidecarRefusal(DOC)).toBeNull();
    expect(getSidecarRefusal("other")).not.toBeNull();
  });
});

/* ── 5. The presentation — one band, one voice ──────────────────────── */

const CLEAN_EXTERNAL: ExternalChangeState = {
  changes: [],
  severity: null,
  detectedAt: null,
  paused: false,
};
function save(over: Partial<SaveStateView> = {}): SaveStateView {
  return { tier: "clean", ageMs: 0, reason: null, lastLandedAt: null, escalated: false, ...over };
}
function refusal(over: Partial<SidecarRefusal> = {}): SidecarRefusal {
  return {
    docId: DOC,
    what: "AI request",
    reason: "read-only",
    at: 1000,
    refusals: 1,
    ...over,
  };
}
function inputs(over: Partial<InterruptionInputs> = {}): InterruptionInputs {
  return {
    docId: DOC,
    pen: null,
    penLastReleasedAt: null,
    external: CLEAN_EXTERNAL,
    preservation: null,
    sidecarRefusal: null,
    save: save(),
    now: 5000,
    ...over,
  };
}

describe("the band presents a sidecar refusal", () => {
  it("names what the user filed, in plain words, with ONE action", () => {
    const view = deriveDocumentInterruption(inputs({ sidecarRefusal: refusal() }))!;
    expect(view.kind).toBe("sidecar-refused");
    expect(view.tone).toBe("danger");
    expect(view.title).toContain("AI request");
    expect(view.body).toContain("reading only");
    expect(view.recommended?.id).toBe("acknowledge");
    expect(view.alternatives).toEqual([]);
    // No technical vocabulary reaches the user.
    expect(view.body).not.toMatch(/sidecar|json|handle|mutate/i);
  });

  it("puts the failed write's own words in the sentence", () => {
    const view = deriveDocumentInterruption(
      inputs({ sidecarRefusal: refusal({ reason: "failed", detail: "quota exceeded" }) }),
    )!;
    expect(view.body).toContain("quota exceeded");
  });

  it("YIELDS to every state about the .tex — the paper outranks the apparatus", () => {
    const notice: PreservationNotice = {
      docId: DOC, source: "load", region: "body", before: 400, after: 120,
      lost: 280, allowed: 4, at: 1000, refusals: 1, acknowledged: false,
    };
    expect(
      deriveDocumentInterruption(
        inputs({ sidecarRefusal: refusal(), preservation: notice }),
      )?.kind,
    ).toBe("preservation");
    expect(
      deriveDocumentInterruption(
        inputs({ sidecarRefusal: refusal(), save: save({ tier: "blocked", reason: "error" }) }),
      )?.kind,
    ).toBe("save-error");
  });

  it("is nothing at all when no write was refused", () => {
    expect(deriveDocumentInterruption(inputs())).toBeNull();
  });
});
