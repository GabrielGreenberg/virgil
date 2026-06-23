// @vitest-environment jsdom
//
// Reader handler-wiring guard (Library-Reader-refactor live-control invariant).
//
// `useReaderViewPrefs(editor)` mounts the REAL view-state engine in ephemeral
// mode and assembles its `EditorPaneViewPrefs` bundle through the shared
// `buildEditorPaneViewPrefs` builder. Almost every editor-mutation handler is a
// no-op (the Reader is read-only) — BUT `onScrollToHeading` (Outline
// click-to-scroll) is the one REAL ported handler, and it must stay real: a
// future re-stub to `() => {}` would silently kill the Reader's outline
// navigation with no type error (its signature is `() => void` either way).
//
// This test pins:
//   1. `onScrollToHeading` actually drives the editor — given a heading index,
//      it calls `editor.commands.focus` + `editor.commands.setTextSelection`
//      and scrolls the heading's DOM node into view (i.e. it is NOT a no-op).
//   2. The bundle satisfies the `EditorPaneViewPrefs` shape — the key members
//      (real engine setters + the live handler) are defined functions.
import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from "vitest";

const WINDOW_ID = "test-window";
vi.mock("@/lib/multi-window/window-id", () => ({ getWindowId: () => WINDOW_ID }));
// useViewPrefs transitively pulls `@/lib/storage` (require("@/lib/storage-fsa")
// can't be aliased by vitest — see vitest_extension_barrel_storage_mock memo).
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));
vi.mock("@/lib/multi-window/bus", () => ({
  publish: () => {},
  subscribe: () => () => {},
}));

import { renderHook } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { useReaderViewPrefs } from "../reader-view-prefs";

// The project's jsdom env doesn't ship a full Storage; install minimal
// in-memory shims (mirrors view-prefs-registry-roundtrip.test.ts).
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

/**
 * A minimal stub editor exercising exactly the surface `onScrollToHeading`
 * touches: walk the top-level doc nodes (to map heading index → pos),
 * `commands.focus`/`commands.setTextSelection`, and `view.nodeDOM` for the
 * scroll target. Three pseudo-blocks at positions 0/1/2.
 */
function makeStubEditor() {
  const focus = vi.fn();
  const setTextSelection = vi.fn();
  const scrollIntoView = vi.fn();
  const node = { scrollIntoView } as unknown as HTMLElement;
  const nodeDOM = vi.fn(() => node);
  const editor = {
    state: {
      doc: {
        // forEach(cb) visits each top-level node with (node, pos). The ported
        // body only uses the running index/pos, so the node payload is a stub.
        forEach: (cb: (n: unknown, pos: number) => void) => {
          cb({}, 0);
          cb({}, 1);
          cb({}, 2);
        },
      },
    },
    commands: { focus, setTextSelection },
    view: { nodeDOM },
  } as unknown as Editor;
  return { editor, focus, setTextSelection, nodeDOM, scrollIntoView };
}

describe("useReaderViewPrefs — onScrollToHeading is a REAL handler", () => {
  beforeAll(() => {
    installStorageShim("localStorage");
    installStorageShim("sessionStorage");
  });

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => vi.restoreAllMocks());

  it("drives the editor's selection + scroll commands (not a no-op)", () => {
    const stub = makeStubEditor();
    const { result } = renderHook(() => useReaderViewPrefs(stub.editor));

    // Scroll to the 2nd top-level block (index 1 → pos 1).
    result.current.onScrollToHeading(1);

    expect(stub.focus).toHaveBeenCalledTimes(1);
    expect(stub.setTextSelection).toHaveBeenCalledWith(1);
    expect(stub.nodeDOM).toHaveBeenCalledWith(1);
    expect(stub.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("is a safe no-op when the editor hasn't mounted yet (null editor)", () => {
    const { result } = renderHook(() => useReaderViewPrefs(null));
    // No editor → no throw, simply does nothing.
    expect(() => result.current.onScrollToHeading(0)).not.toThrow();
  });

  it("the bundle satisfies the EditorPaneViewPrefs shape (key members defined)", () => {
    const stub = makeStubEditor();
    const { result } = renderHook(() => useReaderViewPrefs(stub.editor));
    const bundle = result.current;

    // Read state present.
    expect(bundle.prefs).toBeDefined();

    // The live, ported handler.
    expect(typeof bundle.onScrollToHeading).toBe("function");

    // Real engine setters routed verbatim through the builder — these are the
    // ones that make the Reader's strip / divider / dock / omni FUNCTIONAL.
    for (const member of [
      "setEditorLeftMargin",
      "setEditorRightMargin",
      "setPanelWidth",
      "setPanelHeight",
      "togglePanel",
      "openPanelDocked",
      "movePanel",
      "toggleCardPopout",
      "toggleOmniHideAllCards",
      "setBibFilter",
      "getOmniEnabled",
      "getOmniHideAll",
      "remapCardPopKey",
    ] as const) {
      expect(typeof bundle[member]).toBe("function");
    }

    // Reader-side derivations: no focus mode, no zen, no section band.
    expect(bundle.focusState).toBeNull();
    expect(bundle.zenMode).toBe(false);
    expect(bundle.activeSectionPath).toEqual([]);
  });
});
