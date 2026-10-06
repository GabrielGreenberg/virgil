import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createCardStore, type CardStore } from "@/links/_shared/anchored-card-store";
import { makeCardLifecycleSink } from "../lifecycle/useCardLifecycleReconciler";
import { runCardLifecycleEvent, type CardLifecycleDeps } from "../lifecycle/run-event";
import { makeUnbridgingDelete } from "../lifecycle/unbridging-delete";
import type { CardLifecycleSink } from "../lifecycle/card-lifecycle-signal";
import { cardPopKey } from "@/panels/panel-registry";

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

describe("the sink's FLOAT half (task 789 — a deleted card's popped window closes)", () => {
  // A faithful model of the prefs pair the pane's viewPrefs owns: the popped
  // key list (the Cmd-W focus stack is derived from it, newest last) and the
  // saved rects. Mirrors `closeCardPopout` / `remapCardPopKey` in useViewPrefs.
  function makeFloats(keys: string[]) {
    const state = {
      poppedOutCards: [...keys],
      cardFloatPositions: Object.fromEntries(
        keys.map((k) => [k, { x: 1, y: 2, width: 3, height: 4 }]),
      ) as Record<string, { x: number; y: number; width: number; height: number }>,
    };
    return {
      state,
      closeCardPopout: vi.fn((key: string) => {
        state.poppedOutCards = state.poppedOutCards.filter((k) => k !== key);
        delete state.cardFloatPositions[key];
      }),
      remapCardPopKey: vi.fn((oldKey: string, newKey: string) => {
        if (!state.poppedOutCards.includes(oldKey)) return;
        state.poppedOutCards = state.poppedOutCards.map((k) => (k === oldKey ? newKey : k));
        state.cardFloatPositions[newKey] = state.cardFloatPositions[oldKey];
        delete state.cardFloatPositions[oldKey];
      }),
    };
  }

  it("card-deleted closes the card's float key AND drops its rect; the next live float is the Cmd-W target", () => {
    const floats = makeFloats([cardPopKey("report", "r0"), cardPopKey("note", "n1")]);
    const sink = makeCardLifecycleSink(createCardStore(), () => floats);
    sink({ type: "card-deleted", kind: "note", id: "n1" });
    expect(floats.state.poppedOutCards).toEqual([cardPopKey("report", "r0")]);
    expect(floats.state.cardFloatPositions[cardPopKey("note", "n1")]).toBeUndefined();
    // Top of the stack (Cmd-W's target) is now the live float, not a ghost.
    expect(floats.state.poppedOutCards.at(-1)).toBe(cardPopKey("report", "r0"));
  });

  it("card-morphed remaps the float key in lockstep (rect follows)", () => {
    const floats = makeFloats([cardPopKey("report", "r1")]);
    const sink = makeCardLifecycleSink(createCardStore(), () => floats);
    sink({ type: "card-morphed", fromKind: "report", toKind: "report-request", id: "r1" });
    expect(floats.state.poppedOutCards).toEqual([cardPopKey("report-request", "r1")]);
    expect(floats.state.cardFloatPositions[cardPopKey("report-request", "r1")]).toBeDefined();
  });

  it("every delete door reaches it — a todo deleted through makeUnbridgingDelete closes its float", async () => {
    const floats = makeFloats([cardPopKey("todo", "t1")]);
    const del = makeUnbridgingDelete({
      resolveKind: () => "todo",
      rawDelete: () => {},
      unbridge: async () => {},
      signal: makeCardLifecycleSink(createCardStore(), () => floats),
    });
    expect(await del("t1")).toBe(true);
    expect(floats.state.poppedOutCards).toEqual([]);
  });

  it("archive too (task 974) — R18's no-CASCADE flag does not exempt a user delete from the float close", async () => {
    // `CARD_REGISTRY.archive.lifecycle.delete === false` is about the anchor
    // paragraph's deletion cascading, not the user deleting the card; the
    // executor must not read it as "skip the signal".
    const floats = makeFloats([cardPopKey("note", "n0"), cardPopKey("archive", "a1")]);
    const store = createCardStore();
    store.select({ kind: "archive", id: "a1" });
    const removed: string[] = [];
    const del = makeUnbridgingDelete({
      resolveKind: () => "archive",
      rawDelete: (id) => {
        removed.push(id);
      },
      unbridge: async () => {
        throw new Error("archive has no aiRequest routing — must not unbridge");
      },
      signal: makeCardLifecycleSink(store, () => floats),
    });
    expect(await del("a1")).toBe(true);
    expect(removed).toEqual(["a1"]);
    expect(floats.state.poppedOutCards).toEqual([cardPopKey("note", "n0")]);
    expect(floats.state.cardFloatPositions[cardPopKey("archive", "a1")]).toBeUndefined();
    expect(store.getState().selected).toBeNull();
  });

  it("the card-origin archive restore signals card-deleted for the archive key (task 974)", () => {
    const src = readFileSync(join(__dirname, "../../components/EditorPane.tsx"), "utf8");
    const at = src.indexOf("const handleArchiveRestore = useCallback(");
    const end = src.indexOf("const handleArchiveDelete", at);
    const body = src.slice(at, end);
    expect(body).toMatch(/origin\?\.kind === "card"[\s\S]*cardLifecycleSignal\(\{ type: "card-deleted", kind: "archive", id \}\)/);
  });

  it("the morph executor's signal carries the remap (no hand remap beside it)", async () => {
    const floats = makeFloats([cardPopKey("note", "n1")]);
    const ok = await runCardLifecycleEvent(
      { type: "morph", fromKind: "note", id: "n1" },
      depsFor(makeCardLifecycleSink(createCardStore(), () => floats)),
    );
    expect(ok).toBe(true);
    expect(floats.state.poppedOutCards).toEqual([cardPopKey("highlight", "n1")]);
  });

  it("a throwing float op does not skip the cardStore prune (each half guarded)", () => {
    const store = createCardStore();
    store.select({ kind: "note", id: "n1" });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const sink = makeCardLifecycleSink(store, () => ({
      closeCardPopout: () => {
        throw new Error("boom");
      },
      remapCardPopKey: () => {},
    }));
    sink({ type: "card-deleted", kind: "note", id: "n1" });
    expect(store.getState().selected).toBeNull();
    err.mockRestore();
  });

  it("EditorPane hands the sink its viewPrefs and no longer hand-remaps the morph", () => {
    const src = readFileSync(join(__dirname, "../../components/EditorPane.tsx"), "utf8");
    expect(src).toMatch(/useCardLifecycleReconciler\(cardStoreInst, viewPrefs\)/);
    expect(src).not.toMatch(/remapCardPopKey\(cardPopKey\(fromCardKind/);
  });
});
