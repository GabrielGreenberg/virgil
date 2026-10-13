// @vitest-environment jsdom
//
// Task 1099 — the code view's text-to-code arrow lands the code cursor's
// paragraph ON the reading line, in the ROW scroller.
//
// Before: `pushCodeSelectionToTipTap` walked to the first ancestor whose
// computed `overflowY` was not `visible` — the editor pod, `overflow: clip`,
// which is not a scroll container — so its `scrollTop` write was a no-op and
// the arrow moved the caret without moving the page.
//
// Rig: view.dom → pod (`overflow: clip`) → row (`overflow-y: auto`,
// `[data-virgil-row-scroll]`). jsdom lays nothing out, so `coordsAtPos` is
// stubbed (content-space top minus the row's scrollTop) and the row's rect
// sits at client 0. Chrome vars are unset, so the reading-line inset is the
// SSOT fallback (`chromeTopInset`).

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", () => ({
  isDevStorage: false,
  readTex: vi.fn(() => Promise.resolve("")),
}));
// The arrow asks the CM pane which paragraph its cursor is in; pin the answer.
vi.mock("@/lib/code-position-map", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/code-position-map")>();
  return { ...actual, getActiveParagraphUuid: vi.fn(() => "T") };
});

import { Editor } from "@tiptap/core";
import { EditorState } from "@codemirror/state";
import type { EditorView as CMView } from "@codemirror/view";
import type { Editor as TipTapEditor } from "@tiptap/react";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { createCodePaneBridge } from "@/lib/code-pane-bridge";
import { chromeTopInset } from "@/lib/tiptap/chrome-scroll-margin";
import { readingLineY, scrollPosToReadingLine } from "../reading-line";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}

const rect = (top: number, h: number) =>
  ({ top, bottom: top + h, left: 0, right: 800, width: 800, height: h, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

/** Content-space top of each block. T is far below a 600px viewport. */
const TOPS: Record<string, number> = { A: 0, B: 400, T: 3000 };

function mountRig() {
  const row = document.createElement("div");
  row.setAttribute("data-virgil-row-scroll", "");
  row.style.overflowY = "auto";
  row.getBoundingClientRect = () => rect(0, 600);
  const pod = document.createElement("div");
  pod.style.overflow = "clip";
  pod.getBoundingClientRect = () => rect(-row.scrollTop, 4000);
  const element = document.createElement("div");
  pod.appendChild(element);
  row.appendChild(pod);
  document.body.appendChild(row);
  const editor = new Editor({
    element,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: Object.keys(TOPS).map((uuid) => ({
        type: "paragraph",
        attrs: { uuid },
        content: [{ type: "text", text: `Block ${uuid}.` }],
      })),
    },
  });
  const starts: Array<{ uuid: string; pos: number }> = [];
  editor.state.doc.forEach((n, offset) => starts.push({ uuid: n.attrs.uuid, pos: offset }));
  vi.spyOn(editor.view, "coordsAtPos").mockImplementation((pos: number) => {
    let hit = starts[0];
    for (const s of starts) if (s.pos < pos) hit = s;
    const top = TOPS[hit.uuid] - row.scrollTop;
    return { top, bottom: top + 20, left: 0, right: 0 };
  });
  return { editor, row, pod };
}

let cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.forEach((f) => f());
  cleanup = [];
  document.body.innerHTML = "";
});

describe("text-to-code arrow lands on the reading line (task 1099)", () => {
  it("scrolls the ROW (not the clip pod) so T's top sits on the reading line", () => {
    const { editor, row, pod } = mountRig();
    cleanup.push(() => editor.destroy());
    let state = EditorState.create({ doc: "\\begin{document}\nBlock T.\n\\end{document}\n" });
    const cm = {
      get state() { return state; },
      dispatch(spec: Parameters<EditorState["update"]>[0]) { state = state.update(spec).state; },
    } as unknown as CMView;
    const bridge = createCodePaneBridge({
      editor: editor as unknown as TipTapEditor,
      view: cm,
      initialPreamble: "",
      initialPostamble: "",
    });
    cleanup.push(() => bridge.dispose());

    bridge.moveTextToCodeCursor();

    expect(pod.scrollTop).toBe(0);
    const expected = TOPS.T - chromeTopInset(editor.view.dom);
    expect(row.scrollTop).toBe(expected);
    // T's top now reads exactly on the line.
    const tPos = editor.state.selection.from;
    expect(editor.view.coordsAtPos(tPos).top).toBe(readingLineY(editor.view.dom, 0));
  });

  it("scrollPosToReadingLine is the same landing as the block door", () => {
    const { editor, row } = mountRig();
    cleanup.push(() => editor.destroy());
    let bPos = -1;
    editor.state.doc.forEach((n, off) => { if (n.attrs.uuid === "B") bPos = off + 1; });
    expect(scrollPosToReadingLine(editor.view, bPos)).toBe(true);
    expect(row.scrollTop).toBe(TOPS.B - chromeTopInset(editor.view.dom));
  });
});
