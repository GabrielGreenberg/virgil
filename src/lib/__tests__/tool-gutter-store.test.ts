// @vitest-environment jsdom
/**
 * The tool gutter's view state (task 1440): one parse path, window-wide
 * toggles, foldouts the user adds and removes (none required; Footnotes and
 * Bibliography by default), the legacy panel-open routing, and the cross-window
 * re-read.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_GUTTER_SECTIONS,
  MAX_GUTTER_SPLIT,
  MIN_GUTTER_SPLIT,
  DEFAULT_TOOL_GUTTER_STATE,
  TOOL_GUTTER_STORAGE_KEY,
  __resetToolGutterStoreForTests,
  getToolGutterState,
  openGutterTool,
  parseToolGutterState,
  removeGutterSection,
  resetGutterSections,
  revealGutterSection,
  routePanelOpenToGutter,
  setGutterSplit,
  toggleGutterList,
  toggleGutterSectionFold,
  toggleGutterTool,
} from "@/lib/tool-gutter-store";

beforeEach(() => {
  localStorage.clear();
  __resetToolGutterStoreForTests();
});
afterEach(() => localStorage.clear());

describe("parseToolGutterState", () => {
  it("degrades a missing or malformed value to the default", () => {
    expect(parseToolGutterState(null)).toEqual(DEFAULT_TOOL_GUTTER_STATE);
    expect(parseToolGutterState("{not json")).toEqual(DEFAULT_TOOL_GUTTER_STATE);
    expect(parseToolGutterState("[]")).toEqual(DEFAULT_TOOL_GUTTER_STATE);
  });

  it("keeps the valid fields and drops the rest, field by field", () => {
    const s = parseToolGutterState(
      JSON.stringify({
        tool: "search",
        // An unknown id and a repeat are dropped.
        sections: ["notes", "footnotes", "bogus", "notes"],
        folded: ["todo", "nope"],
      }),
    );
    // A blob from before the split gutter names no open list: its first opens.
    expect(s).toEqual({
      tool: "search",
      sections: ["notes", "footnotes"],
      folded: ["todo"],
      list: "notes",
      split: 0.5,
    });
    expect(parseToolGutterState(JSON.stringify({ tool: "omni" })).tool).toBeNull();
  });

  it("starts with Footnotes and Bibliography, and keeps an emptied list empty", () => {
    expect(DEFAULT_GUTTER_SECTIONS).toEqual(["footnotes", "bibliography"]);
    expect(parseToolGutterState(null).sections).toEqual(["footnotes", "bibliography"]);
    expect(parseToolGutterState(JSON.stringify({ sections: [] })).sections).toEqual([]);
  });

  it("carries a saved `extra` list over, on top of the defaults", () => {
    const s = parseToolGutterState(JSON.stringify({ extra: ["notes", "footnotes"] }));
    expect(s.sections).toEqual(["footnotes", "bibliography", "notes"]);
  });
});

describe("tool gutter actions", () => {
  it("toggles one tool at a time and persists", () => {
    toggleGutterTool("outline");
    expect(getToolGutterState().tool).toBe("outline");
    openGutterTool("wordcount");
    expect(getToolGutterState().tool).toBe("wordcount");
    toggleGutterTool("wordcount");
    expect(getToolGutterState().tool).toBeNull();
    openGutterTool("search");
    expect(JSON.parse(localStorage.getItem(TOOL_GUTTER_STORAGE_KEY)!).tool).toBe("search");
  });

  it("reveals a section unfolded, adding it if it is absent", () => {
    toggleGutterSectionFold("notes");
    revealGutterSection("notes");
    expect(getToolGutterState()).toMatchObject({
      sections: ["footnotes", "bibliography", "notes"],
      folded: [],
    });
    toggleGutterSectionFold("footnotes");
    expect(getToolGutterState().folded).toEqual(["footnotes"]);
    revealGutterSection("footnotes");
    expect(getToolGutterState()).toMatchObject({
      sections: ["footnotes", "bibliography", "notes"],
      folded: [],
    });
  });

  it("removes any section, the defaults included, and the list may end empty", () => {
    removeGutterSection("footnotes");
    expect(getToolGutterState().sections).toEqual(["bibliography"]);
    removeGutterSection("bibliography");
    expect(getToolGutterState().sections).toEqual([]);
    __resetToolGutterStoreForTests();
    expect(getToolGutterState().sections).toEqual([]);
  });
});

describe("routePanelOpenToGutter — the legacy open doors under the gutter layout", () => {
  it("opens (or toggles) a tool at the top of the gutter", () => {
    expect(routePanelOpenToGutter("search", "open")).toBe(true);
    expect(getToolGutterState().tool).toBe("search");
    expect(routePanelOpenToGutter("search", "toggle")).toBe(true);
    expect(getToolGutterState().tool).toBeNull();
  });

  it("swallows a card panel's open without growing a list", () => {
    // A marker click or a new card must not add a section on the left —
    // the card is already in the right gutter.
    expect(routePanelOpenToGutter("notes", "open")).toBe(true);
    expect(routePanelOpenToGutter("revisions", "toggle")).toBe(true);
    expect(getToolGutterState()).toEqual(DEFAULT_TOOL_GUTTER_STATE);
  });

  it("leaves an id it does not own to the legacy path", () => {
    expect(routePanelOpenToGutter("omni", "open")).toBe(false);
  });
});

describe("cross-window", () => {
  it("re-reads on a peer window's storage event", async () => {
    const { useToolGutterState } = await import("@/lib/tool-gutter-store");
    const { renderHook, act } = await import("@testing-library/react");
    const { result } = renderHook(() => useToolGutterState());
    expect(result.current.tool).toBeNull();
    act(() => {
      localStorage.setItem(
        TOOL_GUTTER_STORAGE_KEY,
        JSON.stringify({ tool: "outline", sections: ["errors"], folded: [] }),
      );
      window.dispatchEvent(new StorageEvent("storage", { key: TOOL_GUTTER_STORAGE_KEY }));
    });
    expect(result.current).toEqual({
      tool: "outline",
      sections: ["errors"],
      folded: [],
      list: "errors",
      split: 0.5,
    });
  });

  // Task 1572: the storage listener detaches with the last subscriber, so a
  // peer's write during that gap fires nothing here. The remount must still
  // show it, and this window's next toggle must build on it, not undo it.
  it("a remount after a peer's write in the unsubscribed gap shows the peer's state", async () => {
    const { useToolGutterState } = await import("@/lib/tool-gutter-store");
    const { renderHook } = await import("@testing-library/react");
    toggleGutterTool("search");
    const first = renderHook(() => useToolGutterState());
    expect(first.result.current.tool).toBe("search");
    first.unmount();

    // The peer window writes; no event reaches a window with no listener.
    localStorage.setItem(
      TOOL_GUTTER_STORAGE_KEY,
      JSON.stringify({ tool: "outline", sections: ["errors"], folded: [] }),
    );
    expect(getToolGutterState().tool).toBe("outline");

    const second = renderHook(() => useToolGutterState());
    expect(second.result.current.tool).toBe("outline");
    expect(second.result.current.sections).toEqual(["errors"]);

    toggleGutterSectionFold("errors");
    const stored = JSON.parse(localStorage.getItem(TOOL_GUTTER_STORAGE_KEY)!);
    expect(stored.tool).toBe("outline");
    expect(stored.sections).toEqual(["errors"]);
    second.unmount();
  });
});

describe("the split gutter's bottom half (round 3)", () => {
  it("keeps a stored list only if its icon is present, and a closed list closed", () => {
    expect(
      parseToolGutterState(JSON.stringify({ sections: ["notes"], list: "footnotes" })).list,
    ).toBe("notes");
    expect(parseToolGutterState(JSON.stringify({ sections: ["notes"], list: null })).list).toBeNull();
    expect(parseToolGutterState(JSON.stringify({ sections: [], list: "notes" })).list).toBeNull();
  });

  it("clamps the stored split into the drag's bounds", () => {
    expect(parseToolGutterState(JSON.stringify({ split: 0.01 })).split).toBe(MIN_GUTTER_SPLIT);
    expect(parseToolGutterState(JSON.stringify({ split: 3 })).split).toBe(MAX_GUTTER_SPLIT);
    expect(parseToolGutterState(JSON.stringify({ split: 0.3 })).split).toBe(0.3);
  });

  it("toggles one list, opens an added one, and closes a removed one", () => {
    toggleGutterList("bibliography");
    expect(getToolGutterState().list).toBe("bibliography");
    toggleGutterList("bibliography");
    expect(getToolGutterState().list).toBeNull();
    revealGutterSection("notes");
    expect(getToolGutterState()).toMatchObject({ list: "notes", sections: ["footnotes", "bibliography", "notes"] });
    removeGutterSection("notes");
    expect(getToolGutterState()).toMatchObject({ list: null, sections: ["footnotes", "bibliography"] });
    removeGutterSection("footnotes");
    resetGutterSections();
    expect(getToolGutterState().sections).toEqual(["footnotes", "bibliography"]);
  });

  it("commits the divider's share once, clamped", () => {
    setGutterSplit(0.7);
    expect(getToolGutterState().split).toBe(0.7);
    setGutterSplit(0.99);
    expect(getToolGutterState().split).toBe(MAX_GUTTER_SPLIT);
  });
});
