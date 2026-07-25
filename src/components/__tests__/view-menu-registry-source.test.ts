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
//   2. The dev-prefs promotion whitelist matches the registry's `promote` flag
//      both ways: every PROMOTED global key is whitelisted, and every key flagged
//      `promote: false` is NOT (its shipped default is frozen at the registry
//      value — the showParTitles drift, task 057).
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
  REGISTRY_PROMOTED_GLOBAL_KEYS,
} from "@/lib/view-prefs/registry";
import devPrefsRegistry from "@/lib/dev-prefs-registry.json";
import viewPrefsDefaults from "@/hooks/useViewPrefs.defaults.json";
import { PANEL_REGISTRY } from "@/panels/panel-registry";

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

describe("promotion whitelist ⇔ registry `promote` flag", () => {
  const promotable = devPrefsRegistry.promotable.find(
    (p) => p.storageKey === "virgil-view-prefs/global" && p.strategy === "whitelist",
  );
  const whitelist = new Set((promotable as { whitelist: string[] } | undefined)?.whitelist ?? []);

  it("every PROMOTED global registry key is in the dev-prefs-registry whitelist", () => {
    expect(promotable).toBeTruthy();
    const missing = REGISTRY_PROMOTED_GLOBAL_KEYS.filter((k) => !whitelist.has(k));
    expect(missing).toEqual([]);
  });

  it("every `promote: false` global key is ABSENT from the whitelist (drift-proof, task 057)", () => {
    // A frozen pref must not sit on the promotion whitelist, or a promote-defaults
    // run would re-fold Gabriel's personal snapshot over its shipped default and
    // re-drift it (the exact showParTitles regression this closes).
    const optedOut = REGISTRY_GLOBAL_KEYS.filter(
      (k) => !REGISTRY_PROMOTED_GLOBAL_KEYS.includes(k),
    );
    const leaked = optedOut.filter((k) => whitelist.has(k));
    expect(leaked).toEqual([]);
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
  // Registry↔JSON default byte-identity is now asserted generically for EVERY
  // key below ("registry ↔ shipped-defaults byte-identity"), not pinned per-key.
});

describe("cardOutlineChrome — the OPT-IN card hover/select outline (task 026)", () => {
  it("is a global Display toggle, registered like its Display siblings", () => {
    const def = VIEW_PREF_REGISTRY.cardOutlineChrome;
    expect(def.kind).toBe("toggle");
    expect(def.scope).toBe("global");
    expect(def.menu).toBe("display");
    expect(def.label).toBe("Card outline");
    // Global → must ride the personal-prefs promotion whitelist.
    expect(REGISTRY_GLOBAL_KEYS).toContain("cardOutlineChrome");
    // Default OFF (no colored outline); byte-identity with the JSON is asserted
    // generically below.
    expect(VIEW_PREF_REGISTRY.cardOutlineChrome.default).toBe(false);
  });
});

describe("registry ↔ shipped-defaults byte-identity (release-snapshot contract)", () => {
  // ONE generic guard replacing the former per-key byte-identity pins (task 057).
  // At runtime DEFAULT_PREFS spreads REGISTRY_DEFAULTS first, then the JSON LAST,
  // so the JSON value WINS. If the JSON diverges from a registry-declared default,
  // a brand-new user silently gets a value the registry never intended — the
  // showParTitles drift (a promoted personal snapshot flipped the shipped default
  // true→false while the registry still declared true, and nothing caught it
  // because byte-identity was pinned by hand, one key at a time, and this key was
  // never pinned). Assert equality for EVERY registry key the JSON carries, so any
  // future drift of this class fails CI — not just the three keys once pinned.
  const json = viewPrefsDefaults as Record<string, unknown>;
  for (const [key, def] of Object.entries(VIEW_PREF_REGISTRY)) {
    // Keys the JSON legitimately omits fall back to REGISTRY_DEFAULTS at runtime
    // (e.g. bibFilter — window-scope, panel-local — is correctly absent). Skip
    // them; only keys the JSON actually ships must match byte-for-byte.
    if (!(key in json)) continue;
    it(`${key}: registry default equals useViewPrefs.defaults.json`, () => {
      const registryDefault = def.kind === "set" ? [...def.default] : def.default;
      expect(json[key]).toEqual(registryDefault);
    });
  }
});

describe("placements[].side ⇔ PANEL_REGISTRY.defaultStripSide (release-snapshot contract, task 223)", () => {
  // Sibling of the byte-identity block above, for the STRUCTURAL `placements`
  // key (not a VIEW_PREF_REGISTRY entry, so the loop above doesn't reach it).
  //
  // The shipped `placements` default (useViewPrefs.defaults.json, spread into
  // DEFAULT_PREFS) declares each panel's default sidebar strip side — the SAME
  // fact PANEL_REGISTRY[id].defaultStripSide owns (its doc-comment literally
  // says it "Mirrors useViewPrefs.DEFAULT_PREFS.placements"). Nothing derives
  // one from the other, so the two are hand-kept parallel lists. They agree
  // today, but `placements` is on the promote-defaults whitelist
  // (dev-prefs-registry.json), so a `/cleanup-virgil` run re-bakes the personal
  // snapshot's placements over the shipped JSON — the moment a panel dragged to
  // the other strip lands in the snapshot, the shipped `side` silently diverges
  // from the registry (the exact showParTitles / task-057 class, now for
  // `placements`). And the authority is genuinely SPLIT at runtime: the Library
  // Reader sources strip sides straight from `defaultStripSide`
  // (reader-view-prefs.ts), while the editor lets a JSON `placements` side win
  // (useViewPrefs.ts `side ?? placement?.side ?? registryEntry?.defaultStripSide`)
  // — so a one-sided drift ships OPPOSITE fresh-user defaults in editor vs
  // Reader / jump-dock. This pin makes that drift fail CI.
  //
  // `placements` legitimately owns ONE thing the registry does not — the strip
  // display ORDER (the JSON order differs from registry declaration order and is
  // load-bearing), so we pin only `side`, never order.
  type Placement = { id: string; side: "left" | "right" };
  const placements = ((viewPrefsDefaults as { placements?: Placement[] }).placements ?? []);
  const stripSide = (id: string): "left" | "right" | null | undefined =>
    (PANEL_REGISTRY as Record<string, { defaultStripSide: "left" | "right" | null } | undefined>)[id]
      ?.defaultStripSide;

  it("the JSON actually ships a non-empty placements array", () => {
    expect(placements.length).toBeGreaterThan(0);
  });

  for (const { id, side } of placements) {
    it(`${id}: shipped side "${side}" equals PANEL_REGISTRY.defaultStripSide`, () => {
      expect(
        id in PANEL_REGISTRY,
        `placements lists panel "${id}" that is not in PANEL_REGISTRY`,
      ).toBe(true);
      expect(stripSide(id)).toBe(side);
    });
  }

  it("placements ⇔ strip panels is a bijection (no missing, dup, or null-side/omni leak)", () => {
    const placedIds = placements.map((p) => p.id);

    const dupes = placedIds.filter((id, i) => placedIds.indexOf(id) !== i);
    expect(dupes, `duplicate placements rows: ${dupes.join(", ")}`).toEqual([]);

    // Every panel with a real (non-null) default strip side must ship a row, so
    // a fresh user gets a stable, complete strip order — a missing row would
    // fall back to `defaultStripSide` at load but leave the icon order to chance.
    const stripPanels = (Object.keys(PANEL_REGISTRY) as (keyof typeof PANEL_REGISTRY)[]).filter(
      (k) => PANEL_REGISTRY[k].defaultStripSide !== null,
    );
    const placedSet = new Set(placedIds);
    const missing = stripPanels.filter((k) => !placedSet.has(k));
    expect(missing, `strip panels missing from placements: ${missing.join(", ")}`).toEqual([]);

    // …and no null-side panel (omni — a presentation pod, never a strip) leaked
    // into placements.
    const nullSideLeak = placedIds.filter((id) => stripSide(id) === null);
    expect(
      nullSideLeak,
      `null-side (non-strip) panels leaked into placements: ${nullSideLeak.join(", ")}`,
    ).toEqual([]);
  });
});
