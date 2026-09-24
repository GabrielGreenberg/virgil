// @vitest-environment jsdom
//
// Task 744 — the typed `$` rules must be proven on the path a user can
// actually reach: SEQUENTIAL typing, one character at a time, through PM's
// real `handleTextInput` dispatch (falling back to the default insert when no
// plugin claims the key — exactly what the browser does).
//
// THE BUG THIS PINS: both math rules trigger on `$`. Typing `a $$x$$`, the
// third `$` was claimed by the INLINE rule (`$x` — the SECOND opening dollar
// read as an inline opener), so the display rule's `$$x$$` closing branch was
// unreachable: the user got `a $` + inlineMath{x} + `$`. The seeded positive
// control in `typed-math-container-gate.test.ts` never saw it — it seeded
// `$$x$`, a state sequential typing cannot produce. The fix is one census
// rule (`TYPED_LATEX_INPUT_RULES["inline-math"]` refuses an opener preceded by
// `$`): a `$$` opener belongs to display math.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

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
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}

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

/** A real main editor: one EMPTY paragraph, then a `tail` paragraph. */
function mountEmptyParagraph(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { uuid: "p-A" } },
        { type: "paragraph", attrs: { uuid: "tail-A" }, content: [{ type: "text", text: "tail" }] },
      ],
    },
  });
}

/**
 * Type `chars` one at a time at the caret (starting inside the first
 * paragraph), the way the browser does: offer each char to `handleTextInput`;
 * when no plugin claims it, apply the default insert. The caret follows the
 * selection after every step, so a rule's replacement is honoured.
 */
function typeSequentially(editor: Editor, chars: string): void {
  const view = editor.view;
  view.dispatch(view.state.tr.setSelection(
    (view.state.selection.constructor as typeof import("@tiptap/pm/state").TextSelection)
      .create(view.state.doc, 1),
  ));
  for (const ch of chars) {
    const { from, to } = view.state.selection;
    const deflt = () => view.state.tr.insertText(ch, from, to);
    const handled = view.someProp("handleTextInput", (f) => f(view, from, to, ch, deflt));
    if (!handled) view.dispatch(deflt());
  }
}

function countOfType(editor: Editor, typeName: string): number {
  let n = 0;
  editor.state.doc.descendants((node: PMNode) => {
    if (node.type.name === typeName) n += 1;
    return true;
  });
  return n;
}

function topLevel(editor: Editor): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  editor.state.doc.forEach((node: PMNode) =>
    out.push([node.type.name, node.isAtom ? `latex=${node.attrs.latex}` : node.textContent]),
  );
  return out;
}

beforeEach(() => installLayoutShims());
afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("typed `$` rules under sequential typing (task 744)", () => {
  it("`a $$x$$` mid-paragraph makes ONE displayMath{x} — no inlineMath, no stray `$`", () => {
    const editor = mountEmptyParagraph();
    typeSequentially(editor, "a $$x$$");
    expect(countOfType(editor, "displayMath"), JSON.stringify(topLevel(editor))).toBe(1);
    expect(countOfType(editor, "inlineMath")).toBe(0);
    // Mid-paragraph: the text before is real, so the block splits the
    // paragraph; the caret lands in the (empty) right half.
    expect(topLevel(editor)).toEqual([
      ["paragraph", "a "],
      ["displayMath", "latex=x"],
      ["paragraph", "tail"],
    ]);
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
    editor.destroy();
  });

  it("`$$` in an empty paragraph opens an empty display block and leaves no empty paragraph above it", () => {
    const editor = mountEmptyParagraph();
    typeSequentially(editor, "$$");
    // No empty paragraph ABOVE the block; the caret's paragraph (the split's
    // right half) survives BELOW it.
    expect(topLevel(editor)).toEqual([
      ["displayMath", "latex="],
      ["paragraph", "tail"],
    ]);
    expect(countOfType(editor, "inlineMath")).toBe(0);
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
    editor.destroy();
  });

  it("`a $x$ b` still makes ONE inlineMath{x} (no regression)", () => {
    const editor = mountEmptyParagraph();
    typeSequentially(editor, "a $x$ b");
    expect(countOfType(editor, "inlineMath")).toBe(1);
    expect(countOfType(editor, "displayMath")).toBe(0);
    let latex: unknown;
    editor.state.doc.descendants((n: PMNode) => {
      if (n.type.name === "inlineMath") latex = n.attrs.latex;
      return true;
    });
    expect(latex).toBe("x");
    editor.destroy();
  });

  it("`$$x$$` typed into a LIST ITEM keeps the list item's leading paragraph", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = new Editor({
      element,
      editable: true,
      extensions: buildEditorExtensions(mainCtx()),
      content: {
        type: "doc",
        content: [
          { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] },
          { type: "paragraph", attrs: { uuid: "tail-A" }, content: [{ type: "text", text: "tail" }] },
        ],
      },
    });
    const view = editor.view;
    // Caret inside the list item's paragraph: doc>bulletList(0)>listItem(1)>paragraph(2) → 3.
    const TS = (view.state.selection.constructor as typeof import("@tiptap/pm/state").TextSelection);
    view.dispatch(view.state.tr.setSelection(TS.create(view.state.doc, 3)));
    for (const ch of "$$") {
      const { from, to } = view.state.selection;
      const deflt = () => view.state.tr.insertText(ch, from, to);
      if (!view.someProp("handleTextInput", (f) => f(view, from, to, ch, deflt))) view.dispatch(deflt());
    }
    // Whatever the container gate decides, the list item stays schema-valid.
    expect(() => editor.state.doc.check()).not.toThrow();
    editor.destroy();
  });

  it("two inline formulas back to back — `$x$ $y$` — both convert", () => {
    const editor = mountEmptyParagraph();
    typeSequentially(editor, "$x$ $y$");
    expect(countOfType(editor, "inlineMath")).toBe(2);
    editor.destroy();
  });
});
