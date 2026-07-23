// @vitest-environment jsdom
//
// Vocabulary / key-list lockstep guards (audit-218 — the "derive, don't
// duplicate" class audit-059 closed for `PanelId`, applied to the two remaining
// satellite lists in `useViewPrefs`).
//
// Both members are the same shape: a per-value / per-key fact re-listed by hand
// where a runtime enumeration already owns it. The source fix inverts each list
// so the runtime value is the SSOT (M1: `ALL_HIGHLIGHT_TYPES` → `HighlightType`
// is derived; M2: `seedEphemeralPrefs` loops `MARGIN_PREF_KEYS`). These tests
// pin the relationships those fixes rely on so they can't silently drift back.
import { describe, it, expect, vi } from "vitest";

const WINDOW_ID = "test-window";
vi.mock("@/lib/multi-window/window-id", () => ({ getWindowId: () => WINDOW_ID }));
// useViewPrefs transitively pulls `@/lib/storage` (require("@/lib/storage-fsa")
// can't be aliased by vitest — see vitest_extension_barrel_storage_mock memo).
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));

import {
  ALL_HIGHLIGHT_TYPES,
  MARGIN_PREF_KEYS,
  STRUCTURAL_GLOBAL_PREF_KEYS,
  type HighlightType,
} from "../useViewPrefs";
import { VIEW_PREF_REGISTRY } from "@/lib/view-prefs/registry";

describe("audit-218 · view-prefs vocabulary lockstep", () => {
  // ── M1 — `ALL_HIGHLIGHT_TYPES` ↔ `HighlightType` union ──────────────────
  describe("M1 · highlight types (array is SSOT, union derived)", () => {
    it("has no duplicate members", () => {
      expect(new Set(ALL_HIGHLIGHT_TYPES).size).toBe(ALL_HIGHLIGHT_TYPES.length);
    });

    it("every union member is enumerated (compile-time exhaustiveness map)", () => {
      // If a kind is ever added to `HighlightType` (now derived FROM the array,
      // so this can only happen by editing the array) this `satisfies` object
      // must gain the matching key or the build fails — the omission direction
      // TS could not catch when the union was hand-typed alongside the array.
      const seen = {
        note: true,
        todo: true,
        comment: true,
        cut: true,
        report: true,
      } satisfies Record<HighlightType, true>;
      // Runtime twin of the same statement: the array covers exactly the keys.
      expect([...ALL_HIGHLIGHT_TYPES].sort()).toEqual(Object.keys(seen).sort());
    });

    it("the registry's menu subset is a subset of the full highlight vocabulary", () => {
      // `hiddenHighlightTypes.members` is a DELIBERATELY smaller menu (no
      // `report`); it must never list a kind the full vocabulary lacks.
      const menu = VIEW_PREF_REGISTRY.hiddenHighlightTypes.members;
      for (const m of menu) {
        expect(ALL_HIGHLIGHT_TYPES).toContain(m);
      }
      // ...and it is genuinely a proper subset (documents the report omission).
      expect(menu.length).toBeLessThan(ALL_HIGHLIGHT_TYPES.length);
    });
  });

  // ── M2 — page-geometry key list subset ──────────────────────────────────
  describe("M2 · margin keys are a subset of the structural globals", () => {
    it("MARGIN_PREF_KEYS ⊂ STRUCTURAL_GLOBAL_PREF_KEYS", () => {
      // The ephemeral Reader's geometry slice (`MARGIN_PREF_KEYS`) is, by
      // construction, a narrow slice of the structural globals. If a margin key
      // were added to `MARGIN_PREF_KEYS` but not declared global, the ephemeral
      // seed / editor→Reader sync would fold a key that never persists.
      const structural = new Set<string>(STRUCTURAL_GLOBAL_PREF_KEYS);
      expect(MARGIN_PREF_KEYS.every((k) => structural.has(k))).toBe(true);
    });
  });
});
