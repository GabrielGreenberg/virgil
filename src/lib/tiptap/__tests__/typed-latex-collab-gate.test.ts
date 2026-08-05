// @vitest-environment jsdom
//
// Task 296 — CHIP 7b's collab read-only gate must be UNIFORM across all four
// typed-LaTeX `handleTextInput` surfaces (five closures): inline `$…$` math,
// display `$$…$$` math, `\cite{}`, `\footnote{}`, and the `% ` comment. Each of
// those raw PM input rules mutates the doc SYNCHRONOUSLY (`view.dispatch`) from
// inside `handleTextInput`, *before* any registry `run()`. On a non-editable
// (collab read-only) view every one of them must REFUSE — return `false`,
// dispatch nothing, insert no atom — via the shared
// `refuseTypedInsertWhenReadOnly` SSOT. Pre-296 the guard was present on only
// citation/footnote; math ×2 and `% ` could still fire in a transitional frame
// where `canEditMainText` has flipped false a render tick before the
// `setEditable` effect re-runs.
//
// WHAT IS PROVEN (driving the REAL `buildEditorExtensions` stack + REAL schema
// via PM's own `view.someProp("handleTextInput", …)` dispatch — only
// `@/lib/storage` is stubbed, per the extension-barrel gotcha):
//   1. POSITIVE CONTROL (editable view, plain paragraph — the container gate
//      never blocks): each surface's trigger DOES fire and insert its atom/node.
//      This proves the trigger setup is real, so the refusal below isn't vacuous.
//   2. REFUSAL (non-editable view, identical setup): each surface returns `false`,
//      calls NO `view.dispatch`, and leaves the doc structurally unchanged.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";

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

// jsdom has no layout engine; the typed rules do a bare `replaceWith`, but shim
// the rect APIs defensively so nothing throws on mount.
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

/**
 * Mount a real main editor whose sole block is a paragraph seeded with
 * `seedText` (a HOSTING container, so every surface's own container gate passes
 * and the ONLY thing that can refuse the insert is the collab read-only gate).
 * Returns the editor and the caret at the END of the seeded text.
 */
function mountParagraph(
  seedText: string,
  editable: boolean,
): { editor: Editor; caret: number } {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "p-A" },
          content: seedText ? [{ type: "text", text: seedText }] : [],
        },
      ],
    },
  });
  // Paragraph opens at doc pos 0, inner content starts at pos 1, so the end of
  // the seeded text is `1 + length`.
  return { editor, caret: 1 + seedText.length };
}

/**
 * Fire PM's REAL `handleTextInput` dispatch for `char` typed at `pos` (exactly
 * the contract ProseMirror uses). Returns whether SOME plugin claimed it.
 */
function typeChar(editor: Editor, pos: number, char: string): boolean {
  const view = editor.view;
  return !!view.someProp("handleTextInput", (f) =>
    f(view, pos, pos, char, () => view.state.tr),
  );
}

function countOfType(editor: Editor, typeName: string): number {
  let n = 0;
  editor.state.doc.descendants((node: PMNode) => {
    if (node.type.name === typeName) n += 1;
    return true;
  });
  return n;
}

function topLevelNames(editor: Editor): string[] {
  const names: string[] = [];
  editor.state.doc.forEach((node: PMNode) => names.push(node.type.name));
  return names;
}

// Each surface: a plain-paragraph seed + the char that completes its trigger,
// and the node type it would insert. The seed makes the trigger fire on an
// EDITABLE view; the collab gate is the only thing that stops it on a read-only
// one.
const SURFACES = [
  { label: "inline `$x$` math", seed: "$x", char: "$", inserts: "inlineMath" },
  { label: "display `$$x$$` math", seed: "$$x$", char: "$", inserts: "displayMath" },
  { label: "typed `\\cite{k}`", seed: "\\cite{k", char: "}", inserts: "citation" },
  { label: "typed `\\footnote{b}`", seed: "\\footnote{b", char: "}", inserts: "footnote" },
  { label: "`% ` comment", seed: "", char: "%", inserts: "latexComment" },
] as const;

beforeEach(() => {
  installLayoutShims();
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("typed-LaTeX collab read-only gate is uniform across all surfaces (task 296)", () => {
  for (const s of SURFACES) {
    it(`POSITIVE CONTROL: ${s.label} fires on an editable view`, () => {
      const { editor, caret } = mountParagraph(s.seed, true);
      const fired = typeChar(editor, caret, s.char);
      expect(fired, "trigger must fire on an editable view (non-vacuous)").toBe(true);
      expect(countOfType(editor, s.inserts)).toBe(1);
      editor.destroy();
    });

    it(`REFUSAL: ${s.label} inserts nothing on a read-only view`, () => {
      const { editor, caret } = mountParagraph(s.seed, false);
      expect(editor.view.editable, "precondition: view is non-editable").toBe(false);
      const before = topLevelNames(editor);
      const dispatchSpy = vi.spyOn(editor.view, "dispatch");

      const fired = typeChar(editor, caret, s.char);

      expect(fired, "read-only view must refuse (fall through)").toBe(false);
      expect(dispatchSpy, "no synchronous doc mutation on a read-only view").not.toHaveBeenCalled();
      expect(countOfType(editor, s.inserts), `no ${s.inserts} inserted`).toBe(0);
      expect(topLevelNames(editor), "doc structure unchanged").toEqual(before);
      editor.destroy();
    });
  }
});
