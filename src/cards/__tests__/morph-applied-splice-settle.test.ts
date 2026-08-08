import { describe, it, expect, vi } from "vitest";
import {
  appliedSpliceSettleMessage,
  runCardLifecycleEvent,
  type CardLifecycleDeps,
} from "../lifecycle/run-event";
import {
  ownsAppliedSplice,
  APPLIED_SPLICE_KIND_LIST,
  type AppliedSpliceOps,
  type AppliedSpliceSummary,
} from "../lifecycle/applied-splice";
import { CARD_REGISTRY } from "../card-registry";
import type { CardKind } from "../types";
// Registers the morph converters + runs the boot assertions.
import "../morphs";

/**
 * Task 2026-07-27-238 — the SETTLE obligation.
 *
 * A `status:"applied"` revision/cutter suggestion owns a LIVE range in the
 * document (the blue `pending-ai-change` mark its `appliedChange` describes).
 * Morphing it to a comment — or deleting it — ends the record that manages that
 * range. Before this obligation existed, both did so silently: the morph
 * declared `drops: []` (no confirm at all) and the converter rebuilt a comment
 * with no `status`/`appliedChange`, so `isAppliedPending` stopped resolving the
 * range (Keep/Revert unreachable) and on reload the orphan reaper stripped the
 * mark — leaving unreviewed AI text in the `.tex` with nothing to revert it.
 *
 * These pin the executor half: the splice is settled BEFORE the mutation, a
 * cancel abandons the whole event, and DELETE carries the same obligation as
 * morph (both end the record).
 */

const SPLICE: AppliedSpliceSummary = { anchorId: "anchor-1", mode: "replace" };

function ops(over: Partial<AppliedSpliceOps> = {}): {
  bag: AppliedSpliceOps;
  get: AppliedSpliceOps["get"];
  ask: AppliedSpliceOps["ask"];
  settle: AppliedSpliceOps["settle"];
} {
  const bag = {
    get: vi.fn(() => SPLICE),
    ask: vi.fn(async () => "keep" as const),
    settle: vi.fn(() => true),
    ...over,
  } as unknown as AppliedSpliceOps;
  // Read the members BACK off the bag — an `over` entry must be the fn the
  // assertions inspect, not a shadowed default.
  return { bag, get: bag.get, ask: bag.ask, settle: bag.settle };
}

function deps(
  appliedSplice: AppliedSpliceOps | undefined,
  order: string[],
): { d: CardLifecycleDeps; mutate: ReturnType<typeof vi.fn> } {
  const mutate = vi.fn(() => {
    order.push("mutate");
  });
  return {
    d: {
      confirm: async () => true,
      unbridgeAiRequest: async () => {},
      mutate,
      appliedSplice,
    },
    mutate,
  };
}

describe("ownsAppliedSplice — membership is derived from PendingChangeFamily", () => {
  it("is exactly the two suggestion kinds", () => {
    expect([...APPLIED_SPLICE_KIND_LIST].sort()).toEqual([
      "cutter-suggestion",
      "revision-suggestion",
    ]);
    expect(ownsAppliedSplice("revision-suggestion")).toBe(true);
    expect(ownsAppliedSplice("cutter-suggestion")).toBe(true);
  });

  it("no other registered kind owns a splice", () => {
    const others = (Object.keys(CARD_REGISTRY) as CardKind[]).filter(
      (k) => !APPLIED_SPLICE_KIND_LIST.includes(k as never),
    );
    for (const k of others) expect(ownsAppliedSplice(k)).toBe(false);
    // Sanity: the comment halves — the MORPH TARGETS — must not own one, which
    // is exactly why the morph has to settle before flipping.
    expect(ownsAppliedSplice("revision-comment")).toBe(false);
    expect(ownsAppliedSplice("cutter-comment")).toBe(false);
  });
});

describe("appliedSpliceSettleMessage — generated, mode-honest copy", () => {
  it("a replace-mode morph says the suggested text replaced the original", () => {
    const copy = appliedSpliceSettleMessage("morph", "revision-suggestion", {
      anchorId: "a",
      mode: "replace",
    });
    // The morph target's registry label, same SSOT `morphConfirmMessage` uses.
    expect(copy.title).toBe("Change to Request?");
    expect(copy.message).toContain("replaced the original");
    expect(copy.keepLabel).toBeTruthy();
    expect(copy.revertLabel).toBeTruthy();
  });

  it("a delete-mode splice says the text is struck but still there", () => {
    const copy = appliedSpliceSettleMessage("morph", "cutter-suggestion", {
      anchorId: "a",
      mode: "delete",
    });
    expect(copy.message).toContain("struck for deletion but still there");
    // A pending DELETE must never be described as an applied replacement — the
    // user is deciding what happens to their document.
    expect(copy.message).not.toContain("replaced the original");
    // The affirmative button carries out the DELETION here; naming it "keep the
    // change" over struck text reads as "keep the words", i.e. the opposite.
    expect(copy.keepLabel).toBe("Keep the deletion");
  });

  it("the delete leg asks about deleting the card, not converting it", () => {
    const copy = appliedSpliceSettleMessage("delete", "revision-suggestion", SPLICE);
    expect(copy.title.toLowerCase()).toContain("delete");
  });
});

describe("runCardLifecycleEvent — SETTLE runs before MUTATE", () => {
  it("morph of an applied suggestion settles the splice first, then mutates", async () => {
    const order: string[] = [];
    const o = ops({
      settle: vi.fn(() => {
        order.push("settle");
        return true;
      }),
    });
    const { d } = deps(o.bag, order);
    const committed = await runCardLifecycleEvent(
      { type: "morph", fromKind: "revision-suggestion", id: "c1" },
      d,
    );
    expect(committed).toBe(true);
    expect(order).toEqual(["settle", "mutate"]);
    expect(o.settle).toHaveBeenCalledWith("revision-suggestion", "c1", "keep");
  });

  it("a REVERT choice is passed through verbatim", async () => {
    const order: string[] = [];
    const o = ops({
      ask: vi.fn(async () => "revert" as const),
      settle: vi.fn(() => {
        order.push("settle");
        return true;
      }),
    });
    const { d } = deps(o.bag, order);
    await runCardLifecycleEvent(
      { type: "morph", fromKind: "cutter-suggestion", id: "c2" },
      d,
    );
    expect(o.settle).toHaveBeenCalledWith("cutter-suggestion", "c2", "revert");
  });

  it("CANCEL abandons the whole event — nothing mutates", async () => {
    const order: string[] = [];
    const o = ops({ ask: vi.fn(async () => null) });
    const { d, mutate } = deps(o.bag, order);
    const committed = await runCardLifecycleEvent(
      { type: "morph", fromKind: "revision-suggestion", id: "c3" },
      d,
    );
    // A cancel must not half-apply: no settle, no mutate, and the caller is told
    // the event did not commit (so the float-key remap / restamp are skipped).
    expect(committed).toBe(false);
    expect(o.settle).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("DELETE of an applied suggestion carries the same obligation", async () => {
    const order: string[] = [];
    const o = ops({
      settle: vi.fn(() => {
        order.push("settle");
        return true;
      }),
    });
    const { d } = deps(o.bag, order);
    const committed = await runCardLifecycleEvent(
      { type: "delete", kind: "cutter-suggestion", id: "c4", hasContent: false },
      d,
    );
    expect(committed).toBe(true);
    expect(order).toEqual(["settle", "mutate"]);
  });

  it("a cancelled DELETE leaves the card alone", async () => {
    const order: string[] = [];
    const o = ops({ ask: vi.fn(async () => null) });
    const { d, mutate } = deps(o.bag, order);
    const committed = await runCardLifecycleEvent(
      { type: "delete", kind: "revision-suggestion", id: "c5", hasContent: false },
      d,
    );
    expect(committed).toBe(false);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("a REFUSED settlement (host can't act) aborts the event rather than orphaning", async () => {
    const order: string[] = [];
    // The host returns false when it has no editor to splice with. Proceeding
    // then would end the record over a still-live range — the exact 238 loss —
    // so the executor must refuse, leaving the applied card recoverable.
    const o = ops({ settle: vi.fn(() => false) });
    const { d, mutate } = deps(o.bag, order);
    const morphed = await runCardLifecycleEvent(
      { type: "morph", fromKind: "revision-suggestion", id: "c9" },
      d,
    );
    expect(morphed).toBe(false);
    expect(mutate).not.toHaveBeenCalled();

    const deleted = await runCardLifecycleEvent(
      { type: "delete", kind: "cutter-suggestion", id: "c9", hasContent: false },
      d,
    );
    expect(deleted).toBe(false);
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe("runCardLifecycleEvent — SETTLE is inert where it should be", () => {
  it("a card with no live splice is never prompted", async () => {
    const order: string[] = [];
    const o = ops({ get: vi.fn(() => null) });
    const { d, mutate } = deps(o.bag, order);
    await runCardLifecycleEvent(
      { type: "morph", fromKind: "revision-suggestion", id: "c6" },
      d,
    );
    expect(o.ask).not.toHaveBeenCalled();
    expect(o.settle).not.toHaveBeenCalled();
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("a kind that can't own a splice is never even asked for one", async () => {
    const order: string[] = [];
    const o = ops();
    const { d, mutate } = deps(o.bag, order);
    // note → highlight: a lossy morph, but nothing in the document outlives it.
    await runCardLifecycleEvent({ type: "morph", fromKind: "note", id: "c7" }, d);
    expect(o.get).not.toHaveBeenCalled();
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("a host with no ops bag (flag-off / tests) behaves exactly as before", async () => {
    const order: string[] = [];
    const { d, mutate } = deps(undefined, order);
    const committed = await runCardLifecycleEvent(
      { type: "morph", fromKind: "revision-suggestion", id: "c8" },
      d,
    );
    expect(committed).toBe(true);
    expect(mutate).toHaveBeenCalledTimes(1);
  });
});
