// @vitest-environment node
//
// Panel-taxonomy SSOT pins (audit-059). Two hand-kept parallel tables used to
// shadow the registry with no guard; this pins both so they can no longer drift:
//
//  1. `PANEL_KIND_TO_BODY_KEY` (panel-typography) is now DERIVED by inverting
//     `PANEL_BODY_PRIMARY_KIND` through each primary kind's owning panel. This
//     test freezes the resulting `PanelKind → PanelBodyKey` map and asserts full
//     coverage, so adding a body-tunable panel or losing a primary kind's panel
//     is caught here instead of silently dropping a panel's font-size tuning.
//  2. `PanelId` (useViewPrefs) is now `PanelKind | "blank"`. The compile-time
//     assertion below fails `tsc` if the two ever diverge (this file is inside
//     the project `tsc --noEmit` include set).
import { describe, it, expect } from "vitest";
import { PANEL_KIND_TO_BODY_KEY, type PanelBodyKey } from "@/lib/panel-typography";
import { PANEL_REGISTRY } from "@/panels/panel-registry";
import type { PanelKind } from "@/panels/_shared/types";
import type { PanelId } from "@/hooks/useViewPrefs";

/* ── Member 2: PanelId ↔ PanelKind | "blank" (compile-time, no runtime) ── */
type AssertTrue<T extends true> = T;
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
// If a PanelKind is added/removed and PanelId falls out of sync, this errors.
type _PanelIdIsPinned = AssertTrue<Equal<PanelId, PanelKind | "blank">>;

describe("panel taxonomy SSOT pins (audit-059)", () => {
  it("member 1 — PANEL_KIND_TO_BODY_KEY reproduces the historical hand-kept map", () => {
    // Frozen expectation = the map that used to be hand-typed in
    // panel-kind-context. Deriving it must not change any pairing; a
    // legitimately-added body panel forces a deliberate update here.
    expect(PANEL_KIND_TO_BODY_KEY).toEqual({
      notes: "note",
      footnotes: "footnote",
      archive: "archive",
      cutter: "cut",
      revisions: "revision",
      todo: "todo",
      reports: "report",
      citations: "citation",
      bibliography: "bib",
      examples: "example",
    });
  });

  it("member 1 — every body key resolves to exactly one live registry panel", () => {
    const ALL_BODY_KEYS: PanelBodyKey[] = [
      "footnote", "note", "archive", "cut", "revision",
      "citation", "bib", "todo", "report", "example",
    ];
    const mappedKeys = Object.values(PANEL_KIND_TO_BODY_KEY);
    // Coverage: no body key silently dropped (would happen if a primary kind's
    // CARD_REGISTRY[kind].panel became null → the derivation skips it).
    for (const bk of ALL_BODY_KEYS) {
      expect(mappedKeys).toContain(bk);
    }
    // No duplicates (each body key must own a distinct panel).
    expect(mappedKeys.length).toBe(new Set(mappedKeys).size);
    // Every mapped panel is a real registry entry.
    for (const panel of Object.keys(PANEL_KIND_TO_BODY_KEY) as PanelKind[]) {
      expect(PANEL_REGISTRY[panel]).toBeDefined();
      expect(PANEL_REGISTRY[panel].kind).toBe(panel);
    }
  });

  it("member 2 — PanelId is exactly the registry PanelKinds plus 'blank'", () => {
    // Runtime companion to the compile-time pin: the persisted-slot set is the
    // live registry keys ∪ {blank}. Diverging PanelId from PanelKind now fails
    // at the type level (see _PanelIdIsPinned above).
    const expected = new Set<string>([...Object.keys(PANEL_REGISTRY), "blank"]);
    // Sample values typed as PanelId must all be in the expected set.
    const samples: PanelId[] = ["notes", "omni", "blank", "search", "errors"];
    for (const s of samples) expect(expected.has(s)).toBe(true);
    expect(expected.size).toBe(Object.keys(PANEL_REGISTRY).length + 1);
  });
});
