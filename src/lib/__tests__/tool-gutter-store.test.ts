// @vitest-environment jsdom
/**
 * The tool gutter's view state (task 1440): one parse path, window-wide
 * toggles, a More section that can leave while a standing one only folds, the
 * legacy panel-open routing, and the cross-window re-read.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_TOOL_GUTTER_STATE,
  TOOL_GUTTER_STORAGE_KEY,
  __resetToolGutterStoreForTests,
  getToolGutterState,
  openGutterTool,
  parseToolGutterState,
  removeGutterSection,
  revealGutterSection,
  routePanelOpenToGutter,
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
        // A standing section is never an "extra"; an unknown id is dropped.
        extra: ["notes", "footnotes", "bogus", "notes"],
        folded: ["todo", "nope"],
      }),
    );
    expect(s).toEqual({ tool: "search", extra: ["notes"], folded: ["todo"] });
    expect(parseToolGutterState(JSON.stringify({ tool: "omni" })).tool).toBeNull();
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

  it("reveals a More section unfolded; a standing section folds but never leaves", () => {
    toggleGutterSectionFold("notes");
    revealGutterSection("notes");
    expect(getToolGutterState()).toMatchObject({ extra: ["notes"], folded: [] });
    removeGutterSection("notes");
    expect(getToolGutterState().extra).toEqual([]);

    toggleGutterSectionFold("footnotes");
    expect(getToolGutterState().folded).toEqual(["footnotes"]);
    removeGutterSection("footnotes");
    expect(getToolGutterState().folded).toEqual(["footnotes"]);
    revealGutterSection("footnotes");
    expect(getToolGutterState()).toMatchObject({ extra: [], folded: [] });
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
        JSON.stringify({ tool: "outline", extra: ["errors"], folded: [] }),
      );
      window.dispatchEvent(new StorageEvent("storage", { key: TOOL_GUTTER_STORAGE_KEY }));
    });
    expect(result.current).toEqual({ tool: "outline", extra: ["errors"], folded: [] });
  });
});
