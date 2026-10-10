// @vitest-environment jsdom
//
// Task 1042 — "when writing in one caption it skips me down to the NEXT
// picture's caption." A `figureCaption` is a SLOT textblock (its figure holds
// at most one), and the editing commands treated it like a free paragraph:
//
//   • Delete in an EMPTY caption ran `deleteCurrentNode`: the caption node was
//     removed and the caret mapped into the NEXT figure's caption (the report).
//   • Enter anywhere in a caption was declined by every handler, so the
//     browser's NATIVE insertParagraph ran inside the figure NodeView's chrome.
//   • Enter/Backspace in an empty caption, Backspace at its start, and Delete
//     at the end of the paragraph above LIFTED the caption out of its figure
//     (the figure — image and all — was gone); Delete at a caption's end did
//     the same to the NEXT figure; Backspace at the start of the paragraph
//     below MERGED that paragraph into the caption.
//
// The fix is one rule in three halves (slot-textblock-keymap.ts): the caption
// has no `group` (it can't exist outside a figure), `figureBlock` is
// `isolating` (no edit crosses its sides), and the keymap consumes an
// unsplittable Enter and Delete/Backspace in an empty slot. This drives the
// REAL main extension stack through `handleKeyDown`, as a keypress does.
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor, type JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { buildEditorExtensions } from "@/lib/editor-extensions";

const editors: Editor[] = [];
afterEach(() => {
  while (editors.length) editors.pop()!.destroy();
});

function fig(uuid: string, text: string) {
  return {
    type: "figureBlock",
    attrs: { uuid, extras: "\\includegraphics{a.png}", label: `fig:${uuid}` },
    content: [{ type: "figureCaption", content: text ? [{ type: "text", text }] : [] }],
  };
}

function para(uuid: string, text: string) {
  return { type: "paragraph", attrs: { uuid }, content: text ? [{ type: "text", text }] : [] };
}

function mount(content: JSONContent[]): Editor {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const editor = new Editor({
    element: el,
    extensions: buildEditorExtensions({
      surface: "main",
      editableRef: { current: true },
      cardContext: false,
      callbacks: {},
      docIdRef: { current: null },
      anchoredUuidsRef: { current: new Set() },
      host: null,
    }),
    content: { type: "doc", content },
  });
  editors.push(editor);
  return editor;
}

/** Start of the caption's inline content in figure `uuid`. */
function captionStart(editor: Editor, uuid: string): number {
  let at = -1;
  editor.state.doc.descendants((n, pos) => {
    if (n.type.name === "figureBlock" && n.attrs.uuid === uuid) at = pos + 2;
  });
  return at;
}

function place(editor: Editor, pos: number) {
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
}

/** Press a key the way the view receives it: every plugin's handleKeyDown. */
function press(editor: Editor, key: string): boolean {
  return !!editor.view.someProp("handleKeyDown", (f) =>
    f(editor.view, new KeyboardEvent("keydown", { key })),
  );
}

/** The figure (by uuid) enclosing the caret, or null when it is in none. */
function caretFigure(editor: Editor): string | null {
  const $from = editor.state.selection.$from;
  for (let d = $from.depth; d >= 0; d--) {
    if ($from.node(d).type.name === "figureBlock") return $from.node(d).attrs.uuid as string;
  }
  return null;
}

/** Top-level shape: every figure still owns exactly one caption child. */
function shape(doc: PMNode): string[] {
  const out: string[] = [];
  doc.forEach((n) => {
    if (n.type.name === "figureBlock") {
      expect(n.childCount).toBe(1);
      expect(n.firstChild!.type.name).toBe("figureCaption");
    }
    out.push(`${n.type.name}:${n.textContent}`);
  });
  return out;
}

const TWO_FIGURES = () => [
  para("p1", "intro"),
  fig("fa", "First cap"),
  fig("fb", "Second caption"),
  para("p2", "outro"),
];
const TWO_FIGURES_SHAPE = [
  "paragraph:intro",
  "figureBlock:First cap",
  "figureBlock:Second caption",
  "paragraph:outro",
];

describe("a figure caption is a slot: keys never leave or remove it (task 1042)", () => {
  const offsets = { start: 0, middle: 3, end: "First cap".length } as const;
  for (const [where, off] of Object.entries(offsets)) {
    for (const key of ["Enter", "Backspace", "Delete"]) {
      it(`${key} at the caption's ${where} keeps the caret in THIS caption`, () => {
        const editor = mount(TWO_FIGURES());
        place(editor, captionStart(editor, "fa") + off);
        press(editor, key);
        expect(caretFigure(editor)).toBe("fa");
        expect(editor.state.selection.$from.parent.type.name).toBe("figureCaption");
        if (key === "Enter") {
          // Consumed, not handed to the browser's native insertParagraph.
          place(editor, captionStart(editor, "fa") + off);
          expect(press(editor, "Enter")).toBe(true);
        }
        // A character delete INSIDE the caption is the browser's native edit
        // (no keymap command runs for it), so at keymap level every block —
        // the next figure above all — must come out byte-identical.
        expect(shape(editor.state.doc)).toEqual(TWO_FIGURES_SHAPE);
      });
    }
  }

  for (const key of ["Enter", "Backspace", "Delete"]) {
    it(`${key} in an EMPTY caption leaves the caption, its figure and the next figure in place`, () => {
      const editor = mount([para("p1", "intro"), fig("fa", ""), fig("fb", "Second caption")]);
      place(editor, captionStart(editor, "fa"));
      expect(press(editor, key)).toBe(true);
      expect(caretFigure(editor)).toBe("fa");
      expect(shape(editor.state.doc)).toEqual([
        "paragraph:intro",
        "figureBlock:",
        "figureBlock:Second caption",
        "paragraph:", // the trailing-node plugin's closing paragraph
      ]);
    });
  }

  it("Backspace at the start of the paragraph BELOW a figure does not merge it into the caption", () => {
    const editor = mount([para("p1", "intro"), fig("fa", "Cap A"), para("p2", "outro")]);
    const d = editor.state.doc;
    place(editor, d.content.size - d.lastChild!.nodeSize + 1);
    press(editor, "Backspace");
    expect(shape(editor.state.doc)).toEqual(["paragraph:intro", "figureBlock:Cap A", "paragraph:outro"]);
  });

  it("Delete at the end of the paragraph ABOVE a figure does not strip the figure", () => {
    const editor = mount([para("p1", "intro"), fig("fa", "Cap A"), para("p2", "outro")]);
    place(editor, 1 + "intro".length);
    press(editor, "Delete");
    expect(shape(editor.state.doc)).toEqual(["paragraph:intro", "figureBlock:Cap A", "paragraph:outro"]);
  });

  it("the schema cannot hold a caption outside a figure", () => {
    const editor = mount([para("p1", "x")]);
    const { schema } = editor.state;
    expect(schema.nodes.figureCaption.spec.group).toBeUndefined();
    expect(schema.nodes.figureBlock.spec.isolating).toBe(true);
    expect(schema.nodes.doc.contentMatch.matchType(schema.nodes.figureCaption)).toBeNull();
  });

  it("Enter in an ordinary paragraph is untouched by the slot rule", () => {
    const editor = mount([para("p1", "intro"), fig("fa", "Cap A")]);
    place(editor, 3);
    expect(press(editor, "Enter")).toBe(true);
    // [p1, fa, trailing paragraph] → p1 split in two.
    expect(editor.state.doc.childCount).toBe(4);
    expect(editor.state.doc.child(0).textContent).toBe("in");
    expect(editor.state.doc.child(1).textContent).toBe("tro");
  });
});
