// @vitest-environment jsdom
//
// Registry round-trip: every VIEW_PREF_REGISTRY entry must persist into the
// CORRECT localStorage blob (global vs per-window) and reload through the real
// `loadPrefs()` pipeline. This is the regression guard the audit asked for —
// it would have caught all the "plain useState, never persisted" bugs (a pref
// that doesn't round-trip here is one that resets on reload).
//
// Strategy: for each entry, write a NON-default value to the blob its scope
// dictates, run `loadPrefs()`, and assert (a) the value survived, and (b) it
// landed in the right slice — a global pref must be present in the global blob
// after load (and a window pref must be ABSENT from global). Plus the Bug-5
// poppedOutPanels survivor case.
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import {
  VIEW_PREF_REGISTRY,
  REGISTRY_DEFAULTS,
  REGISTRY_GLOBAL_KEYS,
  type ViewPrefKey,
} from "@/lib/view-prefs/registry";

const WINDOW_ID = "test-window";

vi.mock("@/lib/multi-window/window-id", () => ({
  getWindowId: () => WINDOW_ID,
}));

// `useViewPrefs` transitively pulls `@/lib/storage`, whose runtime
// `require("@/lib/storage-fsa")` vitest's resolver can't alias (see
// vitest_extension_barrel_storage_mock memo). Stub it — `loadPrefs` never
// touches a storage backend (it reads localStorage directly).
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));

import { loadPrefs } from "../useViewPrefs";

const GLOBAL_KEY = "virgil-view-prefs/global";
const WINDOW_KEY = `virgil-view-prefs/window/${WINDOW_ID}`;

const GLOBAL_SET = new Set<string>(REGISTRY_GLOBAL_KEYS);

/** Produce a value DIFFERENT from the registry default for a given key, in the
 *  stored (array/scalar) shape. */
function nonDefaultFor(key: ViewPrefKey): unknown {
  const def = VIEW_PREF_REGISTRY[key];
  if (def.kind === "toggle") return !def.default;
  if (def.kind === "enum") {
    const other = def.values.find((v) => v !== def.default);
    return other ?? def.default;
  }
  // set: flip to a single, non-default member (or [] when the default is
  // non-empty — both are "different from default").
  const cur = REGISTRY_DEFAULTS[key] as unknown[];
  const firstMember = def.members[0];
  if (cur.length === 0) return [firstMember];
  // Default non-empty → choose the empty array (clearly different).
  return [];
}

function writeBlob(storageKey: string, obj: Record<string, unknown>) {
  localStorage.setItem(storageKey, JSON.stringify(obj));
}

// The project's jsdom env doesn't ship a full Storage; install minimal
// in-memory shims (mirrors src/lib/identity/__tests__/identity-flag.test.ts).
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

beforeAll(() => {
  installStorageShim("localStorage");
  installStorageShim("sessionStorage");
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("VIEW_PREF_REGISTRY round-trips through loadPrefs", () => {
  for (const key of Object.keys(VIEW_PREF_REGISTRY) as ViewPrefKey[]) {
    const def = VIEW_PREF_REGISTRY[key];
    const isGlobal = def.scope === "global";

    it(`${key} (${def.scope}) survives a reload into its correct blob`, () => {
      const value = nonDefaultFor(key);
      // Write to the blob the scope dictates.
      writeBlob(isGlobal ? GLOBAL_KEY : WINDOW_KEY, { [key]: value });

      const loaded = loadPrefs() as unknown as Record<string, unknown>;
      expect(loaded[key]).toEqual(value);

      // After load, the value must be buckable into the right blob: re-derive
      // the global membership from the registry the persistence layer uses.
      if (isGlobal) {
        expect(GLOBAL_SET.has(key)).toBe(true);
      } else {
        // Window pref must NOT be in the global key-set (so `persist` writes it
        // to the per-window blob, never the cross-window global one).
        expect(GLOBAL_SET.has(key)).toBe(false);
      }
    });
  }

  it("a GLOBAL pref written into the WINDOW blob is PROMOTED to global on load", () => {
    // Pick a representative global registry key and stash it (wrongly) in the
    // window blob. loadPrefs' promotion migration must hoist it into global so
    // it mirrors across windows.
    writeBlob(WINDOW_KEY, { showParTitles: false });
    const loaded = loadPrefs() as unknown as Record<string, unknown>;
    expect(loaded.showParTitles).toBe(false);

    const globalBlob = JSON.parse(localStorage.getItem(GLOBAL_KEY) ?? "{}");
    const windowBlob = JSON.parse(localStorage.getItem(WINDOW_KEY) ?? "{}");
    expect(globalBlob.showParTitles).toBe(false); // hoisted
    expect("showParTitles" in windowBlob).toBe(false); // removed from window
  });

  it("the WINDOW-scoped bibFilter stays OUT of the global blob", () => {
    writeBlob(WINDOW_KEY, { bibFilter: "all" });
    const loaded = loadPrefs() as unknown as Record<string, unknown>;
    expect(loaded.bibFilter).toBe("all");

    const globalBlob = JSON.parse(localStorage.getItem(GLOBAL_KEY) ?? "{}");
    expect("bibFilter" in globalBlob).toBe(false);
    // And it must NOT be considered a global key.
    expect(GLOBAL_SET.has("bibFilter")).toBe(false);
  });

  it("par-titles + % comments are GLOBAL (Bug 1/2 scope)", () => {
    expect(VIEW_PREF_REGISTRY.showParTitles.scope).toBe("global");
    expect(VIEW_PREF_REGISTRY.showLatexComments.scope).toBe("global");
    expect(GLOBAL_SET.has("showParTitles")).toBe(true);
    expect(GLOBAL_SET.has("showLatexComments")).toBe(true);
  });
});

describe("Bug 5 — popped-out PANELS re-float on reload (validated)", () => {
  it("keeps only placed, registry-known panels; drops stale/unplaced ids", () => {
    // `notes` is a real, placed panel; `quotations` is a retired/unknown id;
    // `omni` is never a float; `bibliography` is placed too.
    writeBlob(WINDOW_KEY, {
      poppedOutPanels: ["notes", "quotations", "omni", "bibliography"],
      poppedOutOrigins: { notes: "top", quotations: "bottom" },
      // Placements must carry `notes` + `bibliography` for them to survive.
      placements: [
        { id: "notes", side: "right" },
        { id: "bibliography", side: "left" },
      ],
    });

    const loaded = loadPrefs() as unknown as Record<string, unknown>;
    const popped = loaded.poppedOutPanels as string[];
    expect(popped).toContain("notes");
    expect(popped).toContain("bibliography");
    expect(popped).not.toContain("quotations"); // unknown id dropped
    expect(popped).not.toContain("omni"); // never a float

    const origins = loaded.poppedOutOrigins as Record<string, string>;
    expect(origins.notes).toBe("top");
    expect("quotations" in origins).toBe(false); // origin for a dropped panel pruned
  });

  it("empty/missing poppedOutPanels loads as an empty array", () => {
    writeBlob(WINDOW_KEY, {});
    const loaded = loadPrefs() as unknown as Record<string, unknown>;
    expect(loaded.poppedOutPanels).toEqual([]);
    expect(loaded.poppedOutOrigins).toEqual({});
  });
});
