// @vitest-environment jsdom
//
// Task 357, hole 2 (+ its hole-3 half) — THE CODE-PANE GATES.
//
// A code-view keystroke re-parses the whole `.tex` 600 ms later and pushes the
// result into TipTap with `emitUpdate: true`, which arms the autosaver. Before
// these gates the ONLY refusal was a parse THROW — and the dangerous parse is
// the one that SUCCEEDS while representing less than it was given, which is
// exactly what mid-typing produces, since an unterminated construct exists for
// as long as it takes to type its closer.
//
// Two questions, two gates, and neither can answer for the other:
//
//   WORDS  — does the model represent the TEXT? (`checkTexPreservation`, the
//            same rule the load and write gates use)
//   SCHEMA — can the EDITOR hold the model? `serializeToLatex` walks plain
//            JSON and will happily emit a complete document from a model naming
//            a node type the schema has not got; `setContent` would then
//            swallow that mismatch into an EMPTY document and blank the live
//            paper, measured word-complete on the way past.
//
// Both refuse the same way: `setContent` is never called, so TipTap keeps the
// last-good model and the refusal surfaces inline in the code pane — never on
// the document-wide preservation banner, because a model that never entered is
// a hazard AVERTED, not one pending.
//
// The parse is MOCKED in both defect legs, deliberately: the gate's contract is
// "refuse a lossy parse", not "refuse this month's parser bug", and a fixture
// keyed to a live parser defect stops testing the gate the day the parser is
// fixed.

vi.mock("@/lib/storage", () => ({
  readTex: vi.fn(() => Promise.resolve("")),
}));

vi.mock("@/lib/latex-parser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/latex-parser")>();
  return { ...actual, parseLatex: vi.fn(actual.parseLatex) };
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import type { Editor as TipTapEditor, JSONContent } from "@tiptap/react";
import { getSchema } from "@tiptap/core";
import { createCodePaneBridge } from "@/lib/code-pane-bridge";
import { serializeToLatex } from "@/lib/latex-serializer";
import { extractPreambleAndPostamble, parseLatex } from "@/lib/latex-parser";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { getPreservationNotice, clearPreservationNotice } from "@/lib/preservation-notice";

const parseLatexMock = vi.mocked(parseLatex);

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}
const MAIN_SCHEMA = getSchema(buildEditorExtensions(mainCtx()));

const DOC: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: { uuid: "0001" },
      content: [
        {
          type: "text",
          text: "Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon.",
        },
      ],
    },
  ],
};

function setup() {
  const initialText = serializeToLatex(DOC);
  const seed = extractPreambleAndPostamble(initialText)!;
  let state = EditorState.create({ doc: initialText });
  const view = {
    get state() {
      return state;
    },
    dispatch(spec: Parameters<EditorState["update"]>[0]) {
      state = state.update(spec).state;
    },
  } as unknown as EditorView;
  const setContent = vi.fn();
  const editor = {
    on: vi.fn(),
    off: vi.fn(),
    commands: { setContent },
    getJSON: () => DOC,
    schema: MAIN_SCHEMA,
    state: { selection: null },
  } as unknown as TipTapEditor;
  const onParseError = vi.fn();
  const bridge = createCodePaneBridge({
    editor,
    view,
    initialPreamble: seed.preamble,
    initialPostamble: seed.postamble,
    onParseError,
  });
  return { view, bridge, setContent, onParseError, initialText };
}

/** A user keystroke in the code pane, then the debounced flush, synchronously. */
function typeThenFlush(
  view: EditorView,
  bridge: ReturnType<typeof createCodePaneBridge>,
  from: number,
  to: number,
  insert: string,
) {
  view.dispatch({ changes: { from, to, insert } });
  bridge.onCodeMirrorUpdate({
    docChanged: true,
    transactions: [],
  } as unknown as ViewUpdate);
  bridge.flush();
}

beforeEach(() => {
  parseLatexMock.mockClear();
  clearPreservationNotice();
});

describe("hole 2 — a parse that SUCCEEDS can still be lossy", () => {
  it("refuses a shrinking parse, keeps the last-good model, and says why", () => {
    const { view, bridge, setContent, onParseError, initialText } = setup();
    // The parse succeeds and quietly represents almost nothing.
    parseLatexMock.mockReturnValueOnce({
      type: "doc",
      content: [{ type: "paragraph", attrs: { uuid: "0001" } }],
    });

    const at = initialText.indexOf("Alpha");
    typeThenFlush(view, bridge, at, at, "X");

    expect(setContent).not.toHaveBeenCalled();
    expect(onParseError).toHaveBeenCalledTimes(1);
    expect(onParseError.mock.calls[0][0].message).toMatch(/would drop \d+ of \d+ content words/);
    bridge.dispose();
  });

  it("does NOT raise the document-wide banner — the model never entered", () => {
    const { view, bridge, initialText } = setup();
    parseLatexMock.mockReturnValueOnce({
      type: "doc",
      content: [{ type: "paragraph", attrs: { uuid: "0001" } }],
    });
    const at = initialText.indexOf("Alpha");
    typeThenFlush(view, bridge, at, at, "X");
    expect(getPreservationNotice("doc-1")).toBeNull();
    bridge.dispose();
  });

  it("applies an honest edit (the control)", () => {
    const { view, bridge, setContent, onParseError, initialText } = setup();
    const at = initialText.indexOf("Alpha");
    typeThenFlush(view, bridge, at, at + "Alpha".length, "Aleph");
    expect(setContent).toHaveBeenCalledTimes(1);
    expect(onParseError).not.toHaveBeenCalled();
    bridge.dispose();
  });

  it("clears the refusal once the user finishes typing the construct", () => {
    // The refusal is a state the user types their way OUT of — an
    // unterminated construct is the normal mid-edit condition, not an error.
    const { view, bridge, setContent, onParseError, initialText } = setup();
    parseLatexMock.mockReturnValueOnce({
      type: "doc",
      content: [{ type: "paragraph", attrs: { uuid: "0001" } }],
    });
    const at = initialText.indexOf("Alpha");
    typeThenFlush(view, bridge, at, at, "X");
    expect(setContent).not.toHaveBeenCalled();

    typeThenFlush(view, bridge, at, at + 1, "");
    expect(setContent).toHaveBeenCalledTimes(1);
    expect(onParseError).toHaveBeenLastCalledWith(null);
    bridge.dispose();
  });
});

describe("hole 3 — a parse the EDITOR cannot hold", () => {
  it("refuses a schema-invalid parse the words rule calls complete", () => {
    const { view, bridge, setContent, onParseError, initialText } = setup();
    // Word-for-word the same document — carried by a node kind this build's
    // schema has never heard of (a `.tex` written by a NEWER Virgil). The
    // serializer emits it happily; `setContent` would blank the paper.
    parseLatexMock.mockReturnValueOnce({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "0001" },
          content: [
            {
              type: "text",
              text: "Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon.",
            },
          ],
        },
        { type: "sonnetBlock", attrs: { uuid: "0002" } },
      ],
    });

    const at = initialText.indexOf("Alpha");
    typeThenFlush(view, bridge, at, at, "X");

    expect(setContent).not.toHaveBeenCalled();
    expect(onParseError).toHaveBeenCalledTimes(1);
    const msg = onParseError.mock.calls[0][0].message;
    expect(msg).toMatch(/cannot represent this document/);
    expect(msg).toMatch(/sonnetBlock/);
    bridge.dispose();
  });
});
