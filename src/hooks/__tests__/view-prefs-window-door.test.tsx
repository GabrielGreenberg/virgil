// @vitest-environment jsdom
//
// Task 1319 — the per-window view prefs have a load door, and "session-only"
// is a declaration, not a hand override.
//
// The global half was already type-checked at load by a loop derived from
// `STRUCTURAL_GLOBAL_PREF_KEYS`; the structural WINDOW keys were adopted raw
// (a stored `"false"` was a truthy collapse flag), and `panelMRU` was zeroed at
// load yet written to disk on every recency bump. Pinned here: every window
// key is validated against its declared shape, an ephemeral key is never
// loaded / persisted / shipped, and the scope census is total.
import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from "vitest";

const WINDOW_ID = "door-window";
vi.mock("@/lib/multi-window/window-id", () => ({ getWindowId: () => WINDOW_ID }));
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));
vi.mock("@/lib/multi-window/bus", () => ({
  publish: () => {},
  subscribe: () => () => {},
}));

import { render, fireEvent, cleanup } from "@testing-library/react";
import { useViewPrefs, loadPrefs } from "../useViewPrefs";
import defaultsJson from "../useViewPrefs.defaults.json";
import {
  EPHEMERAL_WINDOW_PREF_KEYS,
  STRUCTURAL_WINDOW_PREF_KEYS,
  STRUCTURAL_WINDOW_PREFS,
  normalizeWindowPrefValue,
} from "@/lib/view-prefs/structural-window";
import { STRUCTURAL_GLOBAL_PREF_KEYS } from "@/lib/view-prefs/structural-globals";
import { VIEW_PREF_KEYS } from "@/lib/view-prefs/registry";

const GLOBAL_KEY = "virgil-view-prefs/global";
const WINDOW_KEY = `virgil-view-prefs/window/${WINDOW_ID}`;
const read = (k: string) => JSON.parse(localStorage.getItem(k) || "{}");
const write = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v));

function installStorageShim(name: "localStorage" | "sessionStorage") {
  const store = new Map<string, string>();
  Object.defineProperty(window, name, {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    },
  });
}

function MruProbe() {
  const vp = useViewPrefs();
  return (
    <>
      <button data-testid="mru" onClick={() => vp.notePanelUse("left", "outline")} />
      <button data-testid="topbar" onClick={() => vp.setTopbarRightCollapsed(true)} />
      <span data-testid="mru-left">{vp.prefs.panelMRU.left.join(",")}</span>
    </>
  );
}

beforeAll(() => {
  installStorageShim("localStorage");
  installStorageShim("sessionStorage");
});
beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("the window door validates every structural window key", () => {
  it("a stored string \"false\" is not a truthy flag — the boolean keys load as default", () => {
    write(WINDOW_KEY, {
      topbarRightCollapsed: "false",
      collapsedLeft: "true",
      collapsedRight: 1,
    });
    const p = loadPrefs();
    expect(p.topbarRightCollapsed).toBe(false);
    expect(p.collapsedLeft).toBe(false);
    expect(p.collapsedRight).toBe(false);
  });

  it("valid stored values are adopted", () => {
    write(WINDOW_KEY, {
      topbarRightCollapsed: true,
      collapsedRight: true,
      panelModes: { outline: "floating" },
      cardArchiveView: { notes: "archived" },
      panelWidths: { left: 300 },
    });
    const p = loadPrefs();
    expect(p.topbarRightCollapsed).toBe(true);
    expect(p.collapsedRight).toBe(true);
    expect(p.panelModes).toEqual({ outline: "floating" });
    expect(p.cardArchiveView).toEqual({ notes: "archived" });
    expect(p.panelWidths).toEqual({ left: 300 });
  });

  it("wrong-shaped containers load as default; bad entries are dropped, good ones kept", () => {
    write(WINDOW_KEY, {
      poppedOutCards: "float:x",
      cardFloatPositions: [1, 2],
      panelModes: { outline: "floating", notes: "sideways" },
      cardArchiveView: { notes: "all", todo: true },
      panelHeights: { outline: 120, notes: "tall" },
      floatPositions: {
        outline: { x: 1, y: 2, width: 3, height: 4 },
        notes: { x: 1, y: 2 },
      },
    });
    const p = loadPrefs();
    expect(p.poppedOutCards).toEqual([]);
    expect(p.cardFloatPositions).toEqual({});
    expect(p.panelModes).toEqual({ outline: "floating" });
    expect(p.cardArchiveView).toEqual({ notes: "all" });
    expect(p.panelHeights).toEqual({ outline: 120 });
    expect(p.floatPositions).toEqual({ outline: { x: 1, y: 2, width: 3, height: 4 } });
  });

  it("the legacy collapse fold still reads `activeLeft === null` when no valid flag is stored", () => {
    write(WINDOW_KEY, { activeLeft: null, collapsedRight: "nope" });
    const p = loadPrefs();
    expect(p.collapsedLeft).toBe(true);
    expect(p.collapsedRight).toBe(false);
  });

  it("two loads never share a default object", () => {
    write(WINDOW_KEY, { topbarRightCollapsed: true });
    const a = loadPrefs();
    const b = loadPrefs();
    expect(a.panelModes).not.toBe(b.panelModes);
  });

  it("every declared shape rejects a wrong-typed container", () => {
    for (const k of STRUCTURAL_WINDOW_PREF_KEYS) {
      expect(normalizeWindowPrefValue(STRUCTURAL_WINDOW_PREFS[k], 42), k).toBeUndefined();
    }
  });
});

describe("an ephemeral key is never loaded, persisted or shipped", () => {
  it("panelMRU is declared ephemeral", () => {
    expect(EPHEMERAL_WINDOW_PREF_KEYS).toContain("panelMRU");
  });

  it("a stored panelMRU is not loaded", () => {
    write(WINDOW_KEY, { panelMRU: { left: ["outline"], right: [] } });
    expect(loadPrefs().panelMRU).toEqual({ left: [], right: [] });
  });

  it("notePanelUse updates live state but causes no window-blob write", () => {
    // Recency is only noted for a DOCKED panel (`notePanelUse` in the engine).
    write(WINDOW_KEY, { dockStack: { left: ["outline"], right: [] } });
    const { getByTestId } = render(<MruProbe />);
    // One real window write first, so the blob on disk is this build's own
    // normalized slice — then the MRU bump must leave it byte-identical.
    fireEvent.click(getByTestId("topbar"));
    const before = localStorage.getItem(WINDOW_KEY);
    expect(before).toContain("topbarRightCollapsed");
    fireEvent.click(getByTestId("mru"));
    expect(getByTestId("mru-left").textContent).toBe("outline");
    expect(localStorage.getItem(WINDOW_KEY)).toBe(before);
  });

  it("a persisted window blob never carries an ephemeral key — not even one left on disk", () => {
    write(WINDOW_KEY, { panelMRU: { left: ["outline"], right: [] } });
    const { getByTestId } = render(<MruProbe />);
    fireEvent.click(getByTestId("topbar"));
    const w = read(WINDOW_KEY);
    expect(w.topbarRightCollapsed).toBe(true);
    for (const k of EPHEMERAL_WINDOW_PREF_KEYS) expect(k in w, k).toBe(false);
  });

  it("the shipped defaults JSON omits every ephemeral key", () => {
    for (const k of EPHEMERAL_WINDOW_PREF_KEYS) expect(k in defaultsJson, k).toBe(false);
  });
});

describe("CENSUS: every ViewPrefs key is in exactly one scope table", () => {
  it("global structural ∪ registry ∪ structural window partitions the live vocabulary", () => {
    const tables: Array<readonly string[]> = [
      STRUCTURAL_GLOBAL_PREF_KEYS,
      VIEW_PREF_KEYS,
      STRUCTURAL_WINDOW_PREF_KEYS,
    ];
    const live = Object.keys(loadPrefs()).sort();
    const declared = tables.flat();
    // No key in two tables.
    expect(new Set(declared).size).toBe(declared.length);
    // The union is exactly the live vocabulary — an undeclared window key, or
    // a stale row, fails here (and at compile time in useViewPrefs).
    expect([...declared].sort()).toEqual(live);
  });
});
