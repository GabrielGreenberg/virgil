// Task 1525 — Archive Restore's refusal is a VALUE decided where it happens,
// and ONE table words it. Pins the two misnamings the boolean caused: a card
// the panel's migrator rejected was reported as an id collision, and a repeat
// press after a successful restore reported a failure.
import { describe, it, expect } from "vitest";
import { restoreRefusalMessage, type RestoreRefusal } from "@/lib/archive-restore-outcome";
import { reinstateCard } from "@/hooks/reinstate-card";

type S = { cards: Array<{ id: string }> };
const list = (s: S) => s.cards;
const withList = (s: S, cards: S["cards"]) => ({ ...s, cards });

describe("reinstateCard names its refusal", () => {
  it("migrator-null is `rejected`, a held id is `duplicate`, else `ok`", () => {
    let state: S = { cards: [{ id: "a" }] };
    const update = (fn: (p: S) => S) => { state = fn(state); };
    const migrate = (raw: unknown) => (raw && typeof raw === "object" ? (raw as { id: string }) : null);
    expect(reinstateCard(state, update, list, withList, () => null, { id: "b" })).toBe("rejected");
    expect(reinstateCard(state, update, list, withList, migrate, { id: "" })).toBe("rejected");
    expect(reinstateCard(state, update, list, withList, migrate, { id: "a" })).toBe("duplicate");
    expect(reinstateCard(state, update, list, withList, migrate, { id: "b" })).toBe("ok");
    expect(state.cards.map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("restoreRefusalMessage — the one cause → words table", () => {
  const ctx = { addressed: false };
  it("a repeat press after a restore that already happened is silent", () => {
    expect(restoreRefusalMessage({ cause: "gone" }, ctx)).toBeNull();
    expect(restoreRefusalMessage({ cause: "already-restored" }, ctx)).toBeNull();
    expect(restoreRefusalMessage({ cause: "already-restored" }, { addressed: true })).toBeNull();
  });

  it("a migrator reject does not claim an id collision", () => {
    const msg = restoreRefusalMessage({ cause: "card-rejected", panel: "notes" }, ctx)!;
    expect(msg).not.toMatch(/same id/);
    expect(msg).toMatch(/Nothing was removed from the Archive\.$/);
  });

  it("a duplicate names the collision and the panel", () => {
    const msg = restoreRefusalMessage({ cause: "card-duplicate", panel: "notes" }, ctx)!;
    expect(msg).toMatch(/same id is already there/);
    expect(msg).toMatch(/Notes/);
  });

  it("a landing refusal tells the caret story only without a return address", () => {
    expect(restoreRefusalMessage({ cause: "land-refused" }, { addressed: false })).toMatch(/ordinary paragraph/);
    const addressed = restoreRefusalMessage({ cause: "land-refused" }, { addressed: true })!;
    expect(addressed).toMatch(/where it came from/);
    expect(addressed).not.toMatch(/ordinary paragraph/);
  });

  it("every real failure ends by saying nothing left the Archive", () => {
    const failures: RestoreRefusal[] = [
      { cause: "unreadable-origin" },
      { cause: "card-rejected", panel: "todos" },
      { cause: "card-duplicate", panel: "cutter" },
      { cause: "land-refused" },
    ];
    for (const f of failures) {
      expect(restoreRefusalMessage(f, ctx)).toMatch(/Nothing was removed from the Archive\.$/);
    }
  });
});
