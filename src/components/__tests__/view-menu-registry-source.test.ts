// @vitest-environment node
//
// Static guard for the VIEW_PREF_REGISTRY deep fix (the audit's "regression
// guard"). Three invariants, checked against source text + the registry, so a
// future toggle that forgets to go through the registry/persistence pipeline
// fails CI instead of silently resetting on reload:
//
//   1. The ViewMenu has NO hand-rolled `useState` feeding a view toggle's
//      checked/onToggle — the disclosure `useState`s (expand/collapse) are the
//      only allowed ones; every PREF row is registry/prop-driven.
//   2. REGISTRY_GLOBAL_KEYS ⊆ the dev-prefs promotion whitelist (so every
//      global view pref participates in the personal-prefs promotion pipeline).
//   3. Every menu-bearing registry entry's label (+ per-value/member labels)
//      appears verbatim in the MenuBar source (the menu renders from the
//      registry, so a renamed label can't drift out of sync silently).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  VIEW_PREF_REGISTRY,
  REGISTRY_GLOBAL_KEYS,
} from "@/lib/view-prefs/registry";
import devPrefsRegistry from "@/lib/dev-prefs-registry.json";
import viewPrefsDefaults from "@/hooks/useViewPrefs.defaults.json";

const here = path.dirname(fileURLToPath(import.meta.url));
const MENUBAR_SRC = readFileSync(path.resolve(here, "../MenuBar.tsx"), "utf8");

describe("ViewMenu — no hand-rolled useState feeds a view toggle", () => {
  it("the only useState in MenuBar's ViewMenu are the disclosure expand/collapse flags", () => {
    // Collect every `useState` call in MenuBar source. The ViewMenu is allowed
    // to keep disclosure useState (group expand/collapse + the open flag +
    // placement), which are UI posture, NOT persisted prefs. Any useState whose
    // setter name looks like a pref toggle (`setShow*`) is the bug we forbid.
    const useStateNames = [...MENUBAR_SRC.matchAll(/const \[\s*([A-Za-z0-9_]+)\s*,\s*set([A-Za-z0-9_]+)\s*\]\s*=\s*useState/g)]
      .map((m) => m[1]);
    // Forbid a checked-state useState (a pref read backed by local component
    // state). The legitimate ones are: open, *Expanded, placement.
    const ALLOWED = /^(open|placement|.*Expanded)$/;
    const offenders = useStateNames.filter((n) => !ALLOWED.test(n));
    expect(offenders).toEqual([]);
  });

  it("MenuBar declares no `setShowParTitles` / `setShowLatexComments` state (Bug 1/2 retired)", () => {
    expect(MENUBAR_SRC).not.toMatch(/setShowParTitles/);
    expect(MENUBAR_SRC).not.toMatch(/setShowLatexComments/);
  });
});

describe("REGISTRY_GLOBAL_KEYS ⊆ promotion whitelist", () => {
  it("every global registry key is in the dev-prefs-registry whitelist", () => {
    const promotable = devPrefsRegistry.promotable.find(
      (p) => p.storageKey === "virgil-view-prefs/global" && p.strategy === "whitelist",
    );
    expect(promotable).toBeTruthy();
    const whitelist = new Set((promotable as { whitelist: string[] }).whitelist);
    const missing = REGISTRY_GLOBAL_KEYS.filter((k) => !whitelist.has(k));
    expect(missing).toEqual([]);
  });
});

describe("menu-bearing registry labels are SOURCED from the registry, not hardcoded", () => {
  // The menu rows now read their labels from VIEW_PREF_REGISTRY (single source
  // of truth), so the literal label strings live in registry.ts and the
  // MenuBar references them symbolically. The guarantee we want is that the
  // MenuBar does NOT hand-write the menu-row label strings as literals (which
  // would let them drift out of sync with persistence). The actual *rendered*
  // labels are pinned by menubar-dropdowns-keyboard.test.tsx.
  it("MenuBar references VIEW_PREF_REGISTRY for its rows + labels", () => {
    expect(MENUBAR_SRC).toMatch(/VIEW_PREF_REGISTRY/);
    // The Display rows, marginalia/highlight members, and divider members/values
    // are all enumerated from the registry.
    expect(MENUBAR_SRC).toMatch(/VIEW_PREF_REGISTRY\.dividerLevels\.members/);
    expect(MENUBAR_SRC).toMatch(/VIEW_PREF_REGISTRY\.dividerWidth\.values/);
  });

  it("the per-value/member label strings are NOT hardcoded as literals in MenuBar", () => {
    // A sampling of value/member labels that used to be inline literals
    // (DIVIDER_*_LABELS object bodies + the per-type ternaries) and must now
    // come from the registry. If any reappears as a literal, the SSOT leaked.
    const FORMERLY_INLINE = [
      '"Parts"', '"Chapters"', '"Subsections"', '"Subsubsections"',
      '"Paragraph headings"', '"Subparagraph headings"',
      '"Full width"', '"Mid width"', '"Text width"',
    ];
    const leaked = FORMERLY_INLINE.filter((lit) => MENUBAR_SRC.includes(lit));
    expect(leaked).toEqual([]);
  });

  it("every menu-bearing registry entry defines a non-empty label", () => {
    // Structural sanity: a menu row can't render a blank label.
    const blank: string[] = [];
    for (const [key, def] of Object.entries(VIEW_PREF_REGISTRY)) {
      if (!("menu" in def) || def.menu === undefined) continue;
      if (!def.label) blank.push(key);
      if (def.kind === "enum") {
        for (const [v, lbl] of Object.entries(def.valueLabels)) {
          if (!lbl) blank.push(`${key}.valueLabels.${v}`);
        }
      }
      if (def.kind === "set") {
        for (const [m, lbl] of Object.entries(def.memberLabels)) {
          if (!lbl) blank.push(`${key}.memberLabels.${m}`);
        }
      }
    }
    expect(blank).toEqual([]);
  });
});

describe("showCardTitles — the page-level card +T pref mirrors showParTitles", () => {
  it("is a global Display toggle, registered like its paragraph sibling", () => {
    const def = VIEW_PREF_REGISTRY.showCardTitles;
    expect(def.kind).toBe("toggle");
    expect(def.scope).toBe("global");
    expect(def.menu).toBe("display");
    expect(def.label).toBe("Card titles");
    // Global → must ride the personal-prefs promotion whitelist (the same
    // invariant enforced generically above; pinned explicitly here).
    expect(REGISTRY_GLOBAL_KEYS).toContain("showCardTitles");
  });

  it("registry default is byte-identical with useViewPrefs.defaults.json (release-snapshot contract)", () => {
    // The promotion pipeline is byte-stable against the JSON; a divergence here
    // is the release_prefs_snapshot gotcha. Default `true` also preserves the
    // current always-on `+T` behavior (the affordance shows unless toggled off).
    expect(VIEW_PREF_REGISTRY.showCardTitles.default).toBe(true);
    expect((viewPrefsDefaults as Record<string, unknown>).showCardTitles).toBe(true);
    expect(VIEW_PREF_REGISTRY.showCardTitles.default).toBe(
      (viewPrefsDefaults as Record<string, unknown>).showCardTitles,
    );
  });
});
