// @vitest-environment jsdom
//
// Reader handler-wiring guard (Library-Reader-refactor live-control invariant).
//
// `useReaderView(editor, editorHandleRef, scrollEl, "inline")` mounts the REAL
// view-state engine in ephemeral mode and assembles BOTH the
// `EditorPaneViewPrefs` bundle (through the shared `buildEditorPaneViewPrefs`
// builder) AND the `EditorPaneMenuBarBundle` (F#16) off ONE `vp` instance.
// Almost every editor-mutation handler is a no-op (the Reader is read-only) —
// BUT `onScrollToHeading` (Outline click-to-scroll) is the one REAL ported
// handler, and it must stay real: a future re-stub to `() => {}` would
// silently kill the Reader's outline navigation with no type error (its
// signature is `() => void` either way).
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

import { createRef } from "react";
import { renderHook, act } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import type { EditorHandle } from "@/components/Editor";
import { useReaderView } from "../reader-view-prefs";
import { VIEW_PREF_KEYS } from "@/lib/view-prefs/registry";

// The Reader's menuBar paragraph-nav recorder needs an EditorHandle ref + a
// scroll element. The wiring test doesn't exercise nav, so an empty ref +
// null scroll element are sufficient (the recorder simply finds no active
// paragraph and stays inert).
const NULL_HANDLE_REF = createRef<EditorHandle | null>();

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
        // forEach(cb) visits each top-level node with (node, pos, index) — the
        // real PM signature, which task 285's uuid→index resolve reads. The
        // menuBar's divider-level walk reads `node.type.name` + `attrs.level`,
        // and the nodes carry a `uuid` so an address can name one.
        childCount: 3,
        forEach: (cb: (n: unknown, pos: number, index: number) => void) => {
          cb({ type: { name: "heading" }, attrs: { level: 1, uuid: "h000" } }, 0, 0);
          cb({ type: { name: "heading" }, attrs: { level: 2, uuid: "h111" } }, 1, 1);
          cb({ type: { name: "paragraph" }, attrs: { uuid: "p222" } }, 2, 2);
        },
      },
    },
    commands: { focus, setTextSelection },
    view: { nodeDOM },
  } as unknown as Editor;
  return { editor, focus, setTextSelection, nodeDOM, scrollIntoView };
}

describe("useReaderView — onScrollToHeading is a REAL handler", () => {
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
    const { result } = renderHook(() =>
      useReaderView(stub.editor, NULL_HANDLE_REF, null, "inline"),
    );

    // Scroll to the 2nd top-level block, addressed by its durable uuid — the
    // snapshot index it carries is deliberately WRONG (task 285: a hydrated
    // address resolves by uuid only, never by the index it travelled with).
    result.current.viewPrefs.onScrollToHeading({ uuid: "h111", index: 99 });

    expect(stub.focus).toHaveBeenCalledTimes(1);
    expect(stub.setTextSelection).toHaveBeenCalledWith(1);
    expect(stub.nodeDOM).toHaveBeenCalledWith(1);
    expect(stub.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("is a safe no-op when the editor hasn't mounted yet (null editor)", () => {
    const { result } = renderHook(() =>
      useReaderView(null, NULL_HANDLE_REF, null, "inline"),
    );
    // No editor → no throw, simply does nothing.
    expect(() =>
      result.current.viewPrefs.onScrollToHeading({ uuid: "h000", index: 0 }),
    ).not.toThrow();
  });

  it("the bundle satisfies the EditorPaneViewPrefs shape (key members defined)", () => {
    const stub = makeStubEditor();
    const { result } = renderHook(() =>
      useReaderView(stub.editor, NULL_HANDLE_REF, null, "inline"),
    );
    const bundle = result.current.viewPrefs;

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
      // The Bibliography filter is written through the ONE registry-driven
      // setter (task 274) — there is no bespoke `setBibFilter` any more.
      "setViewPref",
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

/**
 * A stub editor for the section-path recorder: top-level nodes carry real
 * (node, offset, index) and a `view.coordsAtPos(pos)` keyed off the offset so
 * the recorder's heading walk can resolve viewport tops. Layout (3 headings):
 *   idx0  heading L1 "Intro"      pos1 → top 10  (above the 25% line)
 *   idx1  heading L2 "Background" pos3 → top 40  (above the line)
 *   idx2  heading L1 "Methods"    pos5 → top 900 (below the line — not crossed)
 */
function makeSectionPathStubEditor() {
  const tops: Record<number, number> = { 1: 10, 3: 40, 5: 900 };
  const editor = {
    state: {
      doc: {
        forEach: (cb: (n: unknown, pos: number, index: number) => void) => {
          cb(
            { type: { name: "heading" }, attrs: { level: 1, sectionNumber: "1" }, textContent: "Intro" },
            0,
            0,
          );
          cb(
            { type: { name: "heading" }, attrs: { level: 2, sectionNumber: "1.1" }, textContent: "Background" },
            2,
            1,
          );
          cb(
            { type: { name: "heading" }, attrs: { level: 1, sectionNumber: "2" }, textContent: "Methods" },
            4,
            2,
          );
        },
      },
    },
    view: { coordsAtPos: (pos: number) => ({ top: tops[pos] ?? 9999 }) },
  } as unknown as Editor;
  return editor;
}

/** A scroll container with the geometry the recorder reads. Top of the
 *  viewport at y=0, height 1000 ⇒ the 25% reference line sits at y=250, so the
 *  first two headings (tops 10/40) are crossed and "Methods" (900) is not. */
function makeScrollEl(): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperties(el, {
    offsetHeight: { configurable: true, value: 1000 },
    scrollHeight: { configurable: true, value: 5000 },
    clientHeight: { configurable: true, value: 1000 },
    scrollTop: { configurable: true, value: 0 },
  });
  el.getBoundingClientRect = () =>
    ({ top: 0, bottom: 1000, height: 1000 }) as DOMRect;
  return el;
}

describe("useReaderView — section path / breadcrumb (F#16 deferred half)", () => {
  beforeAll(() => {
    installStorageShim("localStorage");
    installStorageShim("sessionStorage");
    // The recorder schedules via requestAnimationFrame; run it synchronously.
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => vi.restoreAllMocks());

  it("derives the active breadcrumb from scrolled-past headings (not EMPTY_SECTION_PATHS)", () => {
    const editor = makeSectionPathStubEditor();
    const scrollEl = makeScrollEl();
    const { result } = renderHook(() =>
      useReaderView(editor, NULL_HANDLE_REF, scrollEl, "inline"),
    );

    // compute() runs on mount (effect) → the two crossed headings form the
    // active path; "Methods" (below the 25% line) is excluded.
    const path = result.current.viewPrefs.activeSectionPath;
    expect(path.map((e) => e.text)).toEqual(["Intro", "Background"]);
    expect(path.map((e) => e.sectionNumber)).toEqual(["1", "1.1"]);
  });

  it("stays EMPTY when there is no scroll container yet (null scrollEl)", () => {
    const editor = makeSectionPathStubEditor();
    const { result } = renderHook(() =>
      useReaderView(editor, NULL_HANDLE_REF, null, "inline"),
    );
    expect(result.current.viewPrefs.activeSectionPath).toEqual([]);
  });
});

describe("useReaderView — menuBar bundle (F#16)", () => {
  beforeAll(() => {
    installStorageShim("localStorage");
    installStorageShim("sessionStorage");
  });

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => vi.restoreAllMocks());

  it("satisfies the EditorPaneMenuBarBundle shape with functional setters", () => {
    const stub = makeStubEditor();
    const { result } = renderHook(() =>
      useReaderView(stub.editor, NULL_HANDLE_REF, null, "inline"),
    );
    const menuBar = result.current.menuBar;

    // Read state present: the whole registry slice off the ephemeral engine
    // (task 274 — one object, keyed by registry key, not one field per pref).
    for (const key of VIEW_PREF_KEYS) {
      expect(menuBar.prefs[key]).toBeDefined();
    }

    // Divider levels are walked from the doc's heading nodes (levels 1 & 2).
    expect(menuBar.availableDividerLevels.has(1)).toBe(true);
    expect(menuBar.availableDividerLevels.has(2)).toBe(true);
    expect(menuBar.availableDividerLevels.has(3)).toBe(false);

    // Every required writer / nav / opener is a function (type-completeness in
    // full means a missing one is a compile error; this pins them at runtime).
    for (const member of [
      "toggleViewPref",
      "setViewPref",
      "toggleViewPrefMember",
      "closeAllPanels",
      "paraNavBack",
      "paraNavForward",
      "onOpenFontsDialog",
      "onOpenMarginsMode",
    ] as const) {
      expect(typeof menuBar[member]).toBe("function");
    }

    // Paragraph nav starts fully disabled (empty history).
    expect(menuBar.paraNavBackDisabled).toBe(true);
    expect(menuBar.paraNavForwardDisabled).toBe(true);
  });

  it("a menu toggle mutates the SAME engine the viewPrefs bundle reads (no two-engine trap)", () => {
    const stub = makeStubEditor();
    const { result } = renderHook(() =>
      useReaderView(stub.editor, NULL_HANDLE_REF, null, "inline"),
    );

    const before = result.current.menuBar.prefs.showParTitles;
    act(() => result.current.menuBar.toggleViewPref("showParTitles"));
    // The menuBar read-state flipped...
    expect(result.current.menuBar.prefs.showParTitles).toBe(!before);
    // ...and the SAME flip is visible on the viewPrefs bundle's prefs (proving
    // both bundles are backed by one ephemeral `vp`).
    expect(result.current.viewPrefs.prefs.showParTitles).toBe(!before);
  });
});
