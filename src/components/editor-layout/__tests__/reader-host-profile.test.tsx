// @vitest-environment jsdom
//
// Reader HOST PROFILE contract (task 434).
//
// The Library reader is one `<EditorPane>` mounted from three hosts that want
// three different OPENING layouts. Before 434 the host was an unnamed
// positional boolean (`!isOuterTab` → `foldGutters`) re-derived by string
// prefix at two independent sites, and BOTH matched `outer:<libId>` tear-outs
// as well as papers — so "a paper popped out into its own tab" and "a torn-out
// Library tab" were one context and could not be given different defaults.
//
// This pins the three halves that keep them apart:
//
//   1. the scope GRAMMAR — minted and parsed in one module, so `readerHostKind`
//      is the exact inverse of the two scope builders;
//   2. the per-host OPENING LAYOUT, driven through the REAL `useReaderView`
//      (the wiring is the part that can silently stop asking);
//   3. the CENSUS — nothing outside the grammar module may re-derive the host
//      by prefix, which is precisely how the two spellings drifted.
//
// The dock leg has teeth beyond "outline and notes are in the stack": it also
// asserts `panelModes` + `panelMRU`, which only `placeInStack` writes. A
// hand-written `dockStack: {left:["outline"], right:["notes"]}` literal — the
// obvious shortcut — renders identically and silently drops the sentinel-clear
// / cap-eviction / MRU invariants the dock engine owns (task 273).
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

const WINDOW_ID = "test-window";
vi.mock("@/lib/multi-window/window-id", () => ({ getWindowId: () => WINDOW_ID }));
// useViewPrefs transitively pulls `@/lib/storage` (require("@/lib/storage-fsa")
// can't be aliased by vitest — see the vitest_extension_barrel_storage_mock memo).
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));
vi.mock("@/lib/multi-window/bus", () => ({
  publish: () => {},
  subscribe: () => () => {},
}));

import * as fs from "node:fs";
import * as path from "node:path";
import { createRef } from "react";
import { renderHook } from "@testing-library/react";
import type { EditorHandle } from "@/components/Editor";
import { useReaderView } from "../reader-view-prefs";
import {
  READER_HOST_PROFILES,
  applyReaderHostProfile,
  libraryReaderScope,
  paperReaderScope,
  readerHostKind,
  type ReaderHostKind,
} from "../reader-host";
import { READER_CHROME } from "../chrome-config";
import type { ViewPrefs } from "@/hooks/useViewPrefs";
import defaultPrefsJson from "@/hooks/useViewPrefs.defaults.json";
import { REPO_ROOT, codeOnly, trackedFiles } from "@/lib/__tests__/_source-scan";

const NULL_HANDLE_REF = createRef<EditorHandle | null>();
const GLOBAL_STORAGE_KEY = "virgil-view-prefs/global";
/** The SHIPPED defaults, read from the JSON SSOT rather than a hand copy —
 *  `DEFAULT_PREFS` is module-private in `useViewPrefs` and a suite is not a
 *  reason to export it. */
const SHIPPED = defaultPrefsJson as unknown as ViewPrefs;

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

/** Mount the REAL reader view-state for a host and hand back its live prefs. */
function mountReader(host: ReaderHostKind) {
  const { result } = renderHook(() =>
    useReaderView(null, NULL_HANDLE_REF, null, host),
  );
  return result.current.viewPrefs.prefs;
}

describe("reader scope grammar — minted and parsed in one place", () => {
  it("readerHostKind is the exact inverse of the two scope builders", () => {
    expect(readerHostKind(paperReaderScope("smith2020"))).toBe("popped-paper");
    expect(readerHostKind(libraryReaderScope("project"))).toBe("outer-library");
    // The pinned singleton Library outer tab carries a `library:`-prefixed id;
    // it is still a Library tear-out, never a paper.
    expect(readerHostKind(libraryReaderScope("library:__root__"))).toBe(
      "outer-library",
    );
  });

  it("a non-outer scope is the INLINE reader (the quiet reading view)", () => {
    // The Library tab's own reader passes a bare panel scope.
    expect(readerHostKind("")).toBe("inline");
    expect(readerHostKind("left")).toBe("inline");
    // An unrecognised string fails toward the quiet view rather than the
    // editing profile — a reader that silently docked panels for a scope
    // nobody minted would be worse than one that opens plain.
    expect(readerHostKind("something-else")).toBe("inline");
  });

  it("a citekey containing the outer prefix does not confuse the parse", () => {
    expect(readerHostKind(paperReaderScope("outer:weird"))).toBe("popped-paper");
  });
});

describe("per-host OPENING LAYOUT (through the real useReaderView)", () => {
  beforeAll(() => {
    installStorageShim("localStorage");
    installStorageShim("sessionStorage");
  });
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("inline reader: gutters folded, nothing docked, shipped omni default", () => {
    const prefs = mountReader("inline");
    expect(prefs.collapsedLeft).toBe(true);
    expect(prefs.collapsedRight).toBe(true);
    expect(prefs.dockStack).toEqual({ left: [], right: [] });
    expect(prefs.omniHideAllCards).toEqual(SHIPPED.omniHideAllCards);
  });

  it("torn-out LIBRARY tab keeps the inline reader's quiet defaults", () => {
    const prefs = mountReader("outer-library");
    expect(prefs.collapsedLeft).toBe(true);
    expect(prefs.collapsedRight).toBe(true);
    expect(prefs.dockStack).toEqual({ left: [], right: [] });
    expect(prefs.omniHideAllCards).toEqual(SHIPPED.omniHideAllCards);
  });

  it("popped-out PAPER opens like an editing session (Gabriel's ask)", () => {
    const prefs = mountReader("popped-paper");
    // (c) gutters out
    expect(prefs.collapsedLeft).toBe(false);
    expect(prefs.collapsedRight).toBe(false);
    // (b) omni view ON both sides
    expect(prefs.omniHideAllCards).toEqual({ left: false, right: false });
    // (a) the agreed default panel set, each on its own live side
    expect(prefs.dockStack.left).toContain("outline");
    expect(prefs.dockStack.right).toContain("notes");
  });

  it("the popped-paper dock runs through placeInStack, not a hand literal", () => {
    const prefs = mountReader("popped-paper");
    // Only `placeInStack` writes these. A hand-written `dockStack:` literal
    // renders the same bands and drops all three of the engine's invariants.
    expect(prefs.panelModes.outline).toBe("docked");
    expect(prefs.panelModes.notes).toBe("docked");
    expect(prefs.panelMRU.left).toContain("outline");
    expect(prefs.panelMRU.right).toContain("notes");
    // Invariant 1 (sentinel clear): a docked band's portal target only exists
    // in an expanded, NON-BLANK column.
    expect(prefs.blankLeft).toBe(false);
    expect(prefs.blankRight).toBe(false);
  });

  it("a docked panel lands on ITS OWN live side, not a hard-coded one", () => {
    // The user dragged Notes onto the LEFT rail. `seedEphemeralPrefs` folds the
    // saved placements in, so the profile must follow them (task 381: one side
    // fact per panel) rather than pinning Notes to the right.
    localStorage.setItem(
      GLOBAL_STORAGE_KEY,
      JSON.stringify({
        placements: [
          { id: "outline", side: "right" },
          { id: "notes", side: "left" },
        ],
      }),
    );
    const prefs = mountReader("popped-paper");
    expect(prefs.dockStack.left).toContain("notes");
    expect(prefs.dockStack.right).toContain("outline");
  });

  it("the ephemeral engine is untouched for a host that declares nothing", () => {
    // `initialSeed` is ephemeral-only and optional; the inline host's profile
    // writes the fold flags and nothing else, so every other key is the seed's.
    const prefs = mountReader("inline");
    expect(prefs.poppedOutPanels).toEqual([]);
    expect(prefs.panelMRU).toEqual({ left: [], right: [] });
  });
});

describe("profile premises (checked, not restated)", () => {
  it("every profile docks only panels the READER CHROME actually shows", () => {
    const visible = new Set(READER_CHROME.visiblePanelKinds ?? []);
    for (const [host, profile] of Object.entries(READER_HOST_PROFILES)) {
      for (const panel of profile.dock) {
        // A band whose icon the rail elides is unreachable: the user could
        // neither close nor reopen it.
        expect(
          visible.has(panel),
          `${host} docks "${panel}", which READER_CHROME hides`,
        ).toBe(true);
      }
    }
  });

  it("applyReaderHostProfile is pure — it never mutates the seed", () => {
    const seed = structuredClone(SHIPPED);
    const before = structuredClone(seed);
    applyReaderHostProfile(seed, "popped-paper");
    expect(seed).toEqual(before);
  });

  it("every ReaderHostKind has a profile row", () => {
    const kinds: ReaderHostKind[] = ["inline", "popped-paper", "outer-library"];
    for (const k of kinds) expect(READER_HOST_PROFILES[k]).toBeDefined();
    expect(Object.keys(READER_HOST_PROFILES).sort()).toEqual(kinds.sort());
  });
});

/**
 * THE LEG WITH TEETH.
 *
 * The grammar module was never the part that could misbehave — a call site
 * that re-derives the host by prefix is, and `scope.startsWith("outer:")`
 * type-checks perfectly while conflating the two outer hosts again. So: the
 * `"outer:"` scope prefix is spelled in exactly ONE production file, and the
 * two scope MINTERS are that file's alone.
 *
 * Allowlist EMPTY — a hit is READ-THE-GRAMMAR, never an entry here.
 */
describe("census — the reader scope grammar has one speller", () => {
  const GRAMMAR_FILE = "src/components/editor-layout/reader-host.ts";
  const production = [
    ...trackedFiles("src", /\.(ts|tsx)$/),
    ...trackedFiles("library", /\.(ts|tsx)$/),
  ].filter(
    (p) =>
      !p.includes(`${path.sep}__tests__${path.sep}`) &&
      !/\.test\.tsx?$/.test(path.basename(p)),
  );

  it("collected a real population (the census can see the tree)", () => {
    expect(production.length).toBeGreaterThan(300);
    expect(
      production.some((p) => p.endsWith(path.join("editor-layout", "reader-host.ts"))),
    ).toBe(true);
  });

  it('no production file outside the grammar spells the "outer:" scope prefix', () => {
    const offenders: string[] = [];
    for (const abs of production) {
      const rel = path.relative(REPO_ROOT, abs);
      if (rel === GRAMMAR_FILE) continue;
      // Strings KEPT: the drift lives in a string literal (`"outer:"`), which a
      // literal-blanking scan would erase — the task-205 unfalsifiable-leg trap.
      const src = codeOnly(fs.readFileSync(abs, "utf8"));
      const withStrings = fs.readFileSync(abs, "utf8");
      if (/`outer:\$\{|["'`]outer:/.test(src) || /startsWith\(\s*["'`]outer:/.test(withStrings)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the census can SEE the shape it forbids (synthetic canary)", () => {
    const canary = `const isOuter = scope.startsWith("outer:");`;
    expect(/startsWith\(\s*["'`]outer:/.test(canary)).toBe(true);
    const minted = 'const s = `outer:${libId}`;';
    expect(/`outer:\$\{/.test(minted)).toBe(true);
  });
});
