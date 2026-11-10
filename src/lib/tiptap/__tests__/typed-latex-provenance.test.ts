// @vitest-environment jsdom
//
// Task 1562 — a typed-LaTeX rule completes only an opener the user TYPED.
// The parser un-escapes the file (`\$40` → the literal `$40`) and the
// serializer re-escapes on save, so a dollar the file holds as `\$` sits in the
// model as a bare `$` that task 1368's escape check cannot see. Typing
// `, discounted to $` after it used to make `40 per page, discounted to ` a
// math chip and the saved source lost its `\$`. The match door now also asks
// PROVENANCE: every delimiter must lie in the current typed run (tracked per
// rule plugin in `typed-latex-revert.ts`). Real main stack, real parser and
// serializer, sequential typing through PM's `handleTextInput` dispatch
// (harness from `typed-latex-escape-parity.test.ts`).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor, type JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly } from "@/lib/latex-serializer";

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

/** A real main editor holding the body PARSED from `tex` (the file's bytes). */
function mountParsed(tex: string): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: { type: "doc", content: parseLatex(tex).content } as JSONContent,
  });
}

/** Place the caret (a click / arrow: a selection-only transaction). */
function caretAt(editor: Editor, pos: number): void {
  const view = editor.view;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
}

/** End of the first textblock's content. */
function endOfFirstBlock(editor: Editor): number {
  return 1 + editor.state.doc.firstChild!.content.size;
}

/** Type `chars` at the caret, one keystroke each, the way the browser does. */
function type(editor: Editor, chars: string): void {
  const view = editor.view;
  for (const ch of chars) {
    const { from, to } = view.state.selection;
    const deflt = () => view.state.tr.insertText(ch, from, to);
    const handled = view.someProp("handleTextInput", (f) => f(view, from, to, ch, deflt));
    if (!handled) view.dispatch(deflt());
  }
}

function backspace(editor: Editor): void {
  const view = editor.view;
  const { from } = view.state.selection;
  view.dispatch(view.state.tr.delete(from - 1, from));
}

const ATOMS = ["inlineMath", "displayMath", "footnote", "citation", "latexComment"];
function atomCounts(editor: Editor): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(ATOMS.map((t) => [t, 0]));
  editor.state.doc.descendants((node: PMNode) => {
    if (node.type.name in out) out[node.type.name] += 1;
    return true;
  });
  return out;
}
const NONE = { inlineMath: 0, displayMath: 0, footnote: 0, citation: 0, latexComment: 0 };

function tex(editor: Editor): string {
  return serializeBodyOnly(editor.getJSON() as JSONContent);
}

beforeEach(() => installLayoutShims());
afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("a typed closer completes only a TYPED opener (task 1562)", () => {
  it("the audit's repro: `\\$40 per page` + typed `, discounted to $` stays prose, `\\$` intact", () => {
    const editor = mountParsed("The fee is \\$40 per page\n");
    caretAt(editor, endOfFirstBlock(editor));
    type(editor, ", discounted to $");
    expect(atomCounts(editor)).toEqual(NONE);
    expect(editor.state.doc.firstChild!.textContent).toBe(
      "The fee is $40 per page, discounted to $",
    );
    expect(tex(editor)).toBe("The fee is \\$40 per page, discounted to \\$");
    editor.destroy();
  });

  for (const [label, source, typed] of [
    ["a parsed `\\$\\$x\\$` + typed `$`", "a \\$\\$x\\$\n", "$"],
    ["a parsed lone `\\$` + typed `$` (bare `$$` opener)", "\\$\n", "$"],
    ["a parsed `\\textbackslash{}cite\\{k` + typed `}`", "See \\textbackslash{}cite\\{k\n", "}"],
    ["a parsed `\\textbackslash{}cite` + typed space", "See \\textbackslash{}cite\n", " "],
    ["a parsed `\\textbackslash{}footnote\\{b` + typed `}`", "See \\textbackslash{}footnote\\{b\n", "}"],
    ["a parsed `\\%` + typed space", "\\%\n", " "],
  ] as const) {
    it(`${label} stays prose`, () => {
      const editor = mountParsed(source);
      const before = editor.state.doc.firstChild!.textContent;
      caretAt(editor, endOfFirstBlock(editor));
      type(editor, typed);
      expect(atomCounts(editor)).toEqual(NONE);
      expect(editor.state.doc.firstChild!.textContent).toBe(before + typed);
      editor.destroy();
    });
  }

  it("typing a WHOLE construct after file text still converts; the file's `\\$` stays escaped", () => {
    const editor = mountParsed("The fee is \\$40\n");
    caretAt(editor, endOfFirstBlock(editor));
    type(editor, " or $y$");
    expect(atomCounts(editor)).toEqual({ ...NONE, inlineMath: 1 });
    expect(tex(editor)).toBe("The fee is \\$40 or $y$");
    editor.destroy();
  });

  it("Backspace inside the run keeps it: `$xy` ⌫ `$` → inlineMath{x}", () => {
    const editor = mountParsed("a\n");
    caretAt(editor, endOfFirstBlock(editor));
    type(editor, " $xy");
    backspace(editor);
    type(editor, "$");
    expect(atomCounts(editor)).toEqual({ ...NONE, inlineMath: 1 });
    editor.destroy();
  });

  it("leaving the run ends it: `$x`, caret away and back, then `$` stays prose (documented edge)", () => {
    const editor = mountParsed("a\n");
    const end = endOfFirstBlock(editor);
    caretAt(editor, end);
    type(editor, " $x");
    caretAt(editor, 1);
    caretAt(editor, end + 3);
    type(editor, "$");
    expect(atomCounts(editor)).toEqual(NONE);
    expect(editor.state.doc.firstChild!.textContent).toBe("a $x$");
    editor.destroy();
  });
});
