import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  runCardLifecycleEvent,
  type CardLifecycleDeps,
} from "../lifecycle/run-event";
import { CARD_REGISTRY } from "../card-registry";
import { CARD_KINDS } from "../predicates";
import type { CardKind } from "../types";

/**
 * T4 §3.4 — the lifecycle unbridge. A morph that DROPS the aiRequest flag
 * (report-request→report), or a DELETE of an aiRequest-bearing kind, must clear
 * the pending `ai-requests.json` entry in the same logical step — so a phantom
 * inbox entry never strands (REP-F5-01 / REP-F6-01 / REP-F7-02 / REP-F8-01 /
 * OMNI-F6-01). A morph that CARRIES aiRequest across (note↔highlight) must NOT
 * unbridge.
 */

function makeDeps(): {
  d: CardLifecycleDeps;
  order: string[];
  unbridgeArgs: Array<[CardKind, string]>;
} {
  const order: string[] = [];
  const unbridgeArgs: Array<[CardKind, string]> = [];
  return {
    order,
    unbridgeArgs,
    d: {
      confirm: vi.fn(async () => true),
      unbridgeAiRequest: vi.fn(async (kind: CardKind, id: string) => {
        order.push("unbridge");
        unbridgeArgs.push([kind, id]);
      }),
      mutate: vi.fn(() => {
        order.push("mutate");
      }),
    },
  };
}

describe("morph unbridge", () => {
  let ctx: ReturnType<typeof makeDeps>;
  beforeEach(() => {
    ctx = makeDeps();
  });

  it("report-request → report UNBRIDGES the FROM kind BEFORE mutate", async () => {
    await runCardLifecycleEvent({ type: "morph", fromKind: "report-request", id: "q1" }, ctx.d);
    expect(ctx.unbridgeArgs).toEqual([["report-request", "q1"]]);
    // The inbox must clear before the data mutation so the entry is gone in the
    // same logical step (no window where the card is a report but the inbox
    // still links a report-request).
    expect(ctx.order).toEqual(["unbridge", "mutate"]);
  });

  it("report → report-request does NOT unbridge (the FROM side has no routing)", async () => {
    await runCardLifecycleEvent({ type: "morph", fromKind: "report", id: "r1" }, ctx.d);
    expect(ctx.d.unbridgeAiRequest).not.toHaveBeenCalled();
    expect(ctx.order).toEqual(["mutate"]);
  });

  it("note → highlight does NOT unbridge (aiRequest carries across)", async () => {
    await runCardLifecycleEvent({ type: "morph", fromKind: "note", id: "n1" }, ctx.d);
    expect(ctx.d.unbridgeAiRequest).not.toHaveBeenCalled();
    // sanity: note↔highlight does not declare an aiRequest drop
    expect(CARD_REGISTRY.note.morph?.drops).not.toContain("aiRequest");
  });
});

describe("delete unbridge", () => {
  let ctx: ReturnType<typeof makeDeps>;
  beforeEach(() => {
    ctx = makeDeps();
  });

  it("deleting an aiRequest-bearing kind (report-request) UNBRIDGES it (REP-F7-02)", async () => {
    await runCardLifecycleEvent(
      { type: "delete", kind: "report-request", id: "q1", hasContent: false },
      ctx.d,
    );
    expect(ctx.unbridgeArgs).toEqual([["report-request", "q1"]]);
    expect(ctx.order).toEqual(["unbridge", "mutate"]);
  });

  it("deleting a NON-aiRequest kind (report) does NOT unbridge", async () => {
    await runCardLifecycleEvent(
      { type: "delete", kind: "report", id: "r1", hasContent: false },
      ctx.d,
    );
    expect(ctx.d.unbridgeAiRequest).not.toHaveBeenCalled();
  });

  it("a cancelled delete-confirm unbridges nothing and never mutates", async () => {
    const d2 = makeDeps();
    d2.d.confirm = vi.fn(async () => false);
    const ok = await runCardLifecycleEvent(
      { type: "delete", kind: "report-request", id: "q1", hasContent: true },
      d2.d,
    );
    expect(ok).toBe(false);
    expect(d2.d.unbridgeAiRequest).not.toHaveBeenCalled();
    expect(d2.order).toEqual([]);
  });
});

describe("the unbridge decision matches the registry contract", () => {
  it("every kind whose morph drops aiRequest has FROM routing and TO has none", () => {
    for (const k of CARD_KINDS) {
      const m = CARD_REGISTRY[k].morph;
      if (m?.drops.includes("aiRequest")) {
        expect(CARD_REGISTRY[k].aiRequest != null, `${k}: FROM must have routing`).toBe(true);
        expect(CARD_REGISTRY[m.to].aiRequest == null, `${m.to}: TO must NOT have routing`).toBe(true);
      }
    }
  });
});
