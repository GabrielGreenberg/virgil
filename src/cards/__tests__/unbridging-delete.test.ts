import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeUnbridgingDelete } from "../lifecycle/unbridging-delete";
import { CARD_REGISTRY } from "../card-registry";
import type { CardKind } from "../types";

/**
 * task 219 — the DELETE leg of the ai-request bridge. Archiving (task 093) and
 * morphing (task 198) a flag-bearing card already discharge its linked
 * `ai-requests.json` row; DELETE was wired for exactly ONE kind
 * (`report-request`) and stranded the row for the other six (note / highlight /
 * todo / cutter-comment / revision-comment / footnote). `makeUnbridgingDelete`
 * is the ONE composition that routes every panel hook's raw delete through the
 * shared `runCardLifecycleEvent` executor, so the executor's registry-gated
 * `unbridgeAiRequest` branch fires for EVERY routed kind — this pins the wiring
 * so a regression trips CI (the executor + terminate-mode bridge mechanics they
 * ride are pinned separately by lifecycle-unbridge.test.ts and
 * ai-request-bridge-idempotency.test.ts).
 */

function makeSpies() {
  const order: string[] = [];
  const unbridge = vi.fn(async (_k: CardKind, _id: string) => {
    order.push("unbridge");
  });
  const rawDelete = vi.fn((_id: string) => {
    order.push("mutate");
  });
  return { order, unbridge, rawDelete };
}

/** The six flag-bearing kinds whose delete now unbridges through the helper.
 *  (footnote is the seventh flag-bearing kind — it threads the unbridge
 *  directly in EditorPane rather than through this helper, since its cardStore
 *  prune is already owned by the inline-atom bus reconciler; its terminate leg
 *  is pinned in ai-request-bridge-idempotency.test.ts.) */
const ROUTED_KINDS: CardKind[] = [
  "note",
  "highlight",
  "todo",
  "cutter-comment",
  "revision-comment",
  "report-request",
];

/** Sibling kinds a shared panel-hook delete can also resolve to, none of which
 *  carry aiRequest routing → the executor must NOT unbridge them. */
const UNROUTED_KINDS: CardKind[] = [
  "cutter-suggestion",
  "revision-suggestion",
  "report",
];

describe("makeUnbridgingDelete", () => {
  let spies: ReturnType<typeof makeSpies>;
  beforeEach(() => {
    spies = makeSpies();
  });

  it("every routed kind is a registry sanity check (guards the guard)", () => {
    // If any of these stopped declaring aiRequest routing, the positive cases
    // below would pass vacuously — assert the premise explicitly.
    for (const k of ROUTED_KINDS) {
      expect(CARD_REGISTRY[k].aiRequest != null, `${k} must be routed`).toBe(true);
    }
    for (const k of UNROUTED_KINDS) {
      expect(CARD_REGISTRY[k].aiRequest == null, `${k} must be unrouted`).toBe(true);
    }
  });

  for (const kind of ROUTED_KINDS) {
    it(`deleting a flagged ${kind} UNBRIDGES it BEFORE the mutation`, async () => {
      const del = makeUnbridgingDelete({
        resolveKind: () => kind,
        rawDelete: spies.rawDelete,
        unbridge: spies.unbridge,
      });
      del("card-1");
      // The wrapper is fire-and-forget over an async executor; let its
      // microtask chain (confirm → await unbridge → await mutate) drain.
      await Promise.resolve();
      await Promise.resolve();

      // …in TERMINATE mode, decided by the executor from the event (task 313).
      // A delete's row must close even when it is an answered-L3 proposal a
      // reversible toggle-off would deliberately preserve.
      expect(spies.unbridge).toHaveBeenCalledWith(kind, "card-1", "terminate");
      expect(spies.rawDelete).toHaveBeenCalledWith("card-1");
      // The inbox row must clear BEFORE the card is removed, so there is no
      // window where the card is gone but the row still links it.
      expect(spies.order).toEqual(["unbridge", "mutate"]);
    });
  }

  for (const kind of UNROUTED_KINDS) {
    it(`deleting an unrouted ${kind} mutates but does NOT unbridge`, async () => {
      const del = makeUnbridgingDelete({
        resolveKind: () => kind,
        rawDelete: spies.rawDelete,
        unbridge: spies.unbridge,
      });
      del("card-1");
      await Promise.resolve();
      await Promise.resolve();

      expect(spies.unbridge).not.toHaveBeenCalled();
      expect(spies.rawDelete).toHaveBeenCalledWith("card-1");
      expect(spies.order).toEqual(["mutate"]);
    });
  }

  it("resolveKind → null falls back to a raw delete (no executor, no unbridge)", async () => {
    const del = makeUnbridgingDelete({
      resolveKind: () => null,
      rawDelete: spies.rawDelete,
      unbridge: spies.unbridge,
    });
    del("ghost");
    await Promise.resolve();
    await Promise.resolve();

    expect(spies.rawDelete).toHaveBeenCalledWith("ghost");
    expect(spies.unbridge).not.toHaveBeenCalled();
    expect(spies.order).toEqual(["mutate"]);
  });
});
