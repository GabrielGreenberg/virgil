// @vitest-environment jsdom
//
// The view-pref WRITER SSOT (task 274).
//
// `VIEW_PREF_REGISTRY` generates the store shape, the shipped defaults and the
// global-key set; since task 274 it also owns WRITING. Three doors — one per
// `kind` — and nothing else touches a registry field:
//
//     setViewPref(key, value)            any kind
//     toggleViewPref(key)                kind: "toggle"
//     toggleViewPrefMember(key, member)  kind: "set"
//
// Ten hand-written twins used to sit beside them (`toggleParTitles`,
// `toggleLatexComments`, `toggleMarginalia`, `toggleHeadingLabels`,
// `setShowHighlights`, `setDividerWidth`, `setBibFilter`,
// `toggleHighlightType`, `toggleMarginaliaType`, `toggleDividerLevel`), each
// byte-equivalent to the generic path for its `kind` and each threaded through
// EditorLayout → EditorPane → MenuBar by name. Nothing forced the copies to
// agree, and the three set-member togglers were three copies of one
// includes/filter/append.
//
// THE CENSUS IS THE LEG WITH TEETH. The three doors were never the part that
// could misbehave — an eleventh twin written beside them is, and no runtime
// test can see that. So legs 1 and 2 read SOURCE:
//
//   1. No spread-update in `useViewPrefs.ts` may name a registry key as an
//      object-literal key. The three doors write `{ ...p, [key]: … }` with a
//      COMPUTED key, so a registry key spelled literally in a `key:` position
//      is, by construction, a twin.
//   2. The ten retired setter names — and the twelve per-pref MenuBar props
//      they fed — have zero occurrences in either silo.
//
// Legs 3+ are the behavioural contract, DERIVED from the registry (swept per
// entry rather than enumerated) so a new pref is covered by declaration alone.
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  VIEW_PREF_REGISTRY,
  VIEW_PREF_KEYS,
  toggleRowsInMenuGroup,
  type ViewPrefKey,
  type SetViewPrefKey,
} from "@/lib/view-prefs/registry";
import { codeOnly } from "@/lib/__tests__/_source-scan";

const WINDOW_ID = "test-window";
vi.mock("@/lib/multi-window/window-id", () => ({ getWindowId: () => WINDOW_ID }));
// useViewPrefs transitively pulls `@/lib/storage` (its runtime
// `require("@/lib/storage-fsa")` can't be aliased by vitest — see the
// vitest_extension_barrel_storage_mock memo).
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));
// The cross-window bus uses BroadcastChannel (absent in jsdom).
vi.mock("@/lib/multi-window/bus", () => ({
  publish: () => {},
  subscribe: () => () => {},
}));

import { renderHook, act } from "@testing-library/react";
import { useViewPrefs } from "../useViewPrefs";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "../../..");
const HOOK_SRC = readFileSync(path.resolve(here, "../useViewPrefs.ts"), "utf8");

/* ── Leg 1: no literal registry key in a spread-update ─────────────────── */

/** Every `<name>:` object-literal key in comment- AND string-stripped source.
 *  Strings are blanked because the hook's legacy-key migration table names
 *  registry fields as string VALUES (`field: "showHeadingLabels"`), which is a
 *  read-side mapping, not a write. The lookbehind drops property ACCESSES
 *  (`p.showMarginalia`) and keeps only key positions. */
function literalObjectKeys(src: string): string[] {
  return [...codeOnly(src).matchAll(/(?<![\w.$])([A-Za-z_$][\w$]*)\s*:/g)].map(
    (m) => m[1],
  );
}

describe("useViewPrefs writes every registry field BY KEY", () => {
  it("no registry key is spelled as a literal object key anywhere in the hook", () => {
    const registry = new Set<string>(VIEW_PREF_KEYS);
    const offenders = [...new Set(literalObjectKeys(HOOK_SRC))].filter((k) =>
      registry.has(k),
    );
    expect(offenders).toEqual([]);
  });

  it("the needle CAN see a twin (canary + swallow self-check)", () => {
    // Synthetic fixture, not a live line: a canary standing on the defect
    // evaporates the moment the defect is fixed.
    const fixture = `
      const toggleParTitles = useCallback(() => {
        update((p) => ({ ...p, showParTitles: !p.showParTitles }));
      }, [update]);
    `;
    expect(literalObjectKeys(fixture)).toContain("showParTitles");

    // …and the stripper didn't swallow the file: the hook still writes plenty
    // of NON-registry fields as literal keys, and those must still be seen.
    const seen = new Set(literalObjectKeys(HOOK_SRC));
    expect(seen.has("collapsedLeft")).toBe(true);
    expect(seen.has("floatPositions")).toBe(true);
    expect(seen.size).toBeGreaterThan(50);
  });
});

/* ── Leg 2: the retired names are dead in both silos ───────────────────── */

/** The ten retired hook setters + the twelve per-pref MenuBar props they fed.
 *  A reappearance is a twin, whichever layer it lands on.
 *
 *  The needle is name-EXACT (`\b`-bounded), which is the right precision here:
 *  `BibliographyPanel`'s `onSetBibFilter` is a presentational prop the host
 *  binds to `setViewPref("bibFilter", v)`, not a second store door — the panel
 *  renders the control, it doesn't own the pref. What must not come back is a
 *  writer on the HOOK named `setBibFilter`, and that is what this catches. */
const RETIRED_NAMES = [
  // hook setters
  "toggleParTitles",
  "toggleLatexComments",
  "toggleMarginalia",
  "toggleHeadingLabels",
  "setShowHighlights",
  "setDividerWidth",
  "setBibFilter",
  "toggleHighlightType",
  "toggleMarginaliaType",
  "toggleDividerLevel",
  // per-pref MenuBar / bundle props
  "onToggleParTitles",
  "onToggleCardTitles",
  "onToggleLatexComments",
  "onToggleHeadingLabels",
  "onToggleOmniDimResting",
  "onToggleCardOutline",
  "onToggleMarginalia",
  "onToggleMarginaliaType",
  "onToggleHighlights",
  "onToggleHighlightType",
  "onToggleDividerLevel",
  "onSetDividerWidth",
] as const;

function sourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
  };
  walk(root);
  return out;
}

describe("the retired per-pref setters/props stay retired", () => {
  it("no production file in src/ or library/ names one", () => {
    const files = [
      ...sourceFiles(path.join(REPO, "src")),
      ...sourceFiles(path.join(REPO, "library")),
    ].filter((f) => !/__tests__|\.test\.tsx?$/.test(f));

    const hits: string[] = [];
    for (const file of files) {
      const src = codeOnly(readFileSync(file, "utf8"));
      for (const name of RETIRED_NAMES) {
        if (new RegExp(`(?<![\\w$])${name}(?![\\w$])`).test(src)) {
          hits.push(`${path.relative(REPO, file)} → ${name}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});

/* ── Leg 3: the behavioural contract, swept from the registry ──────────── */

// The project's jsdom env doesn't ship a full Storage; install in-memory shims
// (mirrors view-prefs-registry-roundtrip.test.ts).
function installStorageShim(name: "localStorage" | "sessionStorage") {
  const store = new Map<string, string>();
  Object.defineProperty(window, name, {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
}

const TOGGLE_KEYS = VIEW_PREF_KEYS.filter((k) => VIEW_PREF_REGISTRY[k].kind === "toggle");
const ENUM_KEYS = VIEW_PREF_KEYS.filter((k) => VIEW_PREF_REGISTRY[k].kind === "enum");
const SET_KEYS = VIEW_PREF_KEYS.filter(
  (k) => VIEW_PREF_REGISTRY[k].kind === "set",
) as SetViewPrefKey[];

describe("the three writers cover every registry kind", () => {
  beforeAll(() => {
    installStorageShim("localStorage");
    installStorageShim("sessionStorage");
  });
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("every kind is reachable — the sweep can't pass vacuously", () => {
    expect(TOGGLE_KEYS.length).toBeGreaterThan(0);
    expect(ENUM_KEYS.length).toBeGreaterThan(0);
    expect(SET_KEYS.length).toBeGreaterThan(0);
  });

  it.each(TOGGLE_KEYS)("toggleViewPref flips %s", (key) => {
    const { result } = renderHook(() => useViewPrefs());
    const before = result.current.prefs[key];
    act(() => result.current.toggleViewPref(key));
    expect(result.current.prefs[key]).toBe(!before);
    act(() => result.current.toggleViewPref(key));
    expect(result.current.prefs[key]).toBe(before);
  });

  it.each(ENUM_KEYS)("setViewPref writes every value of %s", (key) => {
    const def = VIEW_PREF_REGISTRY[key];
    if (def.kind !== "enum") throw new Error("unreachable");
    const { result } = renderHook(() => useViewPrefs());
    for (const value of def.values) {
      act(() => result.current.setViewPref(key, value as never));
      expect(result.current.prefs[key]).toBe(value);
    }
  });

  it.each(SET_KEYS)("toggleViewPrefMember adds then removes every member of %s", (key) => {
    const def = VIEW_PREF_REGISTRY[key];
    if (def.kind !== "set") throw new Error("unreachable");
    const { result } = renderHook(() => useViewPrefs());
    for (const member of def.members) {
      const list = () => result.current.prefs[key] as readonly (string | number)[];
      const had = list().includes(member);
      act(() => result.current.toggleViewPrefMember(key, member as never));
      expect(list().includes(member)).toBe(!had);
      act(() => result.current.toggleViewPrefMember(key, member as never));
      expect(list().includes(member)).toBe(had);
    }
  });
});

describe("the writers guard their kind, and their non-guards are deliberate", () => {
  beforeAll(() => {
    installStorageShim("localStorage");
    installStorageShim("sessionStorage");
  });
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("toggleViewPref is a no-op on a non-toggle key", () => {
    const { result } = renderHook(() => useViewPrefs());
    const before = result.current.prefs.dividerWidth;
    act(() => result.current.toggleViewPref("dividerWidth"));
    expect(result.current.prefs.dividerWidth).toBe(before);
  });

  it("toggleViewPrefMember is a no-op on a non-set key", () => {
    const { result } = renderHook(() => useViewPrefs());
    const before = result.current.prefs.showMarginalia;
    act(() =>
      // Deliberately off-kind: the runtime guard is what's under test, so the
      // type has to be stepped around to reach it.
      result.current.toggleViewPrefMember(
        "showMarginalia" as SetViewPrefKey,
        "x" as never,
      ),
    );
    expect(result.current.prefs.showMarginalia).toBe(before);
  });

  it("setViewPref refuses a key the registry doesn't declare", () => {
    const { result } = renderHook(() => useViewPrefs());
    act(() => result.current.setViewPref("notAPref" as ViewPrefKey, true as never));
    expect(
      (result.current.prefs as unknown as Record<string, unknown>).notAPref,
    ).toBeUndefined();
  });

  it("a member OUTSIDE `def.members` still toggles — the stated non-validation", () => {
    // The registry's own header says a stored `set` value may include members
    // the MENU doesn't render (the "report" marginalia type). Validating
    // membership would silently no-op exactly those, so the door deliberately
    // doesn't. Pinned so a future "tightening" is a decision, not a slip.
    const { result } = renderHook(() => useViewPrefs());
    expect(VIEW_PREF_REGISTRY.hiddenMarginaliaTypes.members).not.toContain("report");
    act(() =>
      result.current.toggleViewPrefMember("hiddenMarginaliaTypes", "report" as never),
    );
    expect(result.current.prefs.hiddenMarginaliaTypes).toContain("report");
  });
});

/* ── Leg 4: the menu-row ids the Display block is derived from ─────────── */

describe("every menu-bearing toggle declares a unique menuRowId", () => {
  it("ids are present and distinct", () => {
    const ids = VIEW_PREF_KEYS.filter(
      (k) => VIEW_PREF_REGISTRY[k].kind === "toggle",
    ).map((k) => (VIEW_PREF_REGISTRY[k] as { menuRowId: string }).menuRowId);
    expect(ids.every((id) => id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("the Display block is derived from the registry, in declaration order", () => {
    // The rows the View menu renders ARE this list; MenuBar hand-listed them
    // (id + key + label) before task 274.
    const rows = toggleRowsInMenuGroup("display");
    const expected = VIEW_PREF_KEYS.filter((k) => {
      const d = VIEW_PREF_REGISTRY[k];
      return d.kind === "toggle" && d.menu === "display";
    });
    expect(rows.map((r) => r.key)).toEqual(expected);
    expect(rows.map((r) => r.id)).toEqual(
      expected.map((k) => (VIEW_PREF_REGISTRY[k] as { menuRowId: string }).menuRowId),
    );
  });
});
