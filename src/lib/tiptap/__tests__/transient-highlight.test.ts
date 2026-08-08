// @vitest-environment jsdom
//
// TransientHighlightDecorator — task 120's contract.
//
// THE CLASS BUG: every transient (view-only) highlight band — search result,
// diagnostics error range, linked-anchor hover, revision text — was painted by
// `Editor.applyHighlight` as an ordinary `highlight` MARK, dispatched WITHOUT
// `addToHistory: false`. A UI signal was therefore living in the document:
//
//   1. the mark-add was a HISTORY ENTRY, so clicking a search result cleared
//      the redo branch (undone edits became unrecoverable);
//   2. the clear (`selectAll().unsetHighlight()`) was itself a recorded
//      doc-changing tx, so the first Cmd+Z after closing the search panel UNDID
//      the clear and RESURRECTED the amber band;
//   3. the tx was `docChanged`, so it armed the `useDocument` autosaver and
//      wrote an unedited doc to disk.
//
// THE FIX: a decoration replaced by a META-ONLY transaction. These tests drive
// the REAL `buildEditorExtensions("main")` stack (which registers the plugin)
// and the real `setTransientHighlights` bridge that `Editor.applyHighlight`
// calls, so they fail if the mark model comes back.
//
// (Storage stub guards the extension-barrel/@/lib/storage gotcha: the
// figure/graphics/tex NodeViews transitively import @/lib/storage.)
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "writeBib",
    "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  const mod: Record<string, unknown> = { isDevStorage: false };
  for (const name of STORAGE_FNS) mod[name] = vi.fn();
  return mod;
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  transientHighlightKey,
  setTransientHighlights,
  clearTransientHighlights,
  TRANSIENT_HIGHLIGHT_CLASS,
  TRANSIENT_HIGHLIGHT_COLOR,
} from "@/lib/tiptap/transient-highlight";
import { getBus } from "@/lib/tiptap/doc-structure";

const PARA_UUID = "p00001";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set([PARA_UUID]) },
    host: null,
  };
}

const editors: Editor[] = [];

function mountEditor(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: PARA_UUID },
          content: [{ type: "text", text: "alpha beta gamma delta" }],
        },
      ],
    },
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
  document.body.innerHTML = "";
});

/** The live bands the plugin currently exposes. */
function liveBands(editor: Editor): Array<{ from: number; to: number }> {
  const set = transientHighlightKey.getState(editor.state);
  if (!set) return [];
  return set.find().map((d) => ({ from: d.from, to: d.to }));
}

/** Range of the word `w` in the single paragraph. */
function wordRange(editor: Editor, w: string): { from: number; to: number } {
  const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n");
  const idx = text.indexOf(w);
  if (idx < 0) throw new Error(`no "${w}" in doc`);
  // +1 for the paragraph's opening token.
  return { from: idx + 1, to: idx + 1 + w.length };
}

/** Any `highlight` mark anywhere in the doc? (There must never be one.) */
function hasHighlightMark(editor: Editor): boolean {
  let found = false;
  editor.state.doc.descendants((node) => {
    if (found) return false;
    if (node.marks.some((m) => m.type.name === "highlight")) found = true;
    return !found;
  });
  return found;
}

describe("transient highlights are decorations, not document marks", () => {
  it("paints the band without touching the document or its marks", () => {
    const editor = mountEditor();
    const before = editor.state.doc.toJSON();
    const r = wordRange(editor, "beta");

    setTransientHighlights(editor.view, [
      { ...r, color: TRANSIENT_HIGHLIGHT_COLOR },
    ]);

    expect(liveBands(editor)).toEqual([{ from: r.from, to: r.to }]);
    expect(editor.state.doc.toJSON()).toEqual(before);
    expect(hasHighlightMark(editor)).toBe(false);
  });

  it("renders the band into the DOM with the requested color", () => {
    const editor = mountEditor();
    setTransientHighlights(editor.view, [
      { ...wordRange(editor, "beta"), color: TRANSIENT_HIGHLIGHT_COLOR },
    ]);

    const span = editor.view.dom.querySelector(
      `.${TRANSIENT_HIGHLIGHT_CLASS}`,
    ) as HTMLElement | null;
    expect(span).not.toBeNull();
    expect(span?.textContent).toBe("beta");
    // jsdom normalizes the inline style; assert on the parsed value.
    expect(span?.style.backgroundColor).not.toBe("");
    // No <mark> — the old carrier is gone.
    expect(editor.view.dom.querySelector("mark")).toBeNull();
  });

  it("dispatches a META-ONLY transaction — no steps, no docChanged, no update event", () => {
    const editor = mountEditor();
    const txs: Transaction[] = [];
    let updates = 0;
    editor.on("transaction", ({ transaction }) => txs.push(transaction));
    // `onUpdate` is what arms the useDocument autosaver.
    editor.on("update", () => { updates += 1; });

    setTransientHighlights(editor.view, [
      { ...wordRange(editor, "beta"), color: TRANSIENT_HIGHLIGHT_COLOR },
    ]);
    clearTransientHighlights(editor.view);

    expect(txs).toHaveLength(2);
    for (const tr of txs) {
      expect(tr.steps).toHaveLength(0);
      expect(tr.docChanged).toBe(false);
    }
    expect(updates).toBe(0);
  });

  it("clearing an already-empty set dispatches nothing", () => {
    const editor = mountEditor();
    let txs = 0;
    editor.on("transaction", () => { txs += 1; });

    clearTransientHighlights(editor.view);
    clearTransientHighlights(editor.view);
    expect(txs).toBe(0);

    setTransientHighlights(editor.view, [
      { ...wordRange(editor, "beta"), color: TRANSIENT_HIGHLIGHT_COLOR },
    ]);
    clearTransientHighlights(editor.view);
    expect(txs).toBe(2);
    // Now empty again — the redundant clear is a no-op.
    clearTransientHighlights(editor.view);
    expect(txs).toBe(2);
  });

  it("drops an out-of-range or inverted band instead of throwing", () => {
    const editor = mountEditor();
    const size = editor.state.doc.content.size;
    setTransientHighlights(editor.view, [
      { from: 1, to: size + 50, color: TRANSIENT_HIGHLIGHT_COLOR },
      { from: 5, to: 3, color: TRANSIENT_HIGHLIGHT_COLOR },
    ]);
    expect(liveBands(editor)).toEqual([]);
  });
});

describe("the undo/redo stacks are untouched", () => {
  it("painting a band does NOT eat the redo branch (symptom 1)", () => {
    const editor = mountEditor();
    editor.commands.setTextSelection(1);
    editor.commands.insertContent("EDIT ");
    expect(editor.state.doc.textContent).toContain("EDIT ");

    editor.commands.undo();
    expect(editor.state.doc.textContent).not.toContain("EDIT ");
    expect(editor.can().redo()).toBe(true);

    // The result click.
    setTransientHighlights(editor.view, [
      { ...wordRange(editor, "beta"), color: TRANSIENT_HIGHLIGHT_COLOR },
    ]);

    expect(editor.can().redo()).toBe(true);
    editor.commands.redo();
    expect(editor.state.doc.textContent).toContain("EDIT ");
  });

  it("closing the panel leaves no resurrectable band (symptom 2)", () => {
    const editor = mountEditor();
    editor.commands.setTextSelection(1);
    editor.commands.insertContent("EDIT ");

    setTransientHighlights(editor.view, [
      { ...wordRange(editor, "beta"), color: TRANSIENT_HIGHLIGHT_COLOR },
    ]);
    clearTransientHighlights(editor.view); // SR-F8-02 clear-on-close
    expect(liveBands(editor)).toEqual([]);

    // The FIRST Cmd+Z must undo the real edit — not resurrect the band.
    editor.commands.undo();
    expect(editor.state.doc.textContent).not.toContain("EDIT ");
    expect(liveBands(editor)).toEqual([]);
    expect(hasHighlightMark(editor)).toBe(false);
  });

  it("a paint + clear cycle adds no undoable step of its own", () => {
    const editor = mountEditor();
    // Nothing edited yet → nothing to undo, before or after the cycle.
    expect(editor.can().undo()).toBe(false);
    setTransientHighlights(editor.view, [
      { ...wordRange(editor, "beta"), color: TRANSIENT_HIGHLIGHT_COLOR },
    ]);
    clearTransientHighlights(editor.view);
    expect(editor.can().undo()).toBe(false);
  });
});

describe("keystroke sanctity", () => {
  it("maps the band through an edit without rebuilding or emitting", () => {
    const editor = mountEditor();
    const r = wordRange(editor, "gamma");
    setTransientHighlights(editor.view, [
      { ...r, color: TRANSIENT_HIGHLIGHT_COLOR },
    ]);

    const bus = getBus(editor);
    const emitBefore = bus?.emitCount ?? 0;

    // Type 3 plain characters BEFORE the band.
    editor.commands.setTextSelection(1);
    editor.commands.insertContent("xyz");

    expect(liveBands(editor)).toEqual([{ from: r.from + 3, to: r.to + 3 }]);
    // A plain in-paragraph keystroke is structurally null → no bus emit.
    expect(bus?.emitCount ?? 0).toBe(emitBefore);
  });

  it("drops the band when the text under it is deleted", () => {
    const editor = mountEditor();
    const r = wordRange(editor, "beta");
    setTransientHighlights(editor.view, [
      { ...r, color: TRANSIENT_HIGHLIGHT_COLOR },
    ]);
    editor.commands.setTextSelection(r);
    editor.commands.deleteSelection();
    expect(liveBands(editor)).toEqual([]);
  });
});

describe("Editor.applyHighlight is wired to the decoration, not the mark", () => {
  const EDITOR_SRC = readFileSync(
    resolve(__dirname, "../../../components/Editor.tsx"),
    "utf8",
  );

  it("no longer selects the whole doc to clear a band", () => {
    // The select-the-whole-doc dance existed ONLY because a mark can't be
    // scoped to "the transient one" — clearing meant unsetting every highlight
    // in the document. (The mark WRITE itself is pinned repo-wide by
    // `lib/__tests__/transient-highlight-guardrail.test.ts`.)
    expect(EDITOR_SRC).not.toMatch(/\.selectAll\(\)/);
  });

  it("paints through the transient-highlight bridge", () => {
    expect(EDITOR_SRC).toContain(
      'from "@/lib/tiptap/transient-highlight"',
    );
    expect(EDITOR_SRC).toContain("setTransientHighlights(editor.view,");
    expect(EDITOR_SRC).toContain("clearTransientHighlights(editor.view)");
  });
});
