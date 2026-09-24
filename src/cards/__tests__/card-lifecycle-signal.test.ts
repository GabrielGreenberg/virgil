import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createCardStore, type CardStore } from "@/links/_shared/anchored-card-store";
import { makeCardLifecycleSink } from "../lifecycle/useCardLifecycleReconciler";
import { runCardLifecycleEvent, type CardLifecycleDeps } from "../lifecycle/run-event";
import { makeUnbridgingDelete } from "../lifecycle/unbridging-delete";
import type { CardLifecycleSink } from "../lifecycle/card-lifecycle-signal";

/**
 * The D6 seam (T4 §3.3 step 3 / PLAN §1 D6). `runCardLifecycleEvent` hands a
 * `card-deleted` / `card-morphed` signal to its injected `deps.signal` sink;
 * the pane's sink (`useCardLifecycleReconciler` → `makeCardLifecycleSink`)
 * prunes / re-keys THAT pane's `cardStore` for the sidecar-backed kinds
 * (REP-F6-02 / OMNI-F6-02).
 *
 * Task 739: the signal used to travel on ONE module-level listener Set every
 * mounted EditorPane subscribed to, so under multi-doc keep-alive a delete in
 * one paper pruned — and a morph re-keyed — the same-id card in every other
 * open paper (a duplicated paper folder shares card ids). These pin that the
 * signal reaches only the store of the pane that ran the event.
 */

function depsFor(sink: CardLifecycleSink): CardLifecycleDeps {
  return {
    confirm: async () => true,
    unbridgeAiRequest: async () => {},
    mutate: () => {},
    signal: sink,
  };
}

describe("cardStore reconcile through the pane's sink (the D6 consumer behavior)", () => {
  let cardStore: CardStore;
  let sink: CardLifecycleSink;
  beforeEach(() => {
    cardStore = createCardStore();
    sink = makeCardLifecycleSink(cardStore);
  });

  it("card-deleted clears a stale selection / hover / expansion (no ghost halo)", () => {
    cardStore.select({ kind: "report", id: "r1" });
    cardStore.setHover({ kind: "report", id: "r1" });
    cardStore.expand({ kind: "report", id: "r1" });
    sink({ type: "card-deleted", kind: "report", id: "r1" });
    expect(cardStore.getState().selected).toBeNull();
    expect(cardStore.getState().hover).toBeNull();
    expect(cardStore.isExpanded({ kind: "report", id: "r1" })).toBe(false);
  });

  it("card-deleted leaves an UNRELATED card's selection intact", () => {
    cardStore.select({ kind: "note", id: "n2" });
    sink({ type: "card-deleted", kind: "report", id: "r1" });
    expect(cardStore.getState().selected).toEqual({ kind: "note", id: "n2" });
  });

  it("card-morphed RE-KEYS the selection halo to the new kind (REP-F6-02)", () => {
    cardStore.select({ kind: "report", id: "r1" });
    cardStore.expand({ kind: "report", id: "r1" });
    sink({ type: "card-morphed", fromKind: "report", toKind: "report-request", id: "r1" });
    expect(cardStore.getState().selected).toEqual({ kind: "report-request", id: "r1" });
    expect(cardStore.isExpanded({ kind: "report-request", id: "r1" })).toBe(true);
    expect(cardStore.isExpanded({ kind: "report", id: "r1" })).toBe(false);
  });

  it("a throwing reconcile is logged, not rethrown into the committed event", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = makeCardLifecycleSink({
      getState: () => {
        throw new Error("boom");
      },
    } as unknown as CardStore);
    expect(() => broken({ type: "card-deleted", kind: "note", id: "n1" })).not.toThrow();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe("two open papers sharing a card id (task 739 — per-pane by construction)", () => {
  // Two panes' worth of stores; the executor is wired to pane A's sink only,
  // exactly as each EditorPane threads its own `useCardLifecycleReconciler`.
  let storeA: CardStore;
  let storeB: CardStore;
  beforeEach(() => {
    storeA = createCardStore();
    storeB = createCardStore();
    for (const s of [storeA, storeB]) {
      s.select({ kind: "note", id: "X" });
      s.setHover({ kind: "note", id: "X" });
      s.expand({ kind: "note", id: "X" });
    }
  });

  function expectUntouched(s: CardStore) {
    expect(s.getState().selected).toEqual({ kind: "note", id: "X" });
    expect(s.getState().hover).toEqual({ kind: "note", id: "X" });
    expect(s.isExpanded({ kind: "note", id: "X" })).toBe(true);
    expect(s.isExpanded({ kind: "highlight", id: "X" })).toBe(false);
  }

  it("a DELETE run in pane A prunes A and leaves B's same-id note alone", async () => {
    const ok = await runCardLifecycleEvent(
      { type: "delete", kind: "note", id: "X", hasContent: false },
      depsFor(makeCardLifecycleSink(storeA)),
    );
    expect(ok).toBe(true);
    expect(storeA.getState().selected).toBeNull();
    expect(storeA.getState().hover).toBeNull();
    expect(storeA.isExpanded({ kind: "note", id: "X" })).toBe(false);
    expectUntouched(storeB);
  });

  it("a MORPH run in pane A re-keys A and leaves B's still-a-note untouched", async () => {
    const ok = await runCardLifecycleEvent(
      { type: "morph", fromKind: "note", id: "X" },
      depsFor(makeCardLifecycleSink(storeA)),
    );
    expect(ok).toBe(true);
    expect(storeA.getState().selected).toEqual({ kind: "highlight", id: "X" });
    expect(storeA.isExpanded({ kind: "highlight", id: "X" })).toBe(true);
    expectUntouched(storeB);
  });

  it("the wrapped delete door (makeUnbridgingDelete) carries the same isolation", async () => {
    const del = makeUnbridgingDelete({
      resolveKind: () => "note",
      rawDelete: () => {},
      unbridge: async () => {},
      signal: makeCardLifecycleSink(storeA),
    });
    expect(await del("X")).toBe(true);
    expect(storeA.getState().selected).toBeNull();
    expectUntouched(storeB);
  });

  it("the module channel is gone: the signal module exports no subscribe/publish", async () => {
    const mod = await import("../lifecycle/card-lifecycle-signal");
    expect(Object.keys(mod)).toEqual([]);
    const pane = readFileSync(join("src", "components", "EditorPane.tsx"), "utf8");
    // Every lifecycle door in the pane threads THIS pane's sink.
    const doors =
      (pane.match(/makeUnbridgingDelete\(\{/g) ?? []).length +
      (pane.match(/runCardLifecycleEvent\(/g) ?? []).length;
    const threaded = (pane.match(/signal: cardLifecycleSignal,/g) ?? []).length;
    expect(doors).toBeGreaterThan(0);
    expect(threaded).toBe(doors);
  });
});
