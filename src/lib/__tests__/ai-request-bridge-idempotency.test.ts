/**
 * AI-bridge idempotency pins (test-hardening chip) — the duplicate-on-re-toggle
 * class on `bridgeCardAiRequestFlag` (src/lib/ai-request-bridge.ts):
 *
 *   (a) existingIdx refresh: re-toggling `value=true` on a card whose linked
 *       request is still OPEN must UPDATE that request in place (refresh the
 *       context fields, preserve id/createdAt/status) — never append a
 *       duplicate the skill inbox would double-serve.
 *   (b) `value=false` drops the open linked request (and no-ops with NO write
 *       when there is nothing to drop).
 *   (c) terminal-status re-file: when the linked request already reached a
 *       terminal status ("complete" / "failed"), a re-toggle files a NEW
 *       pending request rather than resurrecting the terminal one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AiRequest, AiRequestsState } from "@/lib/types";

// The bridge imports `@/lib/storage`, whose `require("@/lib/storage-fsa")`
// vitest's resolver can't alias (the known barrel/storage gotcha) — and the
// test must intercept sidecar I/O anyway: `seeded` is what readSidecar
// returns, `written` captures every writeSidecar payload.
const seeded: { state: AiRequestsState } = { state: { requests: [] } };
const written: { file: string; data: AiRequestsState }[] = [];
vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(async () => seeded.state),
  writeSidecar: vi.fn(async (_handle: unknown, file: string, data: unknown) => {
    written.push({ file, data: data as AiRequestsState });
  }),
}));
vi.mock("@/lib/multi-window/doc-pipeline", () => ({
  getActiveHandle: vi.fn(() => ({})),
  isStalePipelineError: vi.fn(() => false),
}));

import { bridgeCardAiRequestFlag } from "@/lib/ai-request-bridge";
import { isRequestOpen } from "@/lib/ai-request-open";

/** An on-disk request linked to the todo card `card-1` (registry routing for
 *  `todo` is { kind: "todo", linkPanel: "todos" } — pinned byte-for-byte by
 *  ai-request-routing-contract.test.ts). */
function linkedRequest(overrides: Partial<AiRequest> = {}): AiRequest {
  return {
    id: "req-existing",
    kind: "todo",
    text: "original text",
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "pending",
    linkedTo: { panel: "todos", cardId: "card-1" },
    paragraphIds: ["p-old"],
    selectedText: "old selection",
    ...overrides,
  };
}

beforeEach(() => {
  seeded.state = { requests: [] };
  written.length = 0;
});

describe("bridgeCardAiRequestFlag idempotency (re-toggle classes)", () => {
  it("(a) value=true on an OPEN linked request UPDATES in place — no duplicate", async () => {
    seeded.state = { requests: [linkedRequest()] };
    await bridgeCardAiRequestFlag("doc", "todo", "card-1", true, {
      text: "refreshed text",
      paragraphIds: ["p-new"],
      selectedText: "new selection",
    });

    expect(written).toHaveLength(1);
    const reqs = written[0].data.requests;
    expect(reqs).toHaveLength(1); // the duplicate-on-re-toggle class
    const r = reqs[0];
    // Same request, refreshed context:
    expect(r.id).toBe("req-existing");
    expect(r.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(r.status).toBe("pending");
    expect(r.text).toBe("refreshed text");
    expect(r.paragraphIds).toEqual(["p-new"]);
    expect(r.selectedText).toBe("new selection");
  });

  it("(a') empty/omitted context fields on re-toggle keep the existing values", async () => {
    seeded.state = { requests: [linkedRequest()] };
    // `text: ""` falls back to the old text; omitted paragraphIds /
    // selectedText (undefined) keep the stored ones via `??`.
    await bridgeCardAiRequestFlag("doc", "todo", "card-1", true, { text: "" });

    expect(written).toHaveLength(1);
    const r = written[0].data.requests[0];
    expect(r.text).toBe("original text");
    expect(r.paragraphIds).toEqual(["p-old"]);
    expect(r.selectedText).toBe("old selection");
  });

  it("(b) value=false drops the open linked request", async () => {
    seeded.state = {
      requests: [
        linkedRequest(),
        // An unrelated request must survive the drop untouched.
        linkedRequest({ id: "req-other", linkedTo: { panel: "todos", cardId: "card-2" } }),
      ],
    };
    await bridgeCardAiRequestFlag("doc", "todo", "card-1", false, { text: "" });

    expect(written).toHaveLength(1);
    expect(written[0].data.requests.map((r) => r.id)).toEqual(["req-other"]);
  });

  it("(b') value=false with no open linked request is a pure no-op (no write at all)", async () => {
    seeded.state = { requests: [linkedRequest({ status: "complete" })] };
    await bridgeCardAiRequestFlag("doc", "todo", "card-1", false, { text: "" });
    // Terminal requests are not "open" — nothing to drop, nothing written
    // (the terminal record is the skill's audit trail; value=false must not
    // erase it).
    expect(written).toHaveLength(0);
  });

  it("(c) terminal status 'complete': re-toggle files a NEW pending request, old survives", async () => {
    seeded.state = { requests: [linkedRequest({ status: "complete" })] };
    await bridgeCardAiRequestFlag("doc", "todo", "card-1", true, {
      text: "second ask",
      paragraphIds: ["p-2"],
    });

    expect(written).toHaveLength(1);
    const reqs = written[0].data.requests;
    expect(reqs).toHaveLength(2);
    // The terminal request is untouched (not resurrected):
    expect(reqs[0].id).toBe("req-existing");
    expect(reqs[0].status).toBe("complete");
    expect(reqs[0].text).toBe("original text");
    // The re-file is a fresh request:
    const fresh = reqs[1];
    expect(fresh.id).not.toBe("req-existing");
    expect(fresh.status).toBe("pending");
    expect(fresh.kind).toBe("todo");
    expect(fresh.text).toBe("second ask");
    expect(fresh.linkedTo).toEqual({ panel: "todos", cardId: "card-1" });
  });

  it("(c') terminal status 'failed' re-files too (both v1 terminal statuses)", async () => {
    seeded.state = { requests: [linkedRequest({ status: "failed" })] };
    await bridgeCardAiRequestFlag("doc", "todo", "card-1", true, { text: "retry" });

    expect(written).toHaveLength(1);
    const reqs = written[0].data.requests;
    expect(reqs).toHaveLength(2);
    expect(reqs[0].status).toBe("failed");
    expect(reqs[1].status).toBe("pending");
    expect(reqs[1].id).not.toBe("req-existing");
  });

  it("non-terminal non-pending statuses still count as OPEN (update, not re-file)", async () => {
    // The open-request match now delegates to `isRequestOpen` — e.g. a request
    // a skill already marked in-flight must not be duplicated by a re-toggle.
    seeded.state = { requests: [linkedRequest({ status: "submitted" as AiRequest["status"] })] };
    await bridgeCardAiRequestFlag("doc", "todo", "card-1", true, { text: "nudge" });

    expect(written).toHaveLength(1);
    const reqs = written[0].data.requests;
    expect(reqs).toHaveLength(1);
    expect(reqs[0].id).toBe("req-existing");
    expect(reqs[0].text).toBe("nudge");
  });

  // --- answered L3 proposal: `in-progress` + `resultId` (task 043) ---
  //
  // An L3 (safetyLevel 3 / propose) responder leaves its request `in-progress`
  // while stamping `resultId` the moment its proposal card lands, and clears the
  // source card's `aiRequest` flag in the same commit. The drain
  // (`list_requests.py`) treats such a row as ANSWERED (the user owns
  // accept/reject now). The bridge must agree, or the two drift: a re-request is
  // swallowed (M1) and a toggle-off orphans the proposal's `resultId` (M2).

  it("(d) in-progress+resultId, value=true files a FRESH pending request (drain sees it) — M1", async () => {
    seeded.state = {
      requests: [linkedRequest({ status: "in-progress", resultId: "card-proposal-1" })],
    };
    await bridgeCardAiRequestFlag("doc", "todo", "card-1", true, {
      text: "please try again",
      paragraphIds: ["p-2"],
    });

    expect(written).toHaveLength(1);
    const reqs = written[0].data.requests;
    expect(reqs).toHaveLength(2);
    // The answered proposal is untouched — its resultId pointer survives.
    expect(reqs[0].id).toBe("req-existing");
    expect(reqs[0].status).toBe("in-progress");
    expect(reqs[0].resultId).toBe("card-proposal-1");
    expect(reqs[0].text).toBe("original text");
    // The re-request is a fresh, drain-visible pending row.
    const fresh = reqs[1];
    expect(fresh.id).not.toBe("req-existing");
    expect(fresh.status).toBe("pending");
    expect(fresh.resultId).toBeUndefined();
    expect(fresh.text).toBe("please try again");
    expect(fresh.linkedTo).toEqual({ panel: "todos", cardId: "card-1" });
  });

  it("(e) in-progress+resultId, value=false is a pure no-op — resultId survives — M2", async () => {
    seeded.state = {
      requests: [linkedRequest({ status: "in-progress", resultId: "card-proposal-1" })],
    };
    await bridgeCardAiRequestFlag("doc", "todo", "card-1", false, { text: "" });
    // Answered ⇒ not open ⇒ nothing to drop ⇒ no write. The accept/reject flow
    // and the proposal card's origin pointer keep their `resultId`.
    expect(written).toHaveLength(0);
  });

  it("(f) in-progress WITHOUT resultId still counts as OPEN → update-in-place (no regression)", async () => {
    // A skill mid-flight (its proposal card hasn't landed yet) has no resultId,
    // so it is still open — a re-toggle updates in place, never duplicates.
    seeded.state = { requests: [linkedRequest({ status: "in-progress" })] };
    await bridgeCardAiRequestFlag("doc", "todo", "card-1", true, { text: "still working?" });

    expect(written).toHaveLength(1);
    const reqs = written[0].data.requests;
    expect(reqs).toHaveLength(1);
    expect(reqs[0].id).toBe("req-existing");
    expect(reqs[0].status).toBe("in-progress");
    expect(reqs[0].text).toBe("still working?");
  });
});

// --- archive terminate mode (task 093) -------------------------------------
//
// Archiving a flagged card routes the bridge in `mode: "terminate"` (via
// `clearAiRequestForKind` → the panel setters). Unlike a `value=false`
// toggle-off — which drops only an OPEN row and deliberately preserves an
// answered-L3 row's `resultId` (task 043) — terminate closes the FIRST linked
// NON-terminal row to `complete` REGARDLESS of current openness, because the
// card is gone. This is the UI twin of Python `close_linked_request(force=True)`
// on `cmd_archive`; both stamp `status: complete` + `result: "auto-applied"`.
describe("bridgeCardAiRequestFlag terminate mode (archive)", () => {
  it("(g) terminates a plain-OPEN pending row → complete, not a drop", async () => {
    seeded.state = { requests: [linkedRequest()] }; // status: "pending"
    await bridgeCardAiRequestFlag("doc", "todo", "card-1", false, { text: "" }, "terminate");

    expect(written).toHaveLength(1);
    const reqs = written[0].data.requests;
    expect(reqs).toHaveLength(1); // kept (terminated), not filtered out
    expect(reqs[0].id).toBe("req-existing");
    expect(reqs[0].status).toBe("complete");
    expect(reqs[0].result).toBe("auto-applied");
  });

  it("(h) terminates an answered-L3 row (in-progress+resultId) — the GAP the toggle-off can't close", async () => {
    seeded.state = {
      requests: [linkedRequest({ status: "in-progress", resultId: "card-proposal-1" })],
    };
    await bridgeCardAiRequestFlag("doc", "todo", "card-1", false, { text: "" }, "terminate");

    expect(written).toHaveLength(1);
    const r = written[0].data.requests[0];
    expect(r.status).toBe("complete");
    expect(r.result).toBe("auto-applied");
    // The proposal pointer survives the terminal stamp (audit trail intact).
    expect(r.resultId).toBe("card-proposal-1");
  });

  it("(i) an already-terminal linked row is a pure no-op (idempotent, no write)", async () => {
    seeded.state = { requests: [linkedRequest({ status: "complete", result: "accepted" })] };
    await bridgeCardAiRequestFlag("doc", "todo", "card-1", false, { text: "" }, "terminate");
    expect(written).toHaveLength(0);
  });

  it("(j) no linked row → no-op (no spurious terminal row minted)", async () => {
    seeded.state = {
      requests: [linkedRequest({ id: "req-other", linkedTo: { panel: "todos", cardId: "card-2" } })],
    };
    await bridgeCardAiRequestFlag("doc", "todo", "card-1", false, { text: "" }, "terminate");
    expect(written).toHaveLength(0);
  });

  it("(k) terminates ONLY the matched row; unrelated rows untouched", async () => {
    seeded.state = {
      requests: [
        linkedRequest(), // card-1, pending → terminated
        linkedRequest({ id: "req-other", linkedTo: { panel: "todos", cardId: "card-2" } }),
      ],
    };
    await bridgeCardAiRequestFlag("doc", "todo", "card-1", false, { text: "" }, "terminate");

    expect(written).toHaveLength(1);
    const reqs = written[0].data.requests;
    expect(reqs).toHaveLength(2);
    const mine = reqs.find((r) => r.id === "req-existing")!;
    const other = reqs.find((r) => r.id === "req-other")!;
    expect(mine.status).toBe("complete");
    expect(other.status).toBe("pending"); // untouched
  });

  // task 219 — the footnote DELETE leg. Deleting a flagged footnote
  // (`handleDeleteFootnote`) closes its linked row in the SAME terminate mode as
  // archive, keyed on the `footnotes` panel routing. This is the seventh
  // flag-bearing kind's leg (the other six ride `makeUnbridgingDelete`, pinned in
  // cards/__tests__/unbridging-delete.test.ts); footnote threads the bridge call
  // directly, so pin its terminate here where the storage mock lives.
  it("(l) terminates a footnote-linked open row → complete (task 219 delete leg)", async () => {
    seeded.state = {
      requests: [
        {
          id: "fn-req",
          kind: "footnote",
          text: "fn body",
          createdAt: "2026-01-01T00:00:00.000Z",
          status: "pending",
          linkedTo: { panel: "footnotes", cardId: "fn-1" },
          paragraphIds: ["p-1"],
        },
      ],
    };
    await bridgeCardAiRequestFlag("doc", "footnote", "fn-1", false, { text: "" }, "terminate");

    expect(written).toHaveLength(1);
    const reqs = written[0].data.requests;
    expect(reqs).toHaveLength(1); // kept as a terminal record, not dropped
    expect(reqs[0].id).toBe("fn-req");
    expect(reqs[0].status).toBe("complete");
    expect(reqs[0].result).toBe("auto-applied");
  });

  // task 253 — TWO non-terminal linked rows on the SAME card. A card can carry
  // both an answered-L3 row (`in-progress`+`resultId`, closed to the drain but
  // NOT terminal) and a fresh `pending` row filed by a re-toggle (task 043's
  // documented "re-toggle files a fresh request" path). Archive/delete means the
  // card is gone, so terminate must close BOTH — the old first-only `findIndex`
  // left the second `pending` row stranded and the drain re-served an archived
  // card. Distinct from case (k), which seeds two rows on DIFFERENT cards.
  it("(m) terminates BOTH non-terminal rows on one card (answered-L3 + fresh pending)", async () => {
    seeded.state = {
      requests: [
        // R1: answered-L3 — in-progress + resultId (not open, not terminal).
        linkedRequest({ id: "req-l3", status: "in-progress", resultId: "card-proposal-1" }),
        // R2: fresh pending filed by a re-toggle after R1 closed to the drain.
        linkedRequest({ id: "req-fresh", status: "pending" }),
      ],
    };
    await bridgeCardAiRequestFlag("doc", "todo", "card-1", false, { text: "" }, "terminate");

    expect(written).toHaveLength(1);
    const reqs = written[0].data.requests;
    expect(reqs).toHaveLength(2);
    // BOTH rows closed — no open linked row survives the archive.
    const l3 = reqs.find((r) => r.id === "req-l3")!;
    const fresh = reqs.find((r) => r.id === "req-fresh")!;
    expect(l3.status).toBe("complete");
    expect(l3.result).toBe("auto-applied");
    expect(l3.resultId).toBe("card-proposal-1"); // proposal pointer preserved
    expect(fresh.status).toBe("complete");
    expect(fresh.result).toBe("auto-applied");
    // No row remains that the drain would still consider open for card-1.
    expect(reqs.some((r) => r.linkedTo?.cardId === "card-1" && isRequestOpen(r))).toBe(false);
  });
});
