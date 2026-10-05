// @vitest-environment jsdom
/**
 * Task 960 — PRISTINE-NESS TRAVELS WITH THE CLONE.
 *
 * A card created blank is registered pristine so a click-away discards it.
 * Duplicating its passage cloned the card through the lifecycle door, and no
 * `clone*` consulted the tracker — so the sweep removed the source and the
 * empty twin persisted in the sidecar forever. The rule now lives at the ONE
 * door every duplicate walker clones through (`useCardLifecycleApi`), for
 * every kind that clones, in the same per-panel bucket the source's own sweep
 * reads.
 */
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  useCardLifecycleApi,
  type CardLifecycleRegistry,
} from "../card-lifecycle-registry";
import type {
  PristineBucket,
  PristineCardManager,
  PristineKindApi,
} from "@/hooks/usePristineCardManager";
import { CARD_REGISTRY } from "@/cards/card-registry";
import { panelForCardKind } from "@/cards/predicates";
import type { CardKind } from "../_shared/types";

/** A faithful in-memory manager: one Set + one discard per panel bucket. */
function makeManager() {
  const sets = new Map<PristineBucket, Set<string>>();
  const discards = new Map<PristineBucket, (id: string) => void>();
  const setFor = (b: PristineBucket) => {
    let s = sets.get(b);
    if (!s) sets.set(b, (s = new Set()));
    return s;
  };
  const manager: PristineCardManager = {
    forKind: (b): PristineKindApi => ({
      markNew: (id) => void setFor(b).add(id),
      markDirty: (id) => void setFor(b).delete(id),
      isPristine: (id) => setFor(b).has(id),
      registerDiscard: (d) => {
        discards.set(b, d);
        return () => discards.delete(b);
      },
      discardAll: () => {
        const ids = [...setFor(b)];
        setFor(b).clear();
        const d = discards.get(b);
        if (d) ids.forEach(d);
      },
    }),
  };
  return { manager, setFor };
}

/** A sidecar stand-in: clone copies the row under a fresh id. */
function makeStore() {
  const rows = new Set<string>();
  let n = 0;
  return {
    rows,
    clone: (src: string) => {
      if (!rows.has(src)) return null;
      const id = `clone-${++n}`;
      rows.add(id);
      return id;
    },
    delete: (id: string) => void rows.delete(id),
  };
}

const cloningKinds = (Object.keys(CARD_REGISTRY) as CardKind[]).filter(
  (k) => CARD_REGISTRY[k].lifecycle.clone,
);

describe("task 960 — a clone of a pristine card is pristine", () => {
  it("covers a non-empty population (vacuity guard)", () => {
    expect(cloningKinds).toContain("revision-comment");
    expect(cloningKinds.length).toBeGreaterThanOrEqual(5);
  });

  for (const kind of cloningKinds) {
    it(`${kind}: blank source → clone discarded by the same sweep; typed source → clone kept`, () => {
      const bucket = panelForCardKind(kind)!;
      expect(bucket).toBeTruthy();
      const { manager } = makeManager();
      const store = makeStore();
      const tracker = manager.forKind(bucket);
      tracker.registerDiscard(store.delete);
      const registry: CardLifecycleRegistry = {
        [kind]: { clone: store.clone, delete: store.delete },
      };
      const { result } = renderHook(() => useCardLifecycleApi(registry, manager));

      // Blank source, cloned before the user typed anything.
      store.rows.add("blank");
      tracker.markNew("blank");
      const blankClone = result.current.get(kind)!.clone("blank")!;
      expect(tracker.isPristine(blankClone)).toBe(true);

      // Committed source.
      store.rows.add("typed");
      const typedClone = result.current.get(kind)!.clone("typed")!;
      expect(tracker.isPristine(typedClone)).toBe(false);

      tracker.discardAll();
      expect(store.rows.has("blank")).toBe(false);
      expect(store.rows.has(blankClone)).toBe(false);
      expect(store.rows.has("typed")).toBe(true);
      expect(store.rows.has(typedClone)).toBe(true);
    });
  }

  it("a declined clone (null) marks nothing", () => {
    const { manager, setFor } = makeManager();
    const registry: CardLifecycleRegistry = {
      note: { clone: () => null, delete: () => {} },
    };
    manager.forKind(panelForCardKind("note")!).markNew("src");
    const { result } = renderHook(() => useCardLifecycleApi(registry, manager));
    expect(result.current.get("note")!.clone("src")).toBeNull();
    expect([...setFor(panelForCardKind("note")!)]).toEqual(["src"]);
  });

  it("without a manager the door is a pass-through", () => {
    const registry: CardLifecycleRegistry = {
      note: { clone: () => "x", delete: () => {} },
    };
    const { result } = renderHook(() => useCardLifecycleApi(registry));
    expect(result.current.get("note")).toBe(registry.note);
  });
});
