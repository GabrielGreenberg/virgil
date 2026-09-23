// @vitest-environment jsdom
//
// Task 559 — THE CODE PANE IS A COALESCER ONE STEP UPSTREAM OF THE MODEL.
//
// A code-view keystroke sits in CodeMirror for 600 ms and is only THEN
// re-parsed into TipTap. The bundle writer (`useDocument.flushPending`)
// snapshots the LIVE model. So when an app-wide door flushes "every pending
// debounce", the ORDER decides whether the last 600 ms of code typing reach
// disk: the writer's registration is the older one (its host mounts first),
// and under a flat start-everything-at-once it snapshots the model BEFORE the
// bridge has pushed the edit in — the edit then lands in a model the page is
// about to discard. The registry's `settle` phase is what makes the bridge's
// flush complete before any writer starts.
//
// These legs drive the REAL bridge over a REAL CodeMirror state and a fake
// TipTap editor whose `getJSON` returns whatever `setContent` last pushed —
// which is exactly what `flushPending`'s `editor.getJSON()` snapshot sees.

vi.mock("@/lib/storage", () => ({
  readTex: vi.fn(() => Promise.resolve("")),
}));

// The parse is MOCKED for the refusal leg, deliberately — the same reason the
// code-pane gate suite gives: the contract is "refuse a lossy parse", not
// "refuse this month's parser bug", and a fixture keyed to a live parser
// defect stops testing the gate the day the parser is fixed (task 356 already
// made an unterminated environment word-complete, which is exactly what
// retired this leg's first fixture).
vi.mock("@/lib/latex-parser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/latex-parser")>();
  return { ...actual, parseLatex: vi.fn(actual.parseLatex) };
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
import {
  __resetForTests as resetFlushers,
  flushAllPendingDocs,
  flushPendingForDoc,
  registerPendingFlusher,
} from "@/lib/multi-window/pending-saves";

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
  // The model the writer will snapshot: whatever the bridge last pushed.
  let model: JSONContent = DOC;
  const editor = {
    on: vi.fn(),
    off: vi.fn(),
    commands: {
      setContent: (json: JSONContent) => {
        model = json;
      },
    },
    getJSON: () => model,
    schema: MAIN_SCHEMA,
    state: { selection: null },
  } as unknown as TipTapEditor;
  const bridge = createCodePaneBridge({
    editor,
    view,
    initialPreamble: seed.preamble,
    initialPostamble: seed.postamble,
  });
  /** A keystroke in the code pane — armed, NOT flushed (the 600 ms has not elapsed). */
  const type = (from: number, to: number, insert: string) => {
    view.dispatch({ changes: { from, to, insert } });
    bridge.onCodeMirrorUpdate({
      docChanged: true,
      transactions: [],
    } as unknown as ViewUpdate);
  };
  /** What `useDocument.flushPending` would write: the live model, serialized. */
  const snapshot = () => serializeToLatex(editor.getJSON());
  return { view, bridge, editor, type, snapshot, initialText };
}

const parseLatexMock = vi.mocked(parseLatex);

beforeEach(() => {
  resetFlushers();
  parseLatexMock.mockClear();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the code pane's pending re-parse settles before the bundle write (task 559)", () => {
  it("DEFECT LEG — the writer registered first still snapshots the code edit, because settle completes before write starts", async () => {
    const { bridge, type, snapshot, initialText } = setup();
    let written: string | null = null;
    // Host order: useDocument (the writer) mounts before CodeEditor (the settler).
    registerPendingFlusher("doc-1", async () => {
      written = snapshot();
    });
    registerPendingFlusher(
      "doc-1",
      async () => {
        bridge.flush();
      },
      { phase: "settle" },
    );
    const at = initialText.indexOf("Alpha");
    type(at, at + "Alpha".length, "Aleph");
    // The 600 ms debounce is armed and has NOT fired.
    expect(snapshot()).toContain("Alpha");

    await flushPendingForDoc("doc-1");
    expect(written).not.toBeNull();
    expect(written!).toContain("Aleph");
    expect(written!).not.toContain("Alpha");
    bridge.dispose();
  });

  it("…and through the app-wide door the reload takes", async () => {
    const { bridge, type, snapshot, initialText } = setup();
    let written: string | null = null;
    registerPendingFlusher("doc-1", async () => {
      written = snapshot();
    });
    registerPendingFlusher(
      "doc-1",
      async () => {
        bridge.flush();
      },
      { phase: "settle" },
    );
    const at = initialText.indexOf("Alpha");
    type(at, at + "Alpha".length, "Aleph");
    await flushAllPendingDocs();
    expect(written!).toContain("Aleph");
    bridge.dispose();
  });

  it("WHY THE PHASE EXISTS — the same bridge flush registered as an ordinary write member lands AFTER the snapshot", async () => {
    // This is the pre-phase shape (every flusher started at once, in
    // registration order). It is the leg that proves the phase is
    // load-bearing rather than tidy: with the bridge as a plain member the
    // writer snapshots a stale model and the code edit reaches disk never.
    const { bridge, type, snapshot, initialText } = setup();
    let written: string | null = null;
    registerPendingFlusher("doc-1", async () => {
      written = snapshot();
    });
    registerPendingFlusher("doc-1", async () => {
      bridge.flush();
    });
    const at = initialText.indexOf("Alpha");
    type(at, at + "Alpha".length, "Aleph");
    await flushPendingForDoc("doc-1");
    expect(written!).toContain("Alpha");
    expect(written!).not.toContain("Aleph");
    bridge.dispose();
  });

  it("CONTROL — with nothing pending in the code pane the settle flush is a no-op and the snapshot is byte-identical", async () => {
    const { bridge, snapshot, initialText } = setup();
    let written: string | null = null;
    registerPendingFlusher("doc-1", async () => {
      written = snapshot();
    });
    registerPendingFlusher(
      "doc-1",
      async () => {
        bridge.flush();
      },
      { phase: "settle" },
    );
    await flushPendingForDoc("doc-1");
    expect(written).toBe(initialText);
    bridge.dispose();
  });

  it("a REFUSED parse mid-flush keeps the last-good model — the settle door inherits the pane's own gates", async () => {
    const { bridge, type, snapshot, initialText } = setup();
    let written: string | null = null;
    registerPendingFlusher("doc-1", async () => {
      written = snapshot();
    });
    registerPendingFlusher(
      "doc-1",
      async () => {
        bridge.flush();
      },
      { phase: "settle" },
    );
    // The parse SUCCEEDS and quietly represents almost nothing — the shape
    // mid-typing produces. The words gate refuses, the model stays what it
    // was, and the writer snapshots the last-good model: nothing lossy is
    // written through the settle door.
    parseLatexMock.mockReturnValueOnce({
      type: "doc",
      content: [{ type: "paragraph", attrs: { uuid: "0001" } }],
    });
    const at = initialText.indexOf("Alpha");
    type(at, at, "X");
    await flushPendingForDoc("doc-1");
    expect(parseLatexMock).toHaveBeenCalled();
    expect(written).toBe(initialText);
    bridge.dispose();
  });
});
