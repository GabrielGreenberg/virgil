// @vitest-environment jsdom
//
// The standing linked-anchor washes are the PANE's, not the shell's (task 1316).
//
// THE FINDING
//
//   `showHighlights` / `hiddenHighlightTypes` reached the screen only through
//   EditorLayout, which called `useLinkHighlight` to stamp
//   `data-show-hl-<kind>` on the editor root. The Library Reader mounts
//   EditorPane with no EditorLayout around it — so its View menu rendered the
//   Highlights group and every toggle in it drew nothing. And the kinds were
//   hand-listed twice (`ALL_KINDS` in the hook, a literal union in the shell)
//   beside the SSOT `ALL_HIGHLIGHT_TYPES`.
//
// THE FIX, pinned here
//
//   1. one pure rule, `visibleHighlightKinds(prefs)`, over a kind list DERIVED
//      from `ALL_HIGHLIGHT_TYPES` (+ "archive");
//   2. the REAL Reader prefs (`useReaderView`) driving the hook stamp the root,
//      and a Highlights toggle in the Reader's menu bundle clears it;
//   3. a census: EditorPane is the hook's ONE host, and no hand list returns.
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

vi.mock("@/lib/multi-window/window-id", () => ({ getWindowId: () => "test-window" }));
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));
vi.mock("@/lib/multi-window/bus", () => ({
  publish: () => {},
  subscribe: () => () => {},
}));

import * as fs from "node:fs";
import * as path from "node:path";
import { createRef, useMemo } from "react";
import { act, renderHook } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import type { EditorHandle } from "@/components/Editor";
import { useReaderView } from "@/components/editor-layout/reader-view-prefs";
import { ALL_HIGHLIGHT_TYPES } from "@/lib/view-prefs/highlight-types";
import {
  LINK_ANCHOR_KINDS,
  useLinkHighlight,
  visibleHighlightKinds,
} from "../useLinkHighlight";
import { REPO_ROOT, codeOnly, trackedFiles } from "@/lib/__tests__/_source-scan";

const NONE_ARCHIVED: ReadonlySet<string> = new Set<string>();

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

describe("visibleHighlightKinds — the one rule", () => {
  it("master switch off → nothing, archive included", () => {
    expect(
      visibleHighlightKinds({ showHighlights: false, hiddenHighlightTypes: [] }).size,
    ).toBe(0);
  });

  it("master on → every menu kind not hidden, plus archive", () => {
    const got = visibleHighlightKinds({
      showHighlights: true,
      hiddenHighlightTypes: ["todo"],
    });
    for (const t of ALL_HIGHLIGHT_TYPES) expect(got.has(t)).toBe(t !== "todo");
    expect(got.has("archive")).toBe(true);
  });

  it("the attribute vocabulary is DERIVED from the SSOT, not restated", () => {
    expect([...LINK_ANCHOR_KINDS]).toEqual([...ALL_HIGHLIGHT_TYPES, "archive"]);
  });
});

describe("Reader-shaped host — the real Reader prefs reach the editor root", () => {
  beforeAll(() => {
    installStorageShim("localStorage");
    installStorageShim("sessionStorage");
  });
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("showHighlights stamps data-show-hl-note; hiding 'note' in the Reader menu clears it", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = new Editor({
      element,
      extensions: [Document, Paragraph, Text],
      content: "<p>word</p>",
    });
    const handleRef = createRef<EditorHandle | null>();

    // The same composition EditorPane performs, fed by the REAL Reader
    // view-state (no EditorLayout anywhere).
    const { result } = renderHook(() => {
      const rv = useReaderView(null, handleRef, null, "inline");
      const { showHighlights, hiddenHighlightTypes } = rv.viewPrefs.prefs;
      const kinds = useMemo(
        () => visibleHighlightKinds({ showHighlights, hiddenHighlightTypes }),
        [showHighlights, hiddenHighlightTypes],
      );
      useLinkHighlight({
        editor: editor as never,
        visibleHighlightKinds: kinds,
        archivedAnchorIds: NONE_ARCHIVED,
      });
      return rv;
    });

    const root = editor.view.dom;
    if (!result.current.viewPrefs.prefs.showHighlights) {
      act(() => result.current.menuBar.toggleViewPref("showHighlights"));
    }
    expect(root.getAttribute("data-show-hl-note")).toBe("true");

    act(() => result.current.menuBar.toggleViewPrefMember("hiddenHighlightTypes", "note"));
    expect(root.hasAttribute("data-show-hl-note")).toBe(false);

    act(() => result.current.menuBar.toggleViewPref("showHighlights"));
    expect(root.hasAttribute("data-show-hl-archive")).toBe(false);

    editor.destroy();
    element.remove();
  });
});

describe("census — EditorPane is the ONE host, and no hand list returns", () => {
  const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
  const prod = [
    ...trackedFiles("src", /\.tsx?$/),
    ...trackedFiles("library", /\.tsx?$/),
  ].filter((f) => !/__tests__|\.test\./.test(f));

  it("collected a real population", () => {
    expect(prod.length).toBeGreaterThan(200);
  });

  it("useLinkHighlight is called only by EditorPane", () => {
    // `trackedFiles` yields ABSOLUTE paths.
    const callers = prod
      .filter((f) => /\buseLinkHighlight\s*\(/.test(codeOnly(fs.readFileSync(f, "utf8"))))
      .map((f) => path.relative(REPO_ROOT, f));
    expect(callers.sort()).toEqual([
      "src/components/EditorPane.tsx",
      "src/links/_shared/useLinkHighlight.ts",
    ]);
  });

  it("EditorPane feeds it from the host's prefs through the one rule", () => {
    const pane = codeOnly(read("src/components/EditorPane.tsx"));
    expect(pane).toMatch(/visibleHighlightKinds\(\{\s*showHighlights,\s*hiddenHighlightTypes\s*\}\)/);
  });

  it("no hand-listed highlight-kind union or array survives in the hook or the shell", () => {
    const handUnion = /"note"\s*\|\s*"todo"|"todo"\s*\|\s*"comment"/;
    const handArray = /\[\s*"note",\s*"todo",/;
    for (const f of ["src/links/_shared/useLinkHighlight.ts", "src/components/EditorLayout.tsx"]) {
      const src = codeOnly(read(f));
      expect(src, f).not.toMatch(handUnion);
      expect(src, f).not.toMatch(handArray);
    }
  });
});
