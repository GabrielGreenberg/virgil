// @vitest-environment jsdom
//
// `useLibraryTabs` renders a DISPLAYED projection of the left panel (per-doc
// project tabs spliced in after Central, active id overridden to the current
// doc's project tab) while every mutation splices the RAW persisted state.
// Task 131: any input the user expresses in displayed coordinates — a drop
// insertion index, "the tab I'm looking at" — must be translated back at the
// hook boundary. These are the two places that consumed it raw.

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import {
  CENTRAL_LIBRARY_ID,
  panelTabsStorageKey,
  projectLibraryIdForDoc,
  type Library,
  type PanelTabsState,
} from "@library/lib/library-store";

const { diskLibraries } = vi.hoisted(() => ({
  diskLibraries: { current: [] as Library[] },
}));

vi.mock("@library/hooks/useDiskLibraries", () => ({
  useDiskLibraries: () => ({
    libraries: diskLibraries.current,
    hydrated: true,
    reload: async () => {},
    create: () => ({
      id: "created",
      label: "Untitled",
      createdAt: 0,
      kind: "custom" as const,
    }),
    createFromBib: () => ({
      id: "created",
      label: "Untitled",
      createdAt: 0,
      kind: "custom" as const,
    }),
    rename: () => {},
    remove: () => {},
    addEntries: () => {},
    removeEntry: () => {},
    setSourceBibFile: () => {},
    togglePin: () => {},
  }),
}));

vi.mock("@library/lib/view-session-store", () => ({
  getSession: () => ({ scopes: {} }),
  setLeftPinnedActiveId: () => {},
}));

import { useLibraryTabs } from "../useLibraryTabs";

const C = CENTRAL_LIBRARY_ID;
const pA = projectLibraryIdForDoc("docA");
const pB = projectLibraryIdForDoc("docB");
const OPEN_DOCS = [
  { id: "docA", label: "Paper A" },
  { id: "docB", label: "Paper B" },
];

const custom = (id: string): Library => ({
  id,
  label: id,
  createdAt: 0,
  kind: "custom",
});

function seedLeft(state: PanelTabsState): void {
  localStorage.setItem(panelTabsStorageKey("left"), JSON.stringify(state));
}

function persistedLeft(): PanelTabsState {
  return JSON.parse(
    localStorage.getItem(panelTabsStorageKey("left")) ?? "{}",
  ) as PanelTabsState;
}

beforeEach(() => {
  localStorage.clear();
  diskLibraries.current = [custom("custom1"), custom("custom2")];
});
afterEach(() => cleanup());

describe("moveTab — the drop index arrives in DISPLAYED space", () => {
  it("reorders to the raw slot the user pointed at, not N project tabs off", () => {
    seedLeft({ openIds: [C, "custom1", "custom2"], activeId: C });
    const { result } = renderHook(() =>
      useLibraryTabs({ openDocs: OPEN_DOCS, currentDocId: "docA" }),
    );

    // Displayed: [Central, projA, projB, custom1, custom2].
    expect(result.current.leftTabs.openIds).toEqual([
      C,
      pA,
      pB,
      "custom1",
      "custom2",
    ]);

    // Drop custom2 just BEFORE custom1 → displayed index 3.
    act(() => result.current.moveTab("custom2", "left", 3));

    expect(result.current.leftTabs.openIds).toEqual([
      C,
      pA,
      pB,
      "custom2",
      "custom1",
    ]);
    expect(persistedLeft().openIds).toEqual([C, "custom2", "custom1"]);
  });

  it("a drop past the last displayed tab lands at the raw end", () => {
    seedLeft({ openIds: [C, "custom1", "custom2"], activeId: C });
    const { result } = renderHook(() =>
      useLibraryTabs({ openDocs: OPEN_DOCS, currentDocId: "docA" }),
    );

    // The panel-body drop path passes the DISPLAYED length (5 here).
    act(() => result.current.moveTab("custom1", "left", 5));

    expect(persistedLeft().openIds).toEqual([C, "custom2", "custom1"]);
  });

  it("is unchanged on a panel with no projection (displayed === raw)", () => {
    seedLeft({ openIds: [C, "custom1", "custom2"], activeId: C });
    const { result } = renderHook(() => useLibraryTabs({}));

    expect(result.current.leftTabs.openIds).toEqual([C, "custom1", "custom2"]);
    act(() => result.current.moveTab("custom2", "left", 1));
    expect(persistedLeft().openIds).toEqual([C, "custom2", "custom1"]);
  });
});

describe("openLibrary — the replace target is the DISPLAYED active tab", () => {
  it("appends (never eats Central) while a doc's project tab is active", () => {
    seedLeft({ openIds: [C, "custom1"], activeId: C });
    const { result } = renderHook(() =>
      useLibraryTabs({ openDocs: OPEN_DOCS, currentDocId: "docA" }),
    );

    // The highlighted tab is projA — a synthetic tab holding no raw slot.
    expect(result.current.leftTabs.activeId).toBe(pA);

    act(() => result.current.openLibrary("custom2", "left"));

    expect(persistedLeft().openIds).toEqual([C, "custom1", "custom2"]);
    expect(result.current.leftTabs.activeId).toBe("custom2");
  });

  it("still replaces the highlighted tab when it really is the raw active one", () => {
    seedLeft({ openIds: [C, "custom1"], activeId: C });
    const { result } = renderHook(() => useLibraryTabs({}));

    expect(result.current.leftTabs.activeId).toBe(C);
    act(() => result.current.openLibrary("custom2", "left"));

    expect(persistedLeft().openIds).toEqual(["custom2", "custom1"]);
  });

  it("appends when the highlighted tab is pinned", () => {
    diskLibraries.current = [
      { ...custom("custom1"), pinned: true },
      custom("custom2"),
    ];
    seedLeft({ openIds: ["custom1"], activeId: "custom1" });
    const { result } = renderHook(() => useLibraryTabs({}));

    act(() => result.current.openLibrary("custom2", "left"));
    expect(persistedLeft().openIds).toEqual(["custom1", "custom2"]);
  });
});

describe("openPaper — same door, same displayed-space resolution", () => {
  it("appends into the left panel rather than replacing Central behind a project tab", () => {
    seedLeft({ openIds: [C], activeId: C });
    const { result } = renderHook(() =>
      useLibraryTabs({ openDocs: OPEN_DOCS, currentDocId: "docA" }),
    );

    // fromPanel "right" → destination is the left panel.
    act(() => result.current.openPaper("smith2020", "right"));

    expect(persistedLeft().openIds).toEqual([C, "paper:smith2020"]);
  });
});
