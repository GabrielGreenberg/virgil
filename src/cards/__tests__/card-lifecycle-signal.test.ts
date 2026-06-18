import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  subscribeCardLifecycle,
  publishCardDeleted,
  publishCardMorphed,
} from "../lifecycle/card-lifecycle-signal";
import { cardStore } from "@/links/_shared/anchored-card-store";
import {
  pruneCardStoreFor,
  rekeyCardStoreForMorph,
} from "@/links/_shared/inline-atom-lifecycle-policy";

/**
 * The D6 seam (T4 §3.3 step 3 / PLAN §1 D6). `runCardLifecycleEvent` publishes a
 * `card-deleted` / `card-morphed` signal; the W2d reconciler consumes it to
 * prune / re-key the global `cardStore` for the sidecar-backed kinds. These pin
 * the channel + the cardStore reconcile (REP-F6-02 / OMNI-F6-02).
 */

describe("card-lifecycle signal channel", () => {
  it("delivers card-deleted / card-morphed to subscribers", () => {
    const seen: unknown[] = [];
    const off = subscribeCardLifecycle((s) => seen.push(s));
    publishCardDeleted("report", "r1");
    publishCardMorphed("report", "report-request", "r2");
    off();
    publishCardDeleted("note", "n9"); // after unsubscribe — must NOT be seen
    expect(seen).toEqual([
      { type: "card-deleted", kind: "report", id: "r1" },
      { type: "card-morphed", fromKind: "report", toKind: "report-request", id: "r2" },
    ]);
  });

  it("a throwing listener does not strand the others", () => {
    const seen: string[] = [];
    const offA = subscribeCardLifecycle(() => {
      throw new Error("boom");
    });
    const offB = subscribeCardLifecycle((s) => seen.push(s.type));
    publishCardDeleted("report", "r1");
    offA();
    offB();
    expect(seen).toEqual(["card-deleted"]);
  });
});

describe("cardStore reconcile on the signal (the D6 consumer behavior)", () => {
  // Wire the same reconcile the hook installs (prune on delete, re-key on morph).
  let off: () => void;
  beforeEach(() => {
    cardStore.clearSelection();
    cardStore.setHover(null);
    for (const ref of [...cardStore.getState().expandedSet]) cardStore.collapse(ref);
    off = subscribeCardLifecycle((s) => {
      if (s.type === "card-deleted") pruneCardStoreFor(s.kind, s.id);
      else rekeyCardStoreForMorph(s.fromKind, s.toKind, s.id);
    });
  });
  afterEach(() => {
    off();
    cardStore.clearSelection();
    cardStore.setHover(null);
    for (const ref of [...cardStore.getState().expandedSet]) cardStore.collapse(ref);
  });

  it("card-deleted clears a stale selection / hover / expansion (no ghost halo)", () => {
    cardStore.select({ kind: "report", id: "r1" });
    cardStore.setHover({ kind: "report", id: "r1" });
    cardStore.expand({ kind: "report", id: "r1" });
    publishCardDeleted("report", "r1");
    expect(cardStore.getState().selected).toBeNull();
    expect(cardStore.getState().hover).toBeNull();
    expect(cardStore.isExpanded({ kind: "report", id: "r1" })).toBe(false);
  });

  it("card-deleted leaves an UNRELATED card's selection intact", () => {
    cardStore.select({ kind: "note", id: "n2" });
    publishCardDeleted("report", "r1");
    expect(cardStore.getState().selected).toEqual({ kind: "note", id: "n2" });
  });

  it("card-morphed RE-KEYS the selection halo to the new kind (REP-F6-02)", () => {
    cardStore.select({ kind: "report", id: "r1" });
    cardStore.expand({ kind: "report", id: "r1" });
    publishCardMorphed("report", "report-request", "r1");
    // halo + expansion survive the kind flip, re-keyed to the new kind
    expect(cardStore.getState().selected).toEqual({ kind: "report-request", id: "r1" });
    expect(cardStore.isExpanded({ kind: "report-request", id: "r1" })).toBe(true);
    expect(cardStore.isExpanded({ kind: "report", id: "r1" })).toBe(false);
  });
});
