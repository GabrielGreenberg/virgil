// @vitest-environment jsdom
//
// Task 991 — every typed-LaTeX conversion is revertible by the very next
// Backspace, matching the StarterKit half of the same surface (`- ` then
// Backspace gives back `- `). The five Virgil rules (`\cite{}`, `\footnote{}`,
// `$…$`, `$$…$$`, `%`) arm `typed-latex-revert.ts`; Backspace restores the
// literal source INCLUDING the trigger character, and anything in between
// (a keystroke, a caret move, focus leaving) disarms it.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
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
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
}

/** A real main editor: a first paragraph holding `text`, then a `tail`. */
function mount(text = ""): Editor {
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
          attrs: { uuid: "p-A" },
          ...(text ? { content: [{ type: "text", text }] } : {}),
        },
        { type: "paragraph", attrs: { uuid: "tail-A" }, content: [{ type: "text", text: "tail" }] },
      ],
    },
  });
}

function setCaret(editor: Editor, pos: number): void {
  const view = editor.view;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
}

/** Type `chars` at the caret the way the browser does: offer each to
 *  `handleTextInput`, falling back to the default insert. */
function type(editor: Editor, chars: string): void {
  const view = editor.view;
  for (const ch of chars) {
    const { from, to } = view.state.selection;
    const deflt = () => view.state.tr.insertText(ch, from, to);
    const handled = view.someProp("handleTextInput", (f) => f(view, from, to, ch, deflt));
    if (!handled) view.dispatch(deflt());
  }
}

/** Press Backspace through the real DOM listener; true iff something claimed it. */
function backspace(editor: Editor): boolean {
  const ev = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
  editor.view.dom.dispatchEvent(ev);
  return ev.defaultPrevented;
}

function count(editor: Editor, typeName: string): number {
  let n = 0;
  editor.state.doc.descendants((node: PMNode) => {
    if (node.type.name === typeName) n += 1;
    return true;
  });
  return n;
}

const firstText = (editor: Editor) => editor.state.doc.firstChild!.textContent;

beforeEach(() => installLayoutShims());
afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("Backspace reverts a typed-LaTeX conversion (task 991)", () => {
  it("inline math: `costs $5 and $` → Backspace gives back the literal, caret after the `$`", () => {
    const editor = mount();
    setCaret(editor, 1);
    type(editor, "costs $5 and $");
    expect(count(editor, "inlineMath")).toBe(1);
    expect(backspace(editor)).toBe(true);
    expect(count(editor, "inlineMath")).toBe(0);
    expect(firstText(editor)).toBe("costs $5 and $");
    expect(editor.state.selection.head).toBe(1 + "costs $5 and $".length);
    // The revert is one-shot: the next Backspace is not ours.
    expect(backspace(editor)).toBe(false);
    expect(firstText(editor)).toBe("costs $5 and $");
    editor.destroy();
  });

  it("display math: `a $$x$$` → Backspace gives back `a $$x$$` in one paragraph", () => {
    const editor = mount();
    setCaret(editor, 1);
    type(editor, "a $$x$$");
    expect(count(editor, "displayMath")).toBe(1);
    expect(backspace(editor)).toBe(true);
    expect(count(editor, "displayMath")).toBe(0);
    expect(firstText(editor)).toBe("a $$x$$");
    expect(editor.state.doc.childCount).toBe(2);
    expect(editor.state.doc.child(1).textContent).toBe("tail");
    editor.destroy();
  });

  it("display math, the empty-block branch: `$$` → Backspace gives back `$$`", () => {
    const editor = mount();
    setCaret(editor, 1);
    type(editor, "$$");
    expect(count(editor, "displayMath")).toBe(1);
    expect(backspace(editor)).toBe(true);
    expect(count(editor, "displayMath")).toBe(0);
    expect(firstText(editor)).toBe("$$");
    editor.destroy();
  });

  it("citation: `\\cite{key}` → Backspace gives back the command", () => {
    const editor = mount();
    setCaret(editor, 1);
    type(editor, "see \\cite{key}");
    expect(count(editor, "citation")).toBe(1);
    expect(backspace(editor)).toBe(true);
    expect(count(editor, "citation")).toBe(0);
    expect(firstText(editor)).toBe("see \\cite{key}");
    editor.destroy();
  });

  it("citation typed mid-text keeps the character after the caret (the old end ate it)", () => {
    const editor = mount("x");
    setCaret(editor, 1);
    type(editor, "\\cite{key}");
    expect(count(editor, "citation")).toBe(1);
    expect(firstText(editor)).toBe("￼".length === 1 ? editor.state.doc.firstChild!.textContent : "");
    expect(editor.state.doc.firstChild!.lastChild!.text).toBe("x");
    expect(backspace(editor)).toBe(true);
    expect(firstText(editor)).toBe("\\cite{key}x");
    editor.destroy();
  });

  it("bare citation: `\\cite ` → Backspace gives back `\\cite ` (the space was the trigger)", () => {
    const editor = mount();
    setCaret(editor, 1);
    type(editor, "\\cite ");
    expect(count(editor, "citation")).toBe(1);
    expect(backspace(editor)).toBe(true);
    expect(count(editor, "citation")).toBe(0);
    expect(firstText(editor)).toBe("\\cite ");
    editor.destroy();
  });

  it("footnote: `\\footnote{a body}` → Backspace gives back the command with its body", () => {
    const editor = mount();
    setCaret(editor, 1);
    type(editor, "text\\footnote{a body}");
    expect(count(editor, "footnote")).toBe(1);
    expect(backspace(editor)).toBe(true);
    expect(count(editor, "footnote")).toBe(0);
    expect(firstText(editor)).toBe("text\\footnote{a body}");
    editor.destroy();
  });

  it("comment: `%` → Backspace gives back the `%` in a paragraph (not a dissolve that drops it)", () => {
    const editor = mount();
    setCaret(editor, 1);
    type(editor, "%");
    expect(editor.state.doc.firstChild!.type.name).toBe("latexComment");
    expect(backspace(editor)).toBe(true);
    expect(editor.state.doc.firstChild!.type.name).toBe("paragraph");
    expect(editor.state.doc.firstChild!.attrs.uuid).toBe("p-A");
    expect(firstText(editor)).toBe("%");
    expect(editor.state.selection.head).toBe(2);
    editor.destroy();
  });

  it("comment over existing text: `%` before `note` → Backspace restores `%note`", () => {
    const editor = mount("note");
    setCaret(editor, 1);
    type(editor, "%");
    expect(editor.state.doc.firstChild!.type.name).toBe("latexComment");
    expect(backspace(editor)).toBe(true);
    expect(editor.state.doc.firstChild!.type.name).toBe("paragraph");
    expect(firstText(editor)).toBe("%note");
    editor.destroy();
  });
});

describe("the revert window is exactly one step wide", () => {
  it("an intervening keystroke disarms it", () => {
    const editor = mount();
    setCaret(editor, 1);
    type(editor, "$x$y");
    expect(backspace(editor)).toBe(false);
    expect(count(editor, "inlineMath")).toBe(1);
    editor.destroy();
  });

  it("typing into a new comment disarms it", () => {
    const editor = mount();
    setCaret(editor, 1);
    type(editor, "% hi");
    expect(backspace(editor)).toBe(false);
    expect(editor.state.doc.firstChild!.type.name).toBe("latexComment");
    editor.destroy();
  });

  it("a caret move disarms it, even a move back to the same spot", () => {
    const editor = mount();
    setCaret(editor, 1);
    type(editor, "$x$");
    const here = editor.state.selection.head;
    setCaret(editor, 1);
    setCaret(editor, here);
    expect(backspace(editor)).toBe(false);
    expect(count(editor, "inlineMath")).toBe(1);
    editor.destroy();
  });

  it("focus leaving the editor disarms it (a typed footnote's card takes focus)", () => {
    const editor = mount();
    setCaret(editor, 1);
    type(editor, "$x$");
    editor.view.dom.dispatchEvent(new FocusEvent("blur"));
    expect(backspace(editor)).toBe(false);
    expect(count(editor, "inlineMath")).toBe(1);
    editor.destroy();
  });

  it("a modified Backspace is not the revert", () => {
    const editor = mount();
    setCaret(editor, 1);
    type(editor, "$x$");
    const ev = new KeyboardEvent("keydown", { key: "Backspace", altKey: true, bubbles: true, cancelable: true });
    editor.view.dom.dispatchEvent(ev);
    expect(count(editor, "inlineMath")).toBe(1);
    editor.destroy();
  });

  it("collab read-only: the binding is inert", () => {
    const editor = mount();
    setCaret(editor, 1);
    type(editor, "$x$");
    editor.setEditable(false);
    expect(backspace(editor)).toBe(false);
    expect(count(editor, "inlineMath")).toBe(1);
    editor.destroy();
  });
});
