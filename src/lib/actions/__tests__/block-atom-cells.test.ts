// @vitest-environment jsdom
//
// CHIP 6a back-fill (dispatched as part of CHIP 6b) — the block-ATOM grid cells'
// cross-surface behavioral proof. CHIP 6a landed `figureRun` / `graphicsRun` /
// `mathRun` + the `smartInsertBlock` SSOT but was interrupted before its
// dedicated behavioral test; this is that test.
//
// WHAT IS PROVEN (driving the REAL editor stack — the actual
// `buildEditorExtensions` schema for figureBlock / graphicsBlock / inlineMath /
// displayMath, the real `smartInsertBlock`, and the registry rows' `run()`):
//
//   smartInsertBlock (the SSOT under figure/graphics):
//     - a COLLAPSED caret → a plain insert (the block lands, selection untouched);
//     - a NON-EMPTY selection → the selection is REPLACED (deleteSelection then
//       insert — the documented REPLACE policy);
//     - the returned `{ uuid, pos }` LOCATES the inserted node in the post-dispatch
//       doc (pos shifts under deleteSelection, so this is load-bearing).
//
//   figureRun:
//     - inserts a `figureBlock` (with a `figureCaption` child) at the caret;
//     - with a non-empty selection, REPLACES it;
//     - FIRES `ctx.openFigurePopover` with the inserted block's seed (kind
//       "figureBlock", a synthesized `raw`, and the block's live `pos`/rect).
//
//   graphicsRun:
//     - inserts a `graphicsBlock` the same way (no caption child);
//     - FIRES `ctx.openFigurePopover` with kind "graphicsBlock" + the stub command.
//
//   mathRun (WRAP-based, NOT smartInsertBlock):
//     - a non-empty selection becomes the atom's `latex` (selected text → latex);
//     - a collapsed caret → the placeholder ("x" inline, "\int f(x)\,dx" display).
//
// (The extension barrel transitively imports `@/lib/storage`; stub it — the same
// gotcha as the sibling action tests. `requestAnimationFrame` is stubbed to run
// synchronously so the figure/graphics popover-open — scheduled one rAF after the
// insert so the NodeView DOM exists — fires within the test.)
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

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

import { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { smartInsertBlock } from "@/lib/tiptap/smart-insert";
import {
  figureRun,
  graphicsRun,
  VIRGIL_ACTION_REGISTRY,
  type ActionContext,
} from "@/lib/actions/action-registry";

// ---------------------------------------------------------------------------
// Real editor stack
// ---------------------------------------------------------------------------

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

/** Mount a real main editor over a single paragraph (uuid "para-A"). */
function mountEditor(text: string): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "para-A" },
          content: text ? [{ type: "text", text }] : [],
        },
      ],
    },
  });
}

/** Place a collapsed caret inside the first block at offset `n` (doc pos 1+n). */
function placeCaret(editor: Editor, n: number): void {
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1 + n)),
  );
}

/** Select a text range inside the first block (offsets relative to block start). */
function selectRange(editor: Editor, from: number, to: number): void {
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, 1 + from, 1 + to),
    ),
  );
}

/** The first node of `typeName` in the doc, or null. */
function firstOfType(editor: Editor, typeName: string): PMNode | null {
  let found: PMNode | null = null;
  editor.state.doc.descendants((node) => {
    if (!found && node.type.name === typeName) found = node;
    return !found;
  });
  return found;
}

/** How many `typeName` nodes are in the doc. */
function countOfType(editor: Editor, typeName: string): number {
  let n = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === typeName) n += 1;
    return true;
  });
  return n;
}

// Run any queued rAF callback synchronously (the figure/graphics popover-open is
// scheduled one rAF after the insert so the NodeView DOM can be measured).
let rafStub: ReturnType<typeof vi.spyOn> | undefined;

// jsdom has no layout engine, so `getClientRects` / `getBoundingClientRect` are
// missing on Range/Element — and `editor.chain().focus()` (which figureRun /
// graphicsRun / mathRun / smartInsertBlock all call) triggers ProseMirror's
// `scrollToSelection` → `coordsAtPos` → `getClientRects`. Shim them with empty
// rects so the focus/scroll path is a harmless no-op. (The sibling tex/example
// tests dodge this only because their creators dispatch WITHOUT a `.focus()`.)
const ZERO_RECT = {
  top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0,
  toJSON: () => ({}),
} as DOMRect;
function installLayoutShims(): void {
  const emptyList = Object.assign([], { item: () => null }) as unknown as DOMRectList;
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () => emptyList;
  }
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = () => ZERO_RECT;
  }
  if (!Element.prototype.getClientRects) {
    Element.prototype.getClientRects = () => emptyList;
  }
}

beforeEach(() => {
  installLayoutShims();
  rafStub = vi
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
});

afterEach(() => {
  rafStub?.mockRestore();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// smartInsertBlock — the SSOT REPLACE policy + the {uuid, pos} locator
// ---------------------------------------------------------------------------

describe("smartInsertBlock REPLACE policy", () => {
  it("a COLLAPSED caret is a plain insert (the block lands, text preserved)", () => {
    const editor = mountEditor("hello world");
    placeCaret(editor, 5); // inside "hello"
    const type = editor.state.schema.nodes.graphicsBlock;
    const { uuid, pos } = smartInsertBlock({ editor, type, attrs: { uuid: "" } });

    // The block landed.
    expect(countOfType(editor, "graphicsBlock")).toBe(1);
    // The paragraph text survived (a plain insert, not a replace).
    expect(editor.state.doc.textContent).toContain("hello world");
    // The returned {uuid, pos} locates the inserted node.
    expect(uuid.length).toBeGreaterThan(0);
    expect(pos).toBeGreaterThanOrEqual(0);
    const at = editor.state.doc.nodeAt(pos);
    expect(at?.type.name).toBe("graphicsBlock");
    expect(at?.attrs.uuid).toBe(uuid);
  });

  it("a NON-EMPTY selection is REPLACED (deleteSelection then insert)", () => {
    const editor = mountEditor("alpha beta gamma");
    selectRange(editor, 6, 10); // "beta"
    const type = editor.state.schema.nodes.graphicsBlock;
    const { uuid, pos } = smartInsertBlock({ editor, type, attrs: { uuid: "" } });

    expect(countOfType(editor, "graphicsBlock")).toBe(1);
    // "beta" was the selection — it is GONE (replaced by the block).
    expect(editor.state.doc.textContent).not.toContain("beta");
    expect(editor.state.doc.textContent).toContain("alpha");
    expect(editor.state.doc.textContent).toContain("gamma");
    // The locator still finds the node after the position-shifting delete.
    expect(editor.state.doc.nodeAt(pos)?.attrs.uuid).toBe(uuid);
  });

  it("mints a collision-free uuid (distinct from an existing graphicsBlock uuid)", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = new Editor({
      element,
      editable: true,
      extensions: buildEditorExtensions(mainCtx()),
      content: {
        type: "doc",
        content: [
          { type: "paragraph", attrs: { uuid: "para-A" }, content: [{ type: "text", text: "x" }] },
          { type: "graphicsBlock", attrs: { uuid: "gfx-EXISTING", command: "\\includegraphics{}", source: "", widthPercent: 50 } },
        ],
      },
    });
    placeCaret(editor, 1);
    const type = editor.state.schema.nodes.graphicsBlock;
    const { uuid } = smartInsertBlock({ editor, type, attrs: { uuid: "" } });
    expect(uuid).not.toBe("gfx-EXISTING");
    expect(countOfType(editor, "graphicsBlock")).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// figureRun — insert a figureBlock + fire openFigurePopover
// ---------------------------------------------------------------------------

describe("figureRun", () => {
  function ctxFor(editor: Editor, openFigurePopover: ActionContext["openFigurePopover"]): ActionContext {
    return {
      editor,
      view: editor.view,
      ref: {
        kind: "selection",
        from: editor.state.selection.from,
        to: editor.state.selection.to,
        paragraphId: "",
      },
      surface: "lightning",
      openFigurePopover,
    };
  }

  it("inserts a figureBlock (with a figureCaption child) at the caret", () => {
    const editor = mountEditor("body text");
    placeCaret(editor, 4);
    figureRun(ctxFor(editor, vi.fn()));

    expect(countOfType(editor, "figureBlock")).toBe(1);
    const fig = firstOfType(editor, "figureBlock");
    expect(fig).not.toBeNull();
    // The figure carries a figureCaption sub-node (the `content` seed).
    let hasCaption = false;
    fig!.descendants((n) => {
      if (n.type.name === "figureCaption") hasCaption = true;
      return true;
    });
    expect(hasCaption).toBe(true);
    // The body text survived (collapsed-caret insert).
    expect(editor.state.doc.textContent).toContain("body text");
  });

  it("REPLACES a non-empty selection (the documented smartInsertBlock policy)", () => {
    const editor = mountEditor("keep DROP keep");
    selectRange(editor, 5, 9); // "DROP"
    figureRun(ctxFor(editor, vi.fn()));

    expect(countOfType(editor, "figureBlock")).toBe(1);
    expect(editor.state.doc.textContent).not.toContain("DROP");
  });

  it("FIRES openFigurePopover with the inserted block's seed (kind, raw, pos)", () => {
    const editor = mountEditor("caption me");
    placeCaret(editor, 3);
    const spy = vi.fn();
    figureRun(ctxFor(editor, spy));

    // rAF is stubbed synchronous, so the popover-open fired already.
    expect(spy).toHaveBeenCalledTimes(1);
    const seed = spy.mock.calls[0][0] as { kind: string; raw: string; pos: number; rect: DOMRect };
    expect(seed.kind).toBe("figureBlock");
    // The seed pos locates the live figureBlock in the doc.
    expect(editor.state.doc.nodeAt(seed.pos)?.type.name).toBe("figureBlock");
    // The synthesized raw carries the figure LaTeX scaffold (a \caption, at least).
    expect(seed.raw).toContain("\\caption");
  });
});

// ---------------------------------------------------------------------------
// graphicsRun — insert a graphicsBlock + fire openFigurePopover
// ---------------------------------------------------------------------------

describe("graphicsRun", () => {
  function ctxFor(editor: Editor, openFigurePopover: ActionContext["openFigurePopover"]): ActionContext {
    return {
      editor,
      view: editor.view,
      ref: {
        kind: "selection",
        from: editor.state.selection.from,
        to: editor.state.selection.to,
        paragraphId: "",
      },
      surface: "lightning",
      openFigurePopover,
    };
  }

  it("inserts a graphicsBlock at the caret", () => {
    const editor = mountEditor("image here");
    placeCaret(editor, 5);
    graphicsRun(ctxFor(editor, vi.fn()));

    expect(countOfType(editor, "graphicsBlock")).toBe(1);
    expect(editor.state.doc.textContent).toContain("image here");
  });

  it("REPLACES a non-empty selection", () => {
    const editor = mountEditor("keep DROP keep");
    selectRange(editor, 5, 9); // "DROP"
    graphicsRun(ctxFor(editor, vi.fn()));

    expect(countOfType(editor, "graphicsBlock")).toBe(1);
    expect(editor.state.doc.textContent).not.toContain("DROP");
  });

  it("FIRES openFigurePopover with kind 'graphicsBlock' + the stub command", () => {
    const editor = mountEditor("pic");
    placeCaret(editor, 1);
    const spy = vi.fn();
    graphicsRun(ctxFor(editor, spy));

    expect(spy).toHaveBeenCalledTimes(1);
    const seed = spy.mock.calls[0][0] as { kind: string; raw: string; pos: number };
    expect(seed.kind).toBe("graphicsBlock");
    expect(seed.raw).toContain("\\includegraphics");
    expect(editor.state.doc.nodeAt(seed.pos)?.type.name).toBe("graphicsBlock");
  });
});

// ---------------------------------------------------------------------------
// mathRun — WRAP the selection into the atom's latex (NOT smartInsertBlock)
// ---------------------------------------------------------------------------

describe("mathRun (wrap-based)", () => {
  function ctxFor(editor: Editor): ActionContext {
    return {
      editor,
      view: editor.view,
      ref: {
        kind: "selection",
        from: editor.state.selection.from,
        to: editor.state.selection.to,
        paragraphId: "",
      },
      surface: "lightning",
    };
  }

  const inlineRow = VIRGIL_ACTION_REGISTRY["inline-math"]!;
  const displayRow = VIRGIL_ACTION_REGISTRY["display-math"]!;

  it("inline: the SELECTED text becomes the inlineMath latex", () => {
    const editor = mountEditor("wrap E=mc^2 here");
    selectRange(editor, 5, 11); // "E=mc^2"
    inlineRow.run(ctxFor(editor));

    const math = firstOfType(editor, "inlineMath");
    expect(math).not.toBeNull();
    expect(math!.attrs.latex).toBe("E=mc^2");
    // The selected source text was consumed (replaced by the atom).
    expect(editor.state.doc.textContent).not.toContain("E=mc^2");
  });

  it("inline: a COLLAPSED caret inserts the placeholder latex ('x')", () => {
    const editor = mountEditor("nothing selected");
    placeCaret(editor, 3);
    inlineRow.run(ctxFor(editor));

    const math = firstOfType(editor, "inlineMath");
    expect(math).not.toBeNull();
    expect(math!.attrs.latex).toBe("x");
  });

  it("display: the SELECTED text becomes the displayMath latex", () => {
    const editor = mountEditor("see \\sum_i x_i now");
    selectRange(editor, 4, 14); // "\sum_i x_i"
    displayRow.run(ctxFor(editor));

    const math = firstOfType(editor, "displayMath");
    expect(math).not.toBeNull();
    expect(math!.attrs.latex).toBe("\\sum_i x_i");
  });

  it("display: a COLLAPSED caret inserts the display placeholder latex", () => {
    const editor = mountEditor("empty");
    placeCaret(editor, 2);
    displayRow.run(ctxFor(editor));

    const math = firstOfType(editor, "displayMath");
    expect(math).not.toBeNull();
    expect(math!.attrs.latex).toBe("\\int f(x)\\,dx");
  });
});

// ---------------------------------------------------------------------------
// DATA-LOSS GUARD — an atom-only selection (a `$\lambda$` / citation pill /
// `\ref` selected alone) must NOT be destroyed by the math / tex cells. Before
// the fix the non-empty-but-text-empty selection took the deleteSelection()
// branch and the atom was REPLACED by a placeholder. (atom-only-empty-text
// class — see drag-handle-actions archive fix + this audit sweep.)
// ---------------------------------------------------------------------------

describe("atom-only selection — math/tex preserve the atom (no data loss)", () => {
  function selCtx(editor: Editor): ActionContext {
    return {
      editor,
      view: editor.view,
      ref: {
        kind: "selection",
        from: editor.state.selection.from,
        to: editor.state.selection.to,
        paragraphId: "",
      },
      surface: "lightning",
    };
  }
  // A paragraph whose ONLY content is a pre-existing inlineMath atom, with that
  // atom selected exactly ([1,2) — the atom's nodeSize is 1).
  function mountAtomOnly(): Editor {
    const editor = mountEditor("");
    const im = editor.state.schema.nodes.inlineMath;
    editor.view.dispatch(editor.state.tr.insert(1, im.create({ latex: "\\lambda" })));
    selectRange(editor, 1, 2);
    return editor;
  }
  const inlineRow = VIRGIL_ACTION_REGISTRY["inline-math"]!;
  const displayRow = VIRGIL_ACTION_REGISTRY["display-math"]!;
  const texRow = VIRGIL_ACTION_REGISTRY["tex"]!;

  it("inline-math cell leaves the selected atom intact (no 'x' placeholder swap)", () => {
    const editor = mountAtomOnly();
    inlineRow.run(selCtx(editor));
    expect(countOfType(editor, "inlineMath")).toBe(1);
    // The ORIGINAL atom survives — the old bug deleted it and dropped 'x'.
    expect(firstOfType(editor, "inlineMath")!.attrs.latex).toBe("\\lambda");
  });

  it("display-math cell leaves the selected atom intact (no displayMath inserted)", () => {
    const editor = mountAtomOnly();
    displayRow.run(selCtx(editor));
    expect(countOfType(editor, "inlineMath")).toBe(1);
    expect(firstOfType(editor, "inlineMath")!.attrs.latex).toBe("\\lambda");
    expect(countOfType(editor, "displayMath")).toBe(0);
  });

  it("tex cell leaves the selected atom intact (no texBlock inserted)", () => {
    const editor = mountAtomOnly();
    texRow.run(selCtx(editor));
    expect(countOfType(editor, "inlineMath")).toBe(1);
    expect(firstOfType(editor, "inlineMath")!.attrs.latex).toBe("\\lambda");
    expect(countOfType(editor, "texBlock")).toBe(0);
  });
});
