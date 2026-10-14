// @vitest-environment jsdom
//
// Task 1117 — the Reader's chrome whitelist reaches OMNI, not only the strip
// icons and the search scopes.
//
// `READER_CHROME.visiblePanelKinds` names the panels the Library Reader
// offers. Before this task the Reader derived its omni category → side map
// from ALL placements, so its filter menu listed Reports / Todos / Archive /
// Revisions / Cutter / Errors (panels it never mounts), its enabled sets
// admitted their cards, and "Default view" counted them. The whitelist now
// projects at ONE seam — `deriveCategorySides(placements, offered)` derives a
// non-offered category to `null` — and every Omni reader follows.
import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from "vitest";

const WINDOW_ID = "test-window";
vi.mock("@/lib/multi-window/window-id", () => ({ getWindowId: () => WINDOW_ID }));
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));
vi.mock("@/lib/multi-window/bus", () => ({
  publish: () => {},
  subscribe: () => () => {},
}));

import { createRef } from "react";
import { render, renderHook, cleanup, fireEvent } from "@testing-library/react";
import type { EditorHandle } from "@/components/Editor";
import { useReaderView } from "../reader-view-prefs";
import { FULL_CHROME, READER_CHROME } from "../chrome-config";
import { OmniFilterMenu } from "@/panels/Omni/OmniViewPanel";
import {
  CATEGORY_LABELS,
  OMNI_CATEGORIES,
  deriveCategorySides,
  omniCategoriesForSide,
  omniCategoriesOnSide,
  type OmniCategory,
} from "@/panels/Omni/omni-categories";

const NULL_HANDLE_REF = createRef<EditorHandle | null>();

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

const OFFERED = new Set<string>(READER_CHROME.visiblePanelKinds);
const HIDDEN: OmniCategory[] = OMNI_CATEGORIES.filter((c) => !OFFERED.has(c));
const SHOWN: OmniCategory[] = OMNI_CATEGORIES.filter((c) => OFFERED.has(c));

const menuRowLabels = () =>
  Array.from(
    document.body.querySelectorAll('[role="menu"] [role="menuitemcheckbox"]'),
  ).map((b) => b.textContent ?? "");

function openMenuRows(
  categorySides: ReturnType<typeof deriveCategorySides>,
  side: "left" | "right",
): string[] {
  const { container } = render(
    <OmniFilterMenu
      side={side}
      enabled={omniCategoriesForSide(categorySides, [], side)}
      onToggle={() => {}}
      onSelectDefault={() => {}}
      categorySides={categorySides}
    />,
  );
  fireEvent.click(container.querySelector('[aria-haspopup="menu"]') as HTMLButtonElement);
  const labels = menuRowLabels();
  cleanup();
  return labels;
}

afterEach(() => cleanup());

describe("task 1117 — the Reader's Omni honours its chrome whitelist", () => {
  it("the whitelist really hides some omni categories (the test is not vacuous)", () => {
    expect(HIDDEN.length).toBeGreaterThan(0);
    expect(SHOWN.length).toBeGreaterThan(0);
  });

  it("deriveCategorySides maps a non-offered category to null, an offered one to a side", () => {
    const sides = deriveCategorySides([], READER_CHROME.visiblePanelKinds);
    for (const c of HIDDEN) expect(sides[c]).toBeNull();
    for (const c of SHOWN) expect(sides[c] === "left" || sides[c] === "right").toBe(true);
  });

  it("main chrome (no whitelist) is byte-identical to the unprojected derivation", () => {
    expect(FULL_CHROME.visiblePanelKinds).toBeUndefined();
    expect(deriveCategorySides([], FULL_CHROME.visiblePanelKinds)).toEqual(
      deriveCategorySides([]),
    );
    for (const c of OMNI_CATEGORIES) expect(deriveCategorySides([])[c]).not.toBeNull();
  });

  it("the Reader's filter menus list no row for a panel it never mounts", () => {
    const sides = deriveCategorySides([], READER_CHROME.visiblePanelKinds);
    const rows = [...openMenuRows(sides, "left"), ...openMenuRows(sides, "right")];
    for (const c of HIDDEN) {
      const label = CATEGORY_LABELS[c]!;
      expect(rows.some((r) => r.includes(label)), `row for hidden ${c}`).toBe(false);
    }
    // Every offered category still has its row, on exactly one side.
    for (const c of SHOWN) {
      const label = CATEGORY_LABELS[c]!;
      expect(rows.filter((r) => r.includes(label)).length, `row for ${c}`).toBe(1);
    }
  });

  it("the main editor's filter menus still list every omni category", () => {
    const sides = deriveCategorySides([]);
    const rows = [...openMenuRows(sides, "left"), ...openMenuRows(sides, "right")];
    for (const c of OMNI_CATEGORIES) {
      expect(rows.some((r) => r.includes(CATEGORY_LABELS[c]!)), `row for ${c}`).toBe(true);
    }
  });

  it("omniCategoriesOnSide still treats an ABSENT key as its registry default", () => {
    // `{}` means "registry defaults", never "offered nowhere" — only an
    // explicit null removes a category.
    const all = [
      ...omniCategoriesOnSide({}, "left"),
      ...omniCategoriesOnSide({}, "right"),
    ];
    expect(new Set(all)).toEqual(new Set(OMNI_CATEGORIES));
  });
});

describe("task 1117 — useReaderView's enabled sets", () => {
  beforeAll(() => {
    installStorageShim("localStorage");
    installStorageShim("sessionStorage");
  });
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("getOmniEnabled excludes hidden-panel categories on both sides; categorySides nulls them", () => {
    const { result } = renderHook(() =>
      useReaderView(null, NULL_HANDLE_REF, null, "inline"),
    );
    const vp = result.current.viewPrefs;
    const enabled = new Set<OmniCategory>([
      ...vp.getOmniEnabled("left"),
      ...vp.getOmniEnabled("right"),
    ]);
    for (const c of HIDDEN) {
      expect(enabled.has(c), `enabled ${c}`).toBe(false);
      expect(vp.categorySides[c]).toBeNull();
    }
    for (const c of SHOWN) expect(enabled.has(c), `enabled ${c}`).toBe(true);
  });
});
