import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  runCardLifecycleEvent,
  unbridgeModeFor,
  type CardLifecycleDeps,
  type LifecycleEvent,
} from "../lifecycle/run-event";
import { CARD_REGISTRY, assertMorphCoverage } from "../card-registry";
import { CARD_KINDS } from "../predicates";
import type { CardKind } from "../types";
import type { AiRequestSyncMode } from "@/lib/ai-request-bridge";
// Side-effect: register every morph converter onto CARD_REGISTRY so
// assertMorphCoverage()'s converter check doesn't false-fire below.
import "../morphs";

/**
 * T4 §3.4 — the lifecycle unbridge. A morph that DROPS the aiRequest flag
 * (report-request→report), or a DELETE of an aiRequest-bearing kind, must clear
 * the pending `ai-requests.json` entry in the same logical step — so a phantom
 * inbox entry never strands (REP-F5-01 / REP-F6-01 / REP-F7-02 / REP-F8-01 /
 * OMNI-F6-01). A morph that CARRIES aiRequest across (note↔highlight) must NOT
 * unbridge.
 *
 * SINCE TASK 313, ALSO THE MODE. This file previously stubbed
 * `unbridgeAiRequest` with a `vi.fn` and asserted only called/not-called —
 * which is exactly why the morph leg could run in `"toggle"` mode for months
 * with every test green. The stub now RECORDS the mode and every firing case
 * asserts it, so the two terminal transitions can't silently re-fork.
 */

function makeDeps(): {
  d: CardLifecycleDeps;
  order: string[];
  unbridgeArgs: Array<[CardKind, string]>;
  unbridgeModes: AiRequestSyncMode[];
} {
  const order: string[] = [];
  const unbridgeArgs: Array<[CardKind, string]> = [];
  const unbridgeModes: AiRequestSyncMode[] = [];
  return {
    order,
    unbridgeArgs,
    unbridgeModes,
    d: {
      confirm: vi.fn(async () => true),
      unbridgeAiRequest: vi.fn(
        async (kind: CardKind, id: string, mode: AiRequestSyncMode) => {
          order.push("unbridge");
          unbridgeArgs.push([kind, id]);
          unbridgeModes.push(mode);
        },
      ),
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
    // TERMINATE, not toggle (313): a report-request answered by an L3 propose
    // responder carries an `in-progress`+`resultId` row, which a toggle-off
    // deliberately preserves and therefore would NOT close.
    expect(ctx.unbridgeModes).toEqual(["terminate"]);
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

  // 198 — the comment→suggestion family crosses from an aiRequest-routed FROM
  // kind to a routing-less suggestion TO kind, so it MUST unbridge the pending
  // `ai-requests.json` row before mutating (else the row strands and re-drafts a
  // duplicate AI suggestion on the next `/editor/review`). Same obligation the
  // report-request→report pair carries.
  it("revision-comment → revision-suggestion UNBRIDGES the FROM kind BEFORE mutate (198)", async () => {
    await runCardLifecycleEvent({ type: "morph", fromKind: "revision-comment", id: "rc1" }, ctx.d);
    expect(ctx.unbridgeArgs).toEqual([["revision-comment", "rc1"]]);
    expect(ctx.unbridgeModes).toEqual(["terminate"]);
    expect(ctx.order).toEqual(["unbridge", "mutate"]);
  });

  it("cutter-comment → cutter-suggestion UNBRIDGES the FROM kind BEFORE mutate (198)", async () => {
    await runCardLifecycleEvent({ type: "morph", fromKind: "cutter-comment", id: "cc1" }, ctx.d);
    expect(ctx.unbridgeArgs).toEqual([["cutter-comment", "cc1"]]);
    expect(ctx.unbridgeModes).toEqual(["terminate"]);
    expect(ctx.order).toEqual(["unbridge", "mutate"]);
  });

  it("the REVERSE suggestion → comment does NOT unbridge (the FROM side has no routing)", async () => {
    for (const from of ["revision-suggestion", "cutter-suggestion"] as const) {
      const c = makeDeps();
      await runCardLifecycleEvent({ type: "morph", fromKind: from, id: "s1" }, c.d);
      expect(c.d.unbridgeAiRequest, from).not.toHaveBeenCalled();
      expect(c.order, from).toEqual(["mutate"]);
    }
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
    expect(ctx.unbridgeModes).toEqual(["terminate"]);
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

/**
 * Task 313 — the MODE half of the obligation, pinned over the WHOLE event union
 * rather than case-by-case.
 *
 * The `Record` below is exhaustive by construction: a third `LifecycleEvent`
 * type is a compile error HERE as well as in `unbridgeModeFor` itself, so a new
 * transition can't be added and left to inherit a mode by accident — someone has
 * to state its terminality in both places, which is the point.
 */
describe("unbridgeModeFor — every lifecycle transition is TERMINAL", () => {
  const MODE_BY_EVENT: Record<LifecycleEvent["type"], AiRequestSyncMode> = {
    // The card is gone.
    delete: "terminate",
    // The card's aiRequest identity is gone; the TO kind has no routing, so no
    // later toggle could ever clear the row.
    morph: "terminate",
  };

  for (const [type, expected] of Object.entries(MODE_BY_EVENT) as Array<
    [LifecycleEvent["type"], AiRequestSyncMode]
  >) {
    it(`${type} → ${expected}`, () => {
      expect(unbridgeModeFor(type)).toBe(expected);
    });
  }

  it("no lifecycle transition discharges in the reversible 'toggle' mode", () => {
    // The regression this whole task closed: `"toggle"` matches through
    // `isRequestOpen`, which reports an answered-L3 row (`in-progress` +
    // `resultId`) as CLOSED — so the drop finds nothing and the row lives on,
    // on a kind that can never toggle again.
    const modes = Object.keys(MODE_BY_EVENT).map((t) =>
      unbridgeModeFor(t as LifecycleEvent["type"]),
    );
    expect(modes).not.toContain("toggle");
    expect(modes.length).toBeGreaterThan(0); // guard the guard: not vacuous
  });
});

describe("the unbridge decision matches the registry contract", () => {
  // The registry pins `drops.includes("aiRequest")` ⇔ (FROM routed ∧ TO unrouted)
  // as a strict biconditional (`assertMorphCoverage`). Both halves are tested so
  // neither can regress independently.

  it("CONVERSE — every kind whose morph drops aiRequest has FROM routing and TO has none", () => {
    for (const k of CARD_KINDS) {
      const m = CARD_REGISTRY[k].morph;
      if (m?.drops.includes("aiRequest")) {
        expect(CARD_REGISTRY[k].aiRequest != null, `${k}: FROM must have routing`).toBe(true);
        expect(CARD_REGISTRY[m.to].aiRequest == null, `${m.to}: TO must NOT have routing`).toBe(true);
      }
    }
  });

  // 198 — the FORWARD direction: a morph from a routed kind to a routing-less one
  // MUST declare the aiRequest drop, or the pending inbox row strands. This was
  // the gap the converse-only check read green on (revision-comment /
  // cutter-comment omitted "aiRequest" while crossing the asymmetry).
  it("FORWARD — every morph from a routed kind to a routing-less one declares the aiRequest drop", () => {
    const crossing: CardKind[] = [];
    for (const k of CARD_KINDS) {
      const m = CARD_REGISTRY[k].morph;
      if (!m) continue;
      const fromRouted = CARD_REGISTRY[k].aiRequest != null;
      const toRouted = CARD_REGISTRY[m.to].aiRequest != null;
      if (fromRouted && !toRouted) {
        crossing.push(k);
        expect(m.drops.includes("aiRequest"), `${k}→${m.to}: must drop aiRequest`).toBe(true);
      }
    }
    // Guard the guard: the three known routing-asymmetric morphs are all present,
    // so this test can't pass vacuously if the registry shape shifts.
    expect(crossing.sort()).toEqual(
      ["cutter-comment", "report-request", "revision-comment"].sort(),
    );
  });

  // The boot assertion itself must run SILENT against the real (fixed) registry —
  // this is the CI-armed guard that the new forward check has no false positive.
  it("assertMorphCoverage is SILENT on the real registry (both biconditional halves hold)", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    assertMorphCoverage();
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
