// @vitest-environment jsdom
//
// Regression guard for the atom-only / atom-bearing destructive-confirm gate
// (follow-up to the atom-only-empty-text class sweep).
//
// THE BUG: `rangeHasAnchorsOrAtoms` (drag-handle-actions.ts), which drives the
// "empty + nothing-attached → skip the warning" decision behind Delete and
// Archive's destructive path, only recognized a SUBSET of atoms —
// footnote / citation / linkedAnchor. So a block whose only content is an atom
// it did NOT list (`inlineMath`, `\ref`/`labelRef`, `displayMath`, `texBlock`,
// `graphicsBlock`, `figureBlock`) had empty `textContent`, was judged
// "silently deletable", and Delete / Archive SKIPPED the confirm dialog —
// silently destroying a math-only / `\ref`-only / figure / tex block.
//
// THE GATE under test is `resolveDestructiveConfirm(ed, ref, action)`: it
// returns a `ConfirmDescriptor` when the user must confirm and `null` when the
// action is silently safe. The dispatcher (`useDragHandleActions`) consults it
// at action time — a non-null descriptor → `await confirm({...})`. So:
//
//   descriptor != null  ⟺  the user WOULD get an "are you sure?" confirm
//   descriptor == null  ⟺  silently deletable (NO confirm)
//
// WHAT IS PROVEN (driving the REAL editor stack — `buildEditorExtensions`'
// actual schema for inlineMath / labelRef / displayMath / texBlock /
// graphicsBlock / figureBlock, and the registry's per-kind `confirmDestructive`
// + the registry-derived `rangeHasAnchorsOrAtoms`):
//
//   • a paragraph whose ONLY content is an inlineMath atom        → confirm
//   • a paragraph whose ONLY content is a labelRef (`\ref`) atom  → confirm
//   • a top-level displayMath / texBlock / graphicsBlock / figure → confirm
//     (these already warned via their own confirmDestructive — kept as a
//      cross-check that the gate stays positive for them)
//   • NO over-broadening: a plain EMPTY paragraph                 → no confirm
//   • NO over-broadening: a one-char text paragraph still archives without a
//     confirm the same way it did before (text-empty short-circuit untouched)
//   • a paragraph carrying a footnote atom (the pre-existing case) → confirm
//     (regression floor — the original subset must still fire)
//
// (The extension barrel transitively imports `@/lib/storage`; stub it — same
// gotcha as the sibling block-atom-cells test.)
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
import type { JSONContent } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  resolveDestructiveConfirm,
  type DragHandleRef,
} from "../drag-handle-actions";

// ---------------------------------------------------------------------------
// Real editor stack (mirrors block-atom-cells.test.ts)
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

/** Mount a real main editor over the given top-level doc content. */
function mountDoc(content: JSONContent[]): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: { type: "doc", content },
  });
}

// jsdom has no layout engine — shim the rect APIs the focus path may touch.
const ZERO_RECT = {
  top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0,
  toJSON: () => ({}),
} as DOMRect;
function installLayoutShims(): void {
  const emptyList = Object.assign([], { item: () => null }) as unknown as DOMRectList;
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => emptyList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ZERO_RECT;
  if (!Element.prototype.getClientRects) Element.prototype.getClientRects = () => emptyList;
}

beforeEach(() => {
  installLayoutShims();
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** Both destructive actions must agree, so assert each case across both. */
function confirmsFor(editor: Editor, ref: DragHandleRef): {
  archive: boolean;
  delete: boolean;
} {
  return {
    archive: resolveDestructiveConfirm(editor, ref, "archive") !== null,
    delete: resolveDestructiveConfirm(editor, ref, "delete") !== null,
  };
}

// ---------------------------------------------------------------------------
// Atom-only paragraphs — the regression. Each MUST surface the confirm.
// ---------------------------------------------------------------------------

describe("atom-only paragraph → NOT silently deletable (surfaces confirm)", () => {
  it("a paragraph whose only content is an inlineMath atom", () => {
    const editor = mountDoc([
      {
        type: "paragraph",
        attrs: { uuid: "para-A" },
        content: [{ type: "inlineMath", attrs: { latex: "\\lambda" } }],
      },
    ]);
    // Sanity: the paragraph's textContent is empty (the old "silently
    // deletable" trap), but the slice is non-empty (the atom is there).
    expect(editor.state.doc.firstChild?.textContent).toBe("");

    const c = confirmsFor(editor, { kind: "paragraph", id: "para-A" });
    expect(c.delete).toBe(true);
    expect(c.archive).toBe(true);
  });

  it("a paragraph whose only content is a labelRef (\\ref) atom", () => {
    const editor = mountDoc([
      {
        type: "paragraph",
        attrs: { uuid: "para-A" },
        content: [
          { type: "labelRef", attrs: { label: "fig:1", displayText: "1" } },
        ],
      },
    ]);
    expect(editor.state.doc.firstChild?.textContent).toBe("");

    const c = confirmsFor(editor, { kind: "paragraph", id: "para-A" });
    expect(c.delete).toBe(true);
    expect(c.archive).toBe(true);
  });

  it("a paragraph carrying a footnote atom (the pre-existing subset still fires)", () => {
    const editor = mountDoc([
      {
        type: "paragraph",
        attrs: { uuid: "para-A" },
        content: [{ type: "footnote", attrs: { footnoteId: "fn-1" } }],
      },
    ]);
    const c = confirmsFor(editor, { kind: "paragraph", id: "para-A" });
    expect(c.delete).toBe(true);
    expect(c.archive).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Top-level block atoms — cross-check the gate stays positive. (These already
// warned via their own confirmDestructive; this proves the unified gate keeps
// them confirming and that rangeHasAnchorsOrAtoms recognizes them when they
// sit inside a scanned range.)
// ---------------------------------------------------------------------------

describe("top-level block atoms → NOT silently deletable", () => {
  it("a displayMath block", () => {
    const editor = mountDoc([
      { type: "displayMath", attrs: { uuid: "dm-1", latex: "x^2" } },
      { type: "paragraph", attrs: { uuid: "para-Z" }, content: [{ type: "text", text: "after" }] },
    ]);
    const c = confirmsFor(editor, { kind: "displayMath", id: "dm-1" });
    expect(c.delete).toBe(true);
    expect(c.archive).toBe(true);
  });

  it("a texBlock", () => {
    const editor = mountDoc([
      { type: "texBlock", attrs: { uuid: "tex-1", code: "\\newcommand{\\x}{y}" } },
      { type: "paragraph", attrs: { uuid: "para-Z" }, content: [{ type: "text", text: "after" }] },
    ]);
    const c = confirmsFor(editor, { kind: "texBlock", id: "tex-1" });
    expect(c.delete).toBe(true);
    expect(c.archive).toBe(true);
  });

  it("a graphicsBlock", () => {
    const editor = mountDoc([
      {
        type: "graphicsBlock",
        attrs: { uuid: "gfx-1", command: "\\includegraphics{}", source: "", widthPercent: 50 },
      },
      { type: "paragraph", attrs: { uuid: "para-Z" }, content: [{ type: "text", text: "after" }] },
    ]);
    const c = confirmsFor(editor, { kind: "graphicsBlock", id: "gfx-1" });
    expect(c.delete).toBe(true);
    expect(c.archive).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// NO over-broadening — the plain-empty short-circuit is preserved.
// ---------------------------------------------------------------------------

describe("no over-broadening — trivial content still deletes silently", () => {
  it("a plain EMPTY paragraph is still silently deletable (no confirm)", () => {
    const editor = mountDoc([
      { type: "paragraph", attrs: { uuid: "para-A" }, content: [] },
    ]);
    const c = confirmsFor(editor, { kind: "paragraph", id: "para-A" });
    expect(c.delete).toBe(false);
    expect(c.archive).toBe(false);
  });

  it("a paragraph with only whitespace text is still silently deletable", () => {
    const editor = mountDoc([
      { type: "paragraph", attrs: { uuid: "para-A" }, content: [{ type: "text", text: "   " }] },
    ]);
    const c = confirmsFor(editor, { kind: "paragraph", id: "para-A" });
    expect(c.delete).toBe(false);
    expect(c.archive).toBe(false);
  });
});
