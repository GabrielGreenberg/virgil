// @vitest-environment jsdom
//
// Task 1368 — the typed-LaTeX input rules honour the parser's escape rule.
// `\$` is a literal dollar and `\\cite` / `\\footnote` are a line break then
// text; the parser has read them that way since tasks 206/210 (`isEscaped`),
// but the four delimiter-matching typed rules never asked, so typing
// `costs \$5, or \$` made the escaped dollars a math chip `5, or \`. Every
// rule now matches through ONE door (`matchTypedLatexRule`) that refuses a
// match whose delimiter is escaped — while an EVEN backslash run (`\\$x$`) is
// still a real delimiter and still converts. Sequential typing through PM's
// real `handleTextInput` dispatch, on the real main stack (harness from
// `typed-math-sequential.test.ts`).
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

function para(editor: Editor): unknown[] {
  const out: unknown[] = [];
  editor.state.doc.firstChild!.forEach((n: PMNode) =>
    out.push(n.isText ? n.text : [n.type.name, n.attrs.latex ?? n.attrs.name ?? null]),
  );
  return out;
}

const ATOMS = ["inlineMath", "displayMath", "footnote", "citation"];
function atomCounts(editor: Editor): Record<string, number> {
  return Object.fromEntries(ATOMS.map((t) => [t, countOfType(editor, t)]));
}
const NONE = { inlineMath: 0, displayMath: 0, footnote: 0, citation: 0 };

describe("typed-LaTeX rules are escape-aware (task 1368)", () => {
  // Each escaped row must leave the typed characters as plain prose: no atom
  // the parser would not produce from the same characters, and the paragraph
  // reads back exactly as typed.
  for (const typed of [
    "costs \\$5, or \\$", // escaped opener AND closer
    "x $a\\$", // escaped CLOSER
    "a \\$\\$x$$", // escaped display opener
    "a \\\\footnote{x}", // `\\` line break, then text
    "a \\\\cite{k}",
    "a \\\\cite ", // the bare soft-routing branch
  ]) {
    it(`${JSON.stringify(typed)} stays text`, () => {
      const editor = mountEmptyParagraph();
      typeSequentially(editor, typed);
      expect(atomCounts(editor), JSON.stringify(para(editor))).toEqual(NONE);
      expect(editor.state.doc.firstChild!.textContent).toBe(typed);
      editor.destroy();
    });
  }

  it("an EVEN backslash run is not an escape — `p \\\\$x$` still makes inlineMath{x}", () => {
    const editor = mountEmptyParagraph();
    typeSequentially(editor, "p \\\\$x$");
    expect(atomCounts(editor)).toEqual({ ...NONE, inlineMath: 1 });
    const last = para(editor).at(-1);
    expect(last).toEqual(["inlineMath", "x"]);
    // The `\\` before it stays prose (a line-break command), untouched.
    expect(editor.state.doc.firstChild!.textContent).toBe("p \\\\");
    editor.destroy();
  });

  it("unescaped controls still convert: `\\cite{k}`, `\\footnote{x}`, `$$x$$`", () => {
    for (const [typed, type] of [
      ["a \\cite{k}", "citation"],
      ["a \\footnote{x}", "footnote"],
      ["a $$x$$", "displayMath"],
    ] as const) {
      const editor = mountEmptyParagraph();
      typeSequentially(editor, typed);
      expect(countOfType(editor, type), typed).toBe(1);
      editor.destroy();
    }
  });
});
