/**
 * Task 1043 — PROPOSAL FINALIZE. Accepting / rejecting an AI proposal in the
 * editor finalizes the Task it answers (`aiOriginRequestId`) the way the
 * script-side `cmd_accept` / `cmd_reject` do, and an ACCEPT closes the todo the
 * proposal answered. Pins:
 *
 *   (a) the transition rule — only a non-terminal → accepted|rejected step ends
 *       a proposal;
 *   (b) the hook wrapper — every `setSuggestionStatus` caller (revision AND
 *       cutter family) finalizes on that step, a human card never does;
 *   (c) the bridge leg — the row goes `complete` + `accepted|rejected`, an
 *       already-terminal row writes nothing;
 *   (d) the source closure — accept closes a todo-linked Task's todo, reject
 *       leaves it open;
 *   (e) a census — `aiOriginRequestId` has a non-test READER in `src/` (a
 *       registry earns its name by being read): the field the skills stamp is
 *       no longer write-only on the app side.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { trackedFiles } from "@/lib/__tests__/_source-scan";
import type { AiRequest, AiRequestsState } from "@/lib/types";

const seeded: { state: AiRequestsState } = { state: { requests: [] } };
const written: AiRequestsState[] = [];
vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(async () => seeded.state),
  writeSidecar: vi.fn(async () => {}),
  mutateSidecar: vi.fn(
    async (
      _handle: unknown,
      _file: string,
      _defaultValue: unknown,
      mutate: (current: AiRequestsState) => AiRequestsState | null,
    ) => {
      const next = mutate(seeded.state);
      if (next === null) return null;
      seeded.state = next;
      written.push(next);
      return next;
    },
  ),
}));
vi.mock("@/lib/multi-window/doc-pipeline", () => ({
  getActiveHandle: vi.fn(() => ({})),
  isStalePipelineError: vi.fn(() => false),
}));

import {
  finalizeProposal,
  proposalFinalizeResult,
  withProposalFinalize,
} from "@/links/proposal-finalize";
import { finalizeProposalRequest } from "@/lib/ai-request-bridge";

const answeredL3 = (id: string, linkedTo?: AiRequest["linkedTo"]): AiRequest => ({
  id,
  kind: "suggestion",
  text: "tighten this",
  createdAt: "2026-10-10T00:00:00.000Z",
  status: "in-progress",
  resultId: "sug-1",
  ...(linkedTo ? { linkedTo } : {}),
});

beforeEach(() => {
  seeded.state = { requests: [] };
  written.length = 0;
});

describe("(a) proposalFinalizeResult — which status steps END a proposal", () => {
  it.each([
    ["pending", "accepted", "accepted"],
    ["pending", "rejected", "rejected"],
    ["applied", "accepted", "accepted"], // flag-ON Keep
    ["applied", "rejected", "rejected"], // flag-ON Dismiss
    ["stale", "rejected", "rejected"], // the stale card's Dismiss
    [undefined, "accepted", "accepted"],
  ])("%s → %s finalizes as %s", (prev, next, want) => {
    expect(proposalFinalizeResult(prev, next)).toBe(want);
  });
  it.each([
    ["pending", "applied"],
    ["pending", "stale"],
    ["accepted", "accepted"],
    ["rejected", "rejected"],
    ["accepted", "rejected"],
  ])("%s → %s does not", (prev, next) => {
    expect(proposalFinalizeResult(prev, next)).toBeNull();
  });
});

describe("(b) withProposalFinalize — the status setter IS the seam", () => {
  const mkHook = (cards: unknown[]) => {
    const inner = vi.fn();
    return { hook: { cards, setSuggestionStatus: inner, other: 1 }, inner };
  };

  it.each(["revision-suggestion", "cutter-suggestion"])(
    "%s: accept / reject on an AI proposal finalize its Task",
    () => {
      const { hook, inner } = mkHook([
        { kind: "suggestion", id: "s1", status: "pending", aiOriginRequestId: "req-1" },
        { kind: "suggestion", id: "s2", status: "applied", aiOriginRequestId: "req-2" },
      ]);
      const onFinalize = vi.fn();
      const wrapped = withProposalFinalize(hook, onFinalize);
      expect(wrapped.other).toBe(1); // the rest of the hook rides through
      wrapped.setSuggestionStatus("s1", "accepted" as never);
      wrapped.setSuggestionStatus("s2", "rejected" as never);
      expect(inner).toHaveBeenCalledWith("s1", "accepted");
      expect(inner).toHaveBeenCalledWith("s2", "rejected");
      expect(onFinalize.mock.calls).toEqual([
        ["req-1", "accepted"],
        ["req-2", "rejected"],
      ]);
    },
  );

  it("a non-terminal step, a human card, a comment, and a re-set never finalize", () => {
    const { hook, inner } = mkHook([
      { kind: "suggestion", id: "ai", status: "pending", aiOriginRequestId: "req-1" },
      { kind: "suggestion", id: "human", status: "pending" },
      { kind: "comment", id: "c", status: "pending", aiOriginRequestId: "req-3" },
      { kind: "suggestion", id: "done", status: "accepted", aiOriginRequestId: "req-4" },
    ]);
    const onFinalize = vi.fn();
    const wrapped = withProposalFinalize(hook, onFinalize);
    wrapped.setSuggestionStatus("ai", "applied" as never);
    wrapped.setSuggestionStatus("human", "accepted" as never);
    wrapped.setSuggestionStatus("c", "accepted" as never);
    wrapped.setSuggestionStatus("done", "accepted" as never);
    expect(inner).toHaveBeenCalledTimes(4); // the status write itself always lands
    expect(onFinalize).not.toHaveBeenCalled();
  });
});

describe("(c) finalizeProposalRequest — the cmd_accept / cmd_reject terminal shape", () => {
  it("closes the answered-L3 row complete + accepted, returning its linkedTo", async () => {
    const link = { panel: "revisions" as const, cardId: "comment-1" };
    seeded.state = { requests: [answeredL3("req-1", link), answeredL3("req-other")] };
    const got = await finalizeProposalRequest("doc", "req-1", "accepted");
    expect(got).toEqual(link);
    const [row, other] = seeded.state.requests;
    expect(row.status).toBe("complete");
    expect(row.result).toBe("accepted");
    expect(other.status).toBe("in-progress"); // matched by ID, nothing else touched
  });

  it("rejected → complete + rejected", async () => {
    seeded.state = { requests: [answeredL3("req-1")] };
    await finalizeProposalRequest("doc", "req-1", "rejected");
    expect(seeded.state.requests[0]).toMatchObject({ status: "complete", result: "rejected" });
  });

  it("an already-terminal or unknown row writes nothing", async () => {
    seeded.state = {
      requests: [{ ...answeredL3("req-1"), status: "complete", result: "accepted" }],
    };
    expect(await finalizeProposalRequest("doc", "req-1", "rejected")).toBeNull();
    expect(await finalizeProposalRequest("doc", "nope", "accepted")).toBeNull();
    expect(written).toHaveLength(0);
    expect(seeded.state.requests[0].result).toBe("accepted");
  });
});

describe("(d) finalizeProposal — the source todo closes on ACCEPT only", () => {
  const todoLink = { panel: "todos" as const, cardId: "todo-1" };

  it("accept closes the todo the proposal answered", async () => {
    seeded.state = { requests: [answeredL3("req-1", todoLink)] };
    const closeTodo = vi.fn();
    await finalizeProposal("doc", "req-1", "accepted", closeTodo);
    expect(closeTodo).toHaveBeenCalledWith("todo-1");
  });

  it("reject leaves the todo open", async () => {
    seeded.state = { requests: [answeredL3("req-1", todoLink)] };
    const closeTodo = vi.fn();
    await finalizeProposal("doc", "req-1", "rejected", closeTodo);
    expect(closeTodo).not.toHaveBeenCalled();
    expect(seeded.state.requests[0]).toMatchObject({ status: "complete", result: "rejected" });
  });

  it("a non-todo source, or a row the script side already closed, closes nothing", async () => {
    seeded.state = {
      requests: [
        answeredL3("req-1", { panel: "revisions", cardId: "c1" }),
        { ...answeredL3("req-2", todoLink), status: "complete", result: "accepted" },
      ],
    };
    const closeTodo = vi.fn();
    await finalizeProposal("doc", "req-1", "accepted", closeTodo);
    await finalizeProposal("doc", "req-2", "accepted", closeTodo);
    expect(closeTodo).not.toHaveBeenCalled();
  });
});

describe("(e) CENSUS — aiOriginRequestId is read by the app", () => {
  it("has at least one non-test, non-type reader in src/", () => {
    const typesFile = join("src", "lib", "types.ts");
    const readers = trackedFiles("src", /\.tsx?$/).filter(
      (p) =>
        !p.includes(`${join("__tests__")}/`) &&
        !/\.test\.tsx?$/.test(p) &&
        !p.endsWith(typesFile) && // a declaration is not a reader
        readFileSync(p, "utf8").includes("aiOriginRequestId"),
    );
    expect(readers.length).toBeGreaterThan(0);
  });
});
