// @vitest-environment jsdom
//
// Task 229 — the block-atom INSERT gate (`posHostsBlockInsert` /
// `blockTypeHostsBlockInsert`) must honor the caret's CONTAINING container, not
// just its own textblock. A `figureCaption` is a genuinely editable inline
// textblock (`content: "inline*"`) whose parent `figureBlock`
// (`content: "figureCaption?"`) can host NO block sibling and is NOT isolating.
// So a block-atom insert at a caption caret (the `$$` display-math input rule,
// `smartInsertBlock`, or any `\tex` / `\ex` / figure / image cell) splits the
// figureBlock into TWO — the caption text torn across them — and on reload the
// figure/caption is silently lost. This is the unpatched member of the task-147
// block-atom-split data-loss class (`titleField` / `codeBlock` / `latexComment`
// were already covered; `figureCaption` fell through to `return true`).
//
// THE DEEP FIX (unifies the block-INSERT surface with the heading-CONVERT twin,
// task 149): when the inserted block's `NodeType` is threaded in,
// `posHostsBlockInsert` now ALSO asks the schema-precise container question —
// can the caret's container host that block adjacent to the textblock? — exactly
// as `heading-convert-container-gate.test.ts` pins for `setBlockType`. A `doc` /
// `listItem` / `blockquote` hosts block children, so ordinary splits stay
// allowed; a `figureBlock` (and any future single-slot container) does not.
//
// WHAT IS PROVEN (driving the REAL editor stack + REAL schema + the REAL
// display-math `$$` input rule + the REAL block-atom action runs — only
// `@/lib/storage` is stubbed, per the extension-barrel gotcha):
//   1. The gate function: `posHostsBlockInsert(doc, capPos, displayMath)` is
//      `false` inside a figureCaption but `true` for a paragraph / list item /
//      blockquote inner paragraph (no over-gating).
//   2. The `$$` input rule at a caption caret is a NO-OP — the figureBlock is
//      preserved (exactly one), no displayMath is inserted, the caption is
//      intact. (FAILED pre-fix: the figureBlock split in two.)
//   3. The shared `smartInsertBlock` primitive (behind `\tex` / `\ex` / figure /
//      image) bails identically at a caption caret.
//   4. The `$$` rule STILL fires at an ordinary paragraph caret (no over-gating).
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
import type { Plugin } from "@tiptap/pm/state";
import { TextSelection } from "@tiptap/pm/state";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { posHostsBlockInsert } from "@/text-objects/text-object-registry";
import { smartInsertBlock } from "@/lib/tiptap/smart-insert";

// ───────────────────────────────────────────────────────────────────────────
// Real editor stack
// ───────────────────────────────────────────────────────────────────────────

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

function mount(content: Record<string, unknown>[]): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: { type: "doc", content },
  });
}

/** A figure whose caption already holds `captionText` (default a single "$" so
 *  the second "$" of a `$$` completes case 1 of the display-math input rule). */
function mountFigure(captionText = "$"): Editor {
  return mount([
    { type: "paragraph", attrs: { uuid: "p-lead" }, content: [{ type: "text", text: "Lead." }] },
    {
      type: "figureBlock",
      attrs: { uuid: "fig-A", extras: "\\centering\\includegraphics{a.png}", label: "fig:a" },
      content: [{ type: "figureCaption", content: [{ type: "text", text: captionText }] }],
    },
  ]);
}

function countOfType(editor: Editor, typeName: string): number {
  let n = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === typeName) n += 1;
    return true;
  });
  return n;
}

/** The doc position of the START of the first `nodeName`'s inner content. */
function innerStart(editor: Editor, nodeName: string): number {
  let pos: number | null = null;
  editor.state.doc.descendants((node: PMNode, p: number) => {
    if (pos !== null || node.type.name !== nodeName) return true;
    pos = p + 1;
    return false;
  });
  if (pos === null) throw new Error(`no ${nodeName} mounted`);
  return pos;
}

/** The doc position at the END of the first `nodeName`'s inner content. */
function innerEnd(editor: Editor, nodeName: string): number {
  let pos: number | null = null;
  editor.state.doc.descendants((node: PMNode, p: number) => {
    if (pos !== null || node.type.name !== nodeName) return true;
    pos = p + 1 + node.content.size;
    return false;
  });
  if (pos === null) throw new Error(`no ${nodeName} mounted`);
  return pos;
}

function placeCaretAt(editor: Editor, pos: number): void {
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)),
  );
}

/** Locate the real `displayMathInput` ProseMirror plugin on the live view and
 *  fire its `handleTextInput` — the exact production path a typed `$` takes. */
function fireDisplayMathDollar(editor: Editor, from: number): void {
  const plugin = editor.view.state.plugins.find((pl: Plugin) => {
    const key = (pl.spec.key as { key?: string } | undefined)?.key;
    return typeof key === "string" && key.startsWith("displayMathInput");
  });
  if (!plugin) throw new Error("displayMathInput plugin not found on the view");
  const handler = plugin.props.handleTextInput as
    | ((
        view: typeof editor.view,
        from: number,
        to: number,
        text: string,
      ) => boolean)
    | undefined;
  if (!handler) throw new Error("displayMathInput plugin has no handleTextInput");
  handler(editor.view, from, from, "$");
}

// jsdom has no layout engine; shim the rect APIs a mount might touch.
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

// ───────────────────────────────────────────────────────────────────────────
// 1. The gate function honors the container (unit)
// ───────────────────────────────────────────────────────────────────────────

describe("posHostsBlockInsert honors the caret's container (task 229)", () => {
  it("rejects a display-math block at a figureCaption caret", () => {
    const editor = mountFigure("caption");
    const displayMath = editor.state.schema.nodes.displayMath;
    const cap = innerStart(editor, "figureCaption");
    // Base gate (no type) is the old, insufficient answer: figureCaption is
    // neither markless nor titleField → the container-blind gate says "true".
    expect(posHostsBlockInsert(editor.state.doc, cap)).toBe(true);
    // Container-aware: figureBlock can host no block sibling → false.
    expect(posHostsBlockInsert(editor.state.doc, cap, displayMath)).toBe(false);
    editor.destroy();
  });

  it("still allows a block at a plain paragraph caret (no over-gating)", () => {
    const editor = mountFigure("caption");
    const displayMath = editor.state.schema.nodes.displayMath;
    const para = innerStart(editor, "paragraph");
    expect(posHostsBlockInsert(editor.state.doc, para, displayMath)).toBe(true);
    editor.destroy();
  });

  it("still allows a block inside a list item and a blockquote (no over-gating)", () => {
    const editor = mount([
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [{ type: "paragraph", attrs: { uuid: "li1" }, content: [{ type: "text", text: "item" }] }] },
        ],
      },
      {
        type: "blockquote",
        content: [{ type: "paragraph", attrs: { uuid: "bq1" }, content: [{ type: "text", text: "quote" }] }],
      },
    ]);
    const displayMath = editor.state.schema.nodes.displayMath;
    // caret in the list item's paragraph
    let liPos: number | null = null;
    let bqPos: number | null = null;
    editor.state.doc.descendants((node: PMNode, p: number, parent: PMNode | null) => {
      if (node.type.name === "paragraph" && parent?.type.name === "listItem" && liPos === null) liPos = p + 1;
      if (node.type.name === "paragraph" && parent?.type.name === "blockquote" && bqPos === null) bqPos = p + 1;
      return true;
    });
    expect(posHostsBlockInsert(editor.state.doc, liPos!, displayMath)).toBe(true);
    expect(posHostsBlockInsert(editor.state.doc, bqPos!, displayMath)).toBe(true);
    editor.destroy();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. The real `$$` input rule is a no-op at a caption caret (the corruption)
// ───────────────────────────────────────────────────────────────────────────

describe("display-math $$ at a figureCaption caret does not split the figure (task 229)", () => {
  it("preserves exactly one figureBlock, inserts no displayMath, keeps the caption", () => {
    const editor = mountFigure("$"); // caption holds a lone "$"
    const capEnd = innerEnd(editor, "figureCaption"); // caret right after the "$"
    placeCaretAt(editor, capEnd);

    fireDisplayMathDollar(editor, capEnd);

    expect(countOfType(editor, "figureBlock"), "figureBlock count").toBe(1);
    expect(countOfType(editor, "figureCaption"), "figureCaption count").toBe(1);
    expect(countOfType(editor, "displayMath"), "displayMath count").toBe(0);
    editor.destroy();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. The shared smartInsertBlock primitive bails identically
// ───────────────────────────────────────────────────────────────────────────

describe("smartInsertBlock bails at a figureCaption caret (task 229)", () => {
  it("does not insert a texBlock / split the figure", () => {
    const editor = mountFigure("caption");
    const texBlock = editor.state.schema.nodes.texBlock;
    placeCaretAt(editor, innerStart(editor, "figureCaption"));

    const res = smartInsertBlock({ editor, type: texBlock });

    expect(res.pos, "not-inserted sentinel").toBe(-1);
    expect(countOfType(editor, "figureBlock"), "figureBlock count").toBe(1);
    expect(countOfType(editor, "texBlock"), "texBlock count").toBe(0);
    editor.destroy();
  });

  it("still inserts a texBlock at a plain paragraph caret (no over-gating)", () => {
    const editor = mountFigure("caption");
    const texBlock = editor.state.schema.nodes.texBlock;
    // Mid-paragraph caret (a start-of-block caret would legitimately land the
    // block at doc pos 0 — the count, not the returned pos, is the invariant).
    const start = innerStart(editor, "paragraph");
    placeCaretAt(editor, start + 2);

    const res = smartInsertBlock({ editor, type: texBlock });

    expect(res.pos, "inserted (non-sentinel)").not.toBe(-1);
    expect(countOfType(editor, "texBlock")).toBe(1);
    expect(countOfType(editor, "figureBlock"), "figure untouched").toBe(1);
    editor.destroy();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3b. The gate is TYPE-PRECISE, not a name list — it retires the analogous
//     exampleItem member of the same split class. `exampleItem` content is
//     `(paragraph | graphicsBlock | displayMath)+ …`: it HOSTS displayMath /
//     graphicsBlock but NOT texBlock / figureBlock. So an equation / image
//     insert at an example-item caret is allowed, while a `\tex` / figure insert
//     — which would split the `defining` exampleItem into two dup-uuid copies,
//     the same corruption — is correctly rejected. A one-line `figureCaption`
//     name check would NOT have caught this; threading the NodeType does.
// ───────────────────────────────────────────────────────────────────────────

describe("the container gate is type-precise inside an exampleItem (task 229)", () => {
  function mountExample(): Editor {
    return mount([
      {
        type: "exampleBlock",
        attrs: { uuid: "ex-A" },
        content: [
          {
            type: "exampleItemList",
            content: [
              { type: "exampleItem", attrs: { uuid: "i1" }, content: [{ type: "paragraph", attrs: { uuid: "ip1" }, content: [{ type: "text", text: "an example item" }] }] },
            ],
          },
        ],
      },
    ]);
  }

  function itemParaCaret(editor: Editor): number {
    let pos: number | null = null;
    editor.state.doc.descendants((node: PMNode, p: number, parent: PMNode | null) => {
      if (node.type.name === "paragraph" && parent?.type.name === "exampleItem" && pos === null) pos = p + 2;
      return true;
    });
    if (pos === null) throw new Error("no exampleItem paragraph mounted");
    return pos;
  }

  it("allows the hosted block kinds (displayMath / graphicsBlock)", () => {
    const editor = mountExample();
    const pos = itemParaCaret(editor);
    const S = editor.state.schema.nodes;
    expect(posHostsBlockInsert(editor.state.doc, pos, S.displayMath)).toBe(true);
    expect(posHostsBlockInsert(editor.state.doc, pos, S.graphicsBlock)).toBe(true);
    editor.destroy();
  });

  it("rejects the un-hostable block kinds (texBlock / figureBlock) — split-class parity", () => {
    const editor = mountExample();
    const pos = itemParaCaret(editor);
    const S = editor.state.schema.nodes;
    expect(posHostsBlockInsert(editor.state.doc, pos, S.texBlock)).toBe(false);
    expect(posHostsBlockInsert(editor.state.doc, pos, S.figureBlock)).toBe(false);
    editor.destroy();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. The $$ rule still fires at an ordinary paragraph caret (no over-gating)
// ───────────────────────────────────────────────────────────────────────────

describe("display-math $$ still fires in ordinary prose (task 229)", () => {
  it("inserts a displayMath block at a paragraph caret ending in $", () => {
    const editor = mount([
      { type: "paragraph", attrs: { uuid: "p1" }, content: [{ type: "text", text: "$" }] },
    ]);
    const end = innerEnd(editor, "paragraph");
    placeCaretAt(editor, end);

    fireDisplayMathDollar(editor, end);

    expect(countOfType(editor, "displayMath")).toBe(1);
    editor.destroy();
  });
});
