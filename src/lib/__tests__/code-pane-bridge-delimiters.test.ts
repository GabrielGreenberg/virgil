// @vitest-environment jsdom
//
// Delimiter-persistence contract of the code-pane bridge
// (`src/lib/code-pane-bridge.ts`):
//
//   1. a code edit that CHANGES the preamble/postamble fires
//      `persistDelimiters` (after the parsed body is pushed into TipTap),
//      with the newly extracted values;
//   2. a body-only edit does NOT fire it (the autosaver owns body writes);
//   3. a delimiter edit made while the body fails to parse is HELD, not
//      lost — the next successful flush persists it;
//   4. `setDelimiters` (style switch / external reload resync) updates the
//      closure, clears any pending persist (the values came FROM disk),
//      and forces a reverse sync so the CM text reflects them.
//
// Harness: a REAL CodeMirror `EditorState` behind a minimal view shim
// ({ state, dispatch }) — the bridge only reads `view.state` and calls
// `view.dispatch`, so this exercises the genuine extraction/diff logic on
// genuine CM documents without standing up an `EditorView` (whose layout
// machinery jsdom can't faithfully run). TipTap is a recording stub: the
// bridge only calls `on`/`off`, `commands.setContent`, and `getJSON`.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import type { Editor as TipTapEditor, JSONContent } from "@tiptap/react";
import { createCodePaneBridge } from "@/lib/code-pane-bridge";
import { serializeToLatex } from "@/lib/latex-serializer";
import { extractPreambleAndPostamble } from "@/lib/latex-parser";

// Partial-mock the parser so ONE test can force a parse failure (the real
// parseLatex is lenient and never throws); everything else passes through.
vi.mock("@/lib/latex-parser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/latex-parser")>();
  return { ...actual, parseLatex: vi.fn(actual.parseLatex) };
});
import { parseLatex } from "@/lib/latex-parser";
const parseLatexMock = vi.mocked(parseLatex);

const DOC: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: { uuid: "0001" },
      content: [{ type: "text", text: "Hello, world." }],
    },
  ],
};

function makeStubEditor(json: JSONContent) {
  const setContent = vi.fn();
  const editor = {
    on: vi.fn(),
    off: vi.fn(),
    commands: { setContent },
    getJSON: () => json,
    // Only touched inside try/catch paths (cursor band); a bare object is fine.
    state: { selection: null },
  } as unknown as TipTapEditor;
  return { editor, setContent };
}

/** Real CM EditorState behind the two members the bridge actually uses. */
function makeFakeView(initialText: string) {
  let state = EditorState.create({ doc: initialText });
  const view = {
    get state() {
      return state;
    },
    dispatch(spec: Parameters<EditorState["update"]>[0]) {
      state = state.update(spec).state;
    },
  } as unknown as EditorView;
  return { view, getText: () => state.doc.toString() };
}

/** Simulate a user keystroke: splice text, then a user-tagged ViewUpdate. */
function userEdit(
  view: EditorView,
  bridge: ReturnType<typeof createCodePaneBridge>,
  from: number,
  to: number,
  insert: string,
) {
  view.dispatch({ changes: { from, to, insert } });
  // No SYNC_ANNOTATION → the bridge treats it as a user edit.
  bridge.onCodeMirrorUpdate({
    docChanged: true,
    transactions: [],
  } as unknown as ViewUpdate);
}

// Build the initial pane text the way CodeEditor does on mount: serialize
// the live TipTap JSON with the disk delimiters, then seed the bridge with
// the delimiters extracted from that SAME text (so a body-only edit
// re-extracts byte-identical values).
function setup(persistDelimiters?: (d: { preamble: string; postamble: string }) => void) {
  const initialText = serializeToLatex(DOC);
  const seed = extractPreambleAndPostamble(initialText)!;
  const { view, getText } = makeFakeView(initialText);
  const { editor, setContent } = makeStubEditor(DOC);
  const bridge = createCodePaneBridge({
    editor,
    view,
    initialPreamble: seed.preamble,
    initialPostamble: seed.postamble,
    persistDelimiters,
  });
  return { view, getText, bridge, setContent, seed, initialText };
}

beforeEach(() => {
  parseLatexMock.mockClear();
});

describe("code-pane-bridge: persistDelimiters", () => {
  it("fires on a preamble edit, with the newly extracted delimiters, after the body push", () => {
    const persist = vi.fn();
    const { view, bridge, setContent, seed, initialText } = setup(persist);

    // Insert a package line right before \begin{document}.
    const at = initialText.indexOf("\\begin{document}");
    userEdit(view, bridge, at, at, "\\usepackage{fontspec}\n");
    bridge.flush(); // fire the debounced code→TipTap flush synchronously

    expect(setContent).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(1);
    const d = persist.mock.calls[0][0];
    expect(d.preamble).toContain("\\usepackage{fontspec}");
    expect(d.postamble).toBe(seed.postamble);
    // The closure tracked the edit too (reverse syncs will serialize with it).
    expect(bridge.getPreamble()).toContain("\\usepackage{fontspec}");
    bridge.dispose();
  });

  it("does NOT fire on a body-only edit", () => {
    const persist = vi.fn();
    const { view, bridge, setContent, initialText } = setup(persist);

    const at = initialText.indexOf("Hello, world.");
    userEdit(view, bridge, at, at + "Hello".length, "Goodbye");
    bridge.flush();

    expect(setContent).toHaveBeenCalledTimes(1); // body still synced to TipTap
    expect(persist).not.toHaveBeenCalled();
    bridge.dispose();
  });

  it("holds a delimiter edit across a parse failure and persists on the next good flush", () => {
    const persist = vi.fn();
    const { view, bridge, setContent, initialText } = setup(persist);

    // Flush 1: preamble edited, but the body parse blows up.
    parseLatexMock.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const at = initialText.indexOf("\\begin{document}");
    userEdit(view, bridge, at, at, "\\usepackage{fontspec}\n");
    bridge.flush();
    expect(setContent).not.toHaveBeenCalled(); // parse failed → TipTap untouched
    expect(persist).not.toHaveBeenCalled(); // …and nothing persisted

    // Flush 2: body-only fix, parse succeeds → the HELD delimiter edit lands.
    userEdit(view, bridge, 0, 0, "");
    bridge.flush();
    expect(setContent).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0][0].preamble).toContain(
      "\\usepackage{fontspec}",
    );
    bridge.dispose();
  });

  it("setDelimiters updates the closure, forces a reverse sync, and clears any pending persist", () => {
    const persist = vi.fn();
    const { view, getText, bridge, seed, initialText } = setup(persist);

    // Arm a pending persist via a parse-failed preamble edit…
    parseLatexMock.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const at = initialText.indexOf("\\begin{document}");
    userEdit(view, bridge, at, at, "\\usepackage{fontspec}\n");
    bridge.flush();
    expect(persist).not.toHaveBeenCalled();

    // …then a disk-authoritative resync (style switch / reload) arrives.
    const fromDisk = {
      preamble: seed.preamble.replace(
        "\\begin{document}",
        "\\usepackage{setspace}\n\\begin{document}",
      ),
      postamble: seed.postamble,
    };
    bridge.setDelimiters(fromDisk);

    // Reverse sync rewrote the CM text with the disk delimiters.
    expect(getText()).toContain("\\usepackage{setspace}");
    expect(getText()).not.toContain("fontspec");
    expect(bridge.getPreamble()).toContain("\\usepackage{setspace}");

    // The pending persist was cleared: a later body-only flush stays silent.
    const bodyAt = getText().indexOf("Hello, world.");
    userEdit(view, bridge, bodyAt, bodyAt + 5, "Howdy");
    bridge.flush();
    expect(persist).not.toHaveBeenCalled();
    bridge.dispose();
  });
});
