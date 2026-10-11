import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  runCardLifecycleEvent,
  type CardLifecycleDeps,
} from "../lifecycle/run-event";
import { makeUnbridgingDelete } from "../lifecycle/unbridging-delete";
import type { AppliedSpliceOps } from "../lifecycle/applied-splice";
// Registers the morph converters + runs the boot assertions.
import "../morphs";

vi.mock("@/lib/ai-request-bridge", () => ({
  finalizeProposalRequest: vi.fn(async () => null),
}));

import {
  finalizeLeavingProposal,
  leavingProposalRequestId,
  LEAVING_PROPOSAL_RESULT,
} from "@/links/proposal-finalize";

/**
 * Task 1046 — the LEAVE half of task 1043's proposal-finalize rule. A proposal
 * (a suggestion carrying `aiOriginRequestId`) can end by being REMOVED — delete,
 * archive, a morph to a comment — and none of those is a status transition, so
 * `withProposalFinalize` never saw them and the Task stayed `in-progress`
 * forever. Pins:
 *
 *   (a) the rule — non-terminal proposal → its Task id; settled / human /
 *       non-suggestion → null; the result is "rejected";
 *   (b) the executor — delete and morph hand the ENDED record to
 *       `finalizeLeavingProposal` exactly once after the mutation; a declined
 *       event, a SETTLE that already finalized, or an event with no record does
 *       not;
 *   (c) the delete door threads the record through `resolveCard`;
 *   (d) the archive toggle in EditorPane applies the same rule (source scan —
 *       the toggle lives inside the pane).
 */

const proposal = (over: Record<string, unknown> = {}) => ({
  kind: "suggestion",
  id: "s1",
  status: "pending",
  aiOriginRequestId: "req-1",
  ...over,
});

describe("(a) leavingProposalRequestId — the leave rule", () => {
  it("names the Task of a non-terminal AI proposal", () => {
    expect(leavingProposalRequestId(proposal())).toBe("req-1");
    expect(leavingProposalRequestId(proposal({ status: "applied" }))).toBe("req-1");
    expect(leavingProposalRequestId(proposal({ status: "stale" }))).toBe("req-1");
  });
  it("ignores a settled proposal, a human suggestion and other kinds", () => {
    expect(leavingProposalRequestId(proposal({ status: "accepted" }))).toBeNull();
    expect(leavingProposalRequestId(proposal({ status: "rejected" }))).toBeNull();
    expect(leavingProposalRequestId(proposal({ aiOriginRequestId: undefined }))).toBeNull();
    expect(leavingProposalRequestId(proposal({ kind: "comment" }))).toBeNull();
    expect(leavingProposalRequestId(undefined)).toBeNull();
  });
  it("finalizes with 'rejected' (the source todo stays open)", () => {
    const onFinalize = vi.fn();
    finalizeLeavingProposal(proposal(), onFinalize);
    finalizeLeavingProposal(proposal({ status: "accepted" }), onFinalize);
    expect(LEAVING_PROPOSAL_RESULT).toBe("rejected");
    expect(onFinalize.mock.calls).toEqual([["req-1", "rejected", "left"]]);
  });
});

function deps(over: Partial<CardLifecycleDeps> = {}): {
  d: CardLifecycleDeps;
  finalize: ReturnType<typeof vi.fn>;
  order: string[];
} {
  const order: string[] = [];
  const finalize = vi.fn(() => {
    order.push("finalize");
  });
  return {
    d: {
      confirm: async () => true,
      unbridgeAiRequest: async () => {},
      signal: () => {
        order.push("signal");
      },
      mutate: () => {
        order.push("mutate");
      },
      finalizeLeavingProposal: finalize,
      ...over,
    },
    finalize,
    order,
  };
}

const spliceOps = (settle: boolean): AppliedSpliceOps =>
  ({
    get: () => ({ anchorId: "a", mode: "replace" }),
    ask: async () => (settle ? "keep" : null),
    settle: () => true,
  }) as unknown as AppliedSpliceOps;

describe("(b) the executor's FINALIZE step", () => {
  it("delete of a proposal finalizes once, after the mutation", async () => {
    const { d, finalize, order } = deps();
    const card = proposal();
    const ok = await runCardLifecycleEvent(
      { type: "delete", kind: "revision-suggestion", id: "s1", hasContent: false, card },
      d,
    );
    expect(ok).toBe(true);
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledWith(card);
    expect(order).toEqual(["mutate", "signal", "finalize"]);
  });

  it("morph of a pending proposal to a comment finalizes once", async () => {
    const { d, finalize } = deps();
    const card = proposal();
    const ok = await runCardLifecycleEvent(
      { type: "morph", fromKind: "revision-suggestion", id: "s1", card },
      d,
    );
    expect(ok).toBe(true);
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledWith(card);
  });

  it("an event with no record skips the step", async () => {
    const { d, finalize } = deps();
    await runCardLifecycleEvent(
      { type: "delete", kind: "cutter-suggestion", id: "s1", hasContent: false },
      d,
    );
    expect(finalize).not.toHaveBeenCalled();
  });

  it("a declined event does not finalize", async () => {
    const { d, finalize } = deps({ appliedSplice: spliceOps(false) });
    const ok = await runCardLifecycleEvent(
      { type: "delete", kind: "revision-suggestion", id: "s1", hasContent: false, card: proposal({ status: "applied" }) },
      d,
    );
    expect(ok).toBe(false);
    expect(finalize).not.toHaveBeenCalled();
  });

  it("a SETTLE that already resolved the status does not finalize a second time", async () => {
    const { d, finalize } = deps({ appliedSplice: spliceOps(true) });
    const ok = await runCardLifecycleEvent(
      { type: "delete", kind: "revision-suggestion", id: "s1", hasContent: false, card: proposal({ status: "applied" }) },
      d,
    );
    expect(ok).toBe(true);
    expect(finalize).not.toHaveBeenCalled();
  });
});

describe("(c) the delete door threads the record", () => {
  it("makeUnbridgingDelete passes resolveCard's record to FINALIZE", async () => {
    const card = proposal();
    const finalize = vi.fn();
    const del = makeUnbridgingDelete({
      resolveKind: () => "cutter-suggestion",
      resolveCard: () => card,
      rawDelete: () => {},
      unbridge: () => {},
      signal: () => {},
      finalizeLeavingProposal: finalize,
    });
    expect(await del("s1")).toBe(true);
    expect(finalize).toHaveBeenCalledWith(card);
  });
});

describe("(d) EditorPane wires every app door to the one rule", () => {
  const src = readFileSync(
    join(process.cwd(), "src/components/EditorPane.tsx"),
    "utf8",
  );
  it("both suggestion-family delete doors pass resolveCard + the leave rule", () => {
    expect(src.match(/finalizeLeavingProposal: onProposalLeave/g)?.length).toBe(3);
    expect(src.match(/resolveCard: \(id\) =>/g)?.length).toBe(2);
  });
  it("the archive toggle applies the leave rule on the INTO-archived transition", () => {
    const body = src.slice(src.indexOf("const archiveCard = useCallback("));
    const block = body.slice(0, body.indexOf("setArchivedForKind(kind, id, !currentlyArchived)"));
    expect(block).toMatch(/if \(!currentlyArchived\) \{[\s\S]*onProposalLeave\(/);
  });
});
