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

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

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
import {
  VIRGIL_ACTION_REGISTRY,
  type ActionContext,
  type ActionRef,
  type ActionId,
} from "@/lib/actions/action-registry";

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

// ───────────────────────────────────────────────────────────────────────────
// Task 641 — the RANGE half. Every block action MUTATES `[from, to]`
// (`deleteSelection()` then `replaceSelectionWith(...)`, or
// `setBlockType(from, to, …)`), while the gate asked about ONE position,
// `from`. Content the question never reached was destroyed: a selection running
// from prose INTO a `codeBlock` / `latexComment` passed at `from` and the
// delete merged the verbatim block away — commented-out source PROMOTED into
// the typeset document, the corruption tasks 146/150/396 exist to prevent,
// reached through the range instead of the caret.
//
// And the REPRESENTABILITY half (the capture/schema-symmetry law): the three
// WRAP paths harvest the selection into a payload their new node can hold —
// `\tex`/`$…$` keep plain TEXT, `\ex` keeps INLINE leaves — then delete the
// whole range. `texRun` and `mathRun` each carried a hand-rolled bail for the
// one shape that was reported (an atom alone, no text); `exampleRun` carried
// none, so `\ex` over a selected `displayMath` / figure REPLACED it with an
// empty template. One predicate (`sliceIsFullyCapturedBy`) now answers for all
// three — and it asks about the SLICE, not about "did the harvest come back
// empty?", which is a proxy that waves through every MIXED selection.
//
// Every leg asserts the DOCUMENT IS UNCHANGED (a JSON deep-equal against the
// pre-action snapshot), not merely that a command returned false.
// ───────────────────────────────────────────────────────────────────────────

/** prose → verbatim → block-atom fixture for the range legs. */
function mountRangeFixture(): Editor {
  return mount([
    { type: "paragraph", attrs: { uuid: "p-lead" }, content: [{ type: "text", text: "Lead prose." }] },
    { type: "codeBlock", attrs: { uuid: "code-A" }, content: [{ type: "text", text: "x = 1" }] },
    { type: "latexComment", attrs: { uuid: "cmt-A" }, content: [{ type: "text", text: "a comment" }] },
  ]);
}

/** prose → block atom fixture for the representability legs. */
function mountAtomFixture(atom: Record<string, unknown>): Editor {
  return mount([
    { type: "paragraph", attrs: { uuid: "p-lead" }, content: [{ type: "text", text: "Lead prose." }] },
    atom,
    { type: "paragraph", attrs: { uuid: "p-tail" }, content: [{ type: "text", text: "Tail prose." }] },
  ]);
}

const BLOCK_ATOMS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ["displayMath", { type: "displayMath", attrs: { latex: "\\int f" } }],
  [
    "figureBlock",
    {
      type: "figureBlock",
      attrs: { uuid: "fig-A", extras: "\\includegraphics{a.png}", label: "fig:a" },
      content: [{ type: "figureCaption", content: [{ type: "text", text: "Cap." }] }],
    },
  ],
  ["graphicsBlock", { type: "graphicsBlock", attrs: { uuid: "gfx-A", src: "a.png" } }],
  ["texBlock", { type: "texBlock", attrs: { uuid: "tex-A", code: "\\foo" } }],
];

/** Select `[from, to]` on the live view. */
function selectRange(editor: Editor, from: number, to: number): void {
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)),
  );
}

/** Invoke a registry row's `run()` with the live selection, EditorPane-style. */
function runRow(editor: Editor, id: ActionId): void {
  const spec = VIRGIL_ACTION_REGISTRY[id];
  if (!spec) throw new Error(`no registry row for ${id}`);
  const { from, to } = editor.state.selection;
  const ref: ActionRef =
    from === to
      ? { kind: "cursor", pos: from, paragraphId: "" }
      : { kind: "selection", from, to, paragraphId: "" };
  void spec.run({ editor, view: editor.view, ref, surface: "lightning" } as ActionContext);
}

/** The row's applies() verdict for the live selection. */
function appliesForSelection(editor: Editor, id: ActionId): "ok" | "disabled" | "absent" {
  const spec = VIRGIL_ACTION_REGISTRY[id];
  if (!spec) throw new Error(`no registry row for ${id}`);
  const { from, to } = editor.state.selection;
  const ref: ActionRef =
    from === to
      ? { kind: "cursor", pos: from, paragraphId: "" }
      : { kind: "selection", from, to, paragraphId: "" };
  return spec.applies({ editor, view: editor.view, ref, surface: "lightning" } as ActionContext);
}

/** The block INSERT rows that mutate the whole selection. */
const BLOCK_ROWS = ["tex", "example", "forest", "display-math"] as const;

describe("the block gate covers the whole RANGE it mutates (task 641)", () => {
  for (const id of BLOCK_ROWS) {
    it(`${id}: a prose → codeBlock selection leaves the document byte-identical`, () => {
      const editor = mountRangeFixture();
      // From mid-paragraph INTO the codeBlock's text — the shape whose delete
      // merged the verbatim block away under the `from`-only gate.
      selectRange(editor, innerStart(editor, "paragraph") + 2, innerStart(editor, "codeBlock") + 3);
      const before = JSON.stringify(editor.getJSON());

      runRow(editor, id);

      expect(JSON.stringify(editor.getJSON())).toBe(before);
      editor.destroy();
    });

    it(`${id}: a prose → latexComment selection leaves the document byte-identical`, () => {
      const editor = mountRangeFixture();
      selectRange(editor, innerStart(editor, "paragraph") + 2, innerStart(editor, "latexComment") + 3);
      const before = JSON.stringify(editor.getJSON());

      runRow(editor, id);

      expect(JSON.stringify(editor.getJSON())).toBe(before);
      editor.destroy();
    });

    it(`${id}: the affordance greys for a prose → codeBlock selection`, () => {
      const editor = mountRangeFixture();
      selectRange(editor, innerStart(editor, "paragraph") + 2, innerStart(editor, "codeBlock") + 3);

      expect(appliesForSelection(editor, id)).toBe("disabled");
      editor.destroy();
    });

    it(`${id}: an all-prose selection still acts (no over-gating)`, () => {
      const editor = mountRangeFixture();
      selectRange(editor, innerStart(editor, "paragraph") + 2, innerStart(editor, "paragraph") + 6);
      const before = JSON.stringify(editor.getJSON());

      expect(appliesForSelection(editor, id)).toBe("ok");
      runRow(editor, id);

      expect(JSON.stringify(editor.getJSON())).not.toBe(before);
      editor.destroy();
    });
  }

  it("smartInsertBlock bails on a prose → codeBlock selection", () => {
    const editor = mountRangeFixture();
    selectRange(editor, innerStart(editor, "paragraph") + 2, innerStart(editor, "codeBlock") + 3);
    const before = JSON.stringify(editor.getJSON());

    const res = smartInsertBlock({
      editor,
      type: editor.state.schema.nodes.graphicsBlock,
      attrs: { src: "" },
    });

    expect(res.pos).toBe(-1);
    expect(JSON.stringify(editor.getJSON())).toBe(before);
    editor.destroy();
  });
});

describe("a WRAP path refuses content its capture cannot represent (task 641)", () => {
  // `\ex` (inline capture), `\tex` and `$$` (text capture) all destroy the
  // selection; none of the three can carry a block atom out of it.
  for (const [name, atom] of BLOCK_ATOMS) {
    for (const id of ["example", "tex", "display-math"] as const) {
      it(`${id}: a selection containing a ${name} leaves the document byte-identical`, () => {
        const editor = mountAtomFixture(atom);
        // From mid-first-paragraph to mid-last — the range spans the block atom.
        selectRange(
          editor,
          innerStart(editor, "paragraph") + 2,
          innerEnd(editor, "paragraph") - 1 + 0,
        );
        // Re-anchor the tail end inside the TRAILING paragraph so the atom is
        // strictly inside the range.
        const tailStart = editor.state.doc.content.size - 2;
        selectRange(editor, innerStart(editor, "paragraph") + 2, tailStart);
        const before = JSON.stringify(editor.getJSON());

        runRow(editor, id);

        expect(JSON.stringify(editor.getJSON())).toBe(before);
        editor.destroy();
      });
    }
  }

  it("example: a plain-prose selection still wraps (no over-gating)", () => {
    const editor = mountRangeFixture();
    selectRange(editor, innerStart(editor, "paragraph") + 2, innerStart(editor, "paragraph") + 6);

    runRow(editor, "example");

    expect(countOfType(editor, "exampleBlock")).toBe(1);
    editor.destroy();
  });

  it("example: a selection carrying an INLINE atom still wraps (the inline capture CAN hold it)", () => {
    const editor = mount([
      {
        type: "paragraph",
        attrs: { uuid: "p-lead" },
        content: [
          { type: "text", text: "see " },
          { type: "inlineMath", attrs: { latex: "x" } },
          { type: "text", text: " here" },
        ],
      },
    ]);
    selectRange(editor, innerStart(editor, "paragraph"), innerEnd(editor, "paragraph"));

    runRow(editor, "example");

    expect(countOfType(editor, "exampleBlock")).toBe(1);
    expect(countOfType(editor, "inlineMath")).toBe(1); // the atom SURVIVED into the example
    editor.destroy();
  });
});
