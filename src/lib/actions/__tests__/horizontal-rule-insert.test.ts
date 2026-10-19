// @vitest-environment jsdom
//
// Task 1176 — the INSERT door for `horizontalRule`. The node, its parse
// (`\hrulefill` alone on a line) and its serialize all predated this task;
// no surface could make one. The row (`horizontal-rule`) rides the same
// COLLAPSE-not-delete helper as `forest`, so this suite pins:
//
//   * both surfaces (slash `\hrule`, the lightning grid cell) land ONE rule;
//   * the container guard and the collab gate refuse, and `applies()` agrees;
//   * a live selection is kept, not eaten;
//   * the rule round-trips as `\hrulefill` on its own paragraph;
//   * upstream's `---` markdown input rule is OFF on the main editor AND the
//     excerpt card body — `---` is an em-dash in LaTeX (`VirgilHorizontalRule`).
//
// (The extension barrel transitively imports `@/lib/storage`; stub it.)

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor, type AnyExtension } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import type { JSONContent } from "@tiptap/react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { COMMAND_MAP } from "@/lib/tiptap/commands";
import {
  VIRGIL_ACTION_REGISTRY,
  SLASH_NAME_TO_ACTION_ID,
  type ActionContext,
} from "@/lib/actions/action-registry";
import { EXCERPT_STARTER_KIT_CONFIG } from "@/lib/tiptap/borrowed-schema";
import { VirgilHorizontalRule } from "@/lib/tiptap/virgil-horizontal-rule";
import { serializeToLatex } from "@/lib/latex-serializer";
import { parseLatex } from "@/lib/latex-parser";

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

function mount(content: Record<string, unknown>[], extensions?: AnyExtension[]): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: extensions ?? buildEditorExtensions(mainCtx()),
    content: { type: "doc", content },
  });
}

function paragraph(text: string, uuid = "para-A"): Record<string, unknown> {
  return { type: "paragraph", attrs: { uuid }, content: text ? [{ type: "text", text }] : [] };
}

function setSel(editor: Editor, from: number, to = from): void {
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)),
  );
}

function countRules(editor: Editor): number {
  let n = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "horizontalRule") n += 1;
    return true;
  });
  return n;
}

function runSlash(editor: Editor): void {
  COMMAND_MAP.get("hrule")!.action(editor.view, "\\hrule");
}

function gridCtx(editor: Editor, canEdit = true): ActionContext {
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
    canEdit,
  } as ActionContext;
}

function runGrid(editor: Editor, canEdit = true): void {
  VIRGIL_ACTION_REGISTRY["horizontal-rule"].run(gridCtx(editor, canEdit));
}

const SURFACES: ReadonlyArray<[string, (editor: Editor) => void]> = [
  ["slash \\hrule", runSlash],
  ["lightning grid cell", (editor) => runGrid(editor)],
];

/** Type one character the way the browser does: offer it to every
 *  `handleTextInput` prop (where input rules live) and insert it if none
 *  claims it. */
function typeChar(editor: Editor, ch: string): void {
  const view = editor.view;
  const { from, to } = view.state.selection;
  const deflt = () => view.state.tr.insertText(ch, from, to);
  const handled = view.someProp("handleTextInput", (f) => f(view, from, to, ch, deflt));
  if (!handled) view.dispatch(deflt());
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the horizontal-rule row", () => {
  it("is the slash name `hrule` and a lightning + slash block row", () => {
    expect(SLASH_NAME_TO_ACTION_ID.hrule).toBe("horizontal-rule");
    const row = VIRGIL_ACTION_REGISTRY["horizontal-rule"];
    expect(row.category).toBe("block");
    expect(row.label).toBe("Horizontal rule");
    expect(row.surfaces).toEqual({ slash: true, lightning: true });
  });

  for (const [name, run] of SURFACES) {
    it(`${name} inserts exactly one rule at the caret`, () => {
      const editor = mount([paragraph("Hello world")]);
      setSel(editor, 1 + 11); // end of the paragraph
      run(editor);
      expect(countRules(editor)).toBe(1);
      expect(editor.state.doc.textContent).toBe("Hello world");
    });

    it(`${name} keeps a live selection's prose intact`, () => {
      const editor = mount([paragraph("alpha beta gamma")]);
      setSel(editor, 1 + 6, 1 + 10); // "beta"
      run(editor);
      expect(countRules(editor)).toBe(1);
      const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, " ");
      for (const w of ["alpha", "beta", "gamma"]) expect(text).toContain(w);
    });

    it(`${name} refuses a caret inside a titleField, and applies() agrees`, () => {
      const editor = mount([
        { type: "titleField", attrs: { field: "title" }, content: [{ type: "text", text: "A Paper" }] },
        paragraph("Body text"),
      ]);
      setSel(editor, 3);
      expect(VIRGIL_ACTION_REGISTRY["horizontal-rule"].applies(gridCtx(editor))).toBe("disabled");
      run(editor);
      expect(countRules(editor)).toBe(0);
    });
  }

  it("the grid cell inserts nothing without the pen (canEdit false)", () => {
    const editor = mount([paragraph("Hello world")]);
    setSel(editor, 6);
    runGrid(editor, false);
    expect(countRules(editor)).toBe(0);
  });
});

describe("round trip", () => {
  it("serializes to `\\hrulefill` on its own paragraph and re-parses to a rule", () => {
    const editor = mount([paragraph("Before", "p1"), paragraph("After", "p2")]);
    setSel(editor, 1 + 6); // end of "Before"
    runSlash(editor);

    const latex = serializeToLatex(editor.getJSON() as JSONContent, {
      preamble: "\\documentclass{article}\n\\begin{document}\n",
    });
    expect(latex).toMatch(/Before[^\n]*\n\n\\hrulefill\n\nAfter/);

    const body = latex.split("\\begin{document}")[1] ?? "";
    const reparsed = parseLatex(body);
    const kinds = (reparsed.content ?? []).map((n) => n.type);
    expect(kinds.filter((k) => k === "horizontalRule")).toHaveLength(1);
  });
});

describe("`---` stays an em-dash — the markdown rule is off", () => {
  it("main editor: typing `---` at a paragraph start leaves the text, no rule", () => {
    const editor = mount([paragraph("")]);
    setSel(editor, 1);
    for (const ch of "---") typeChar(editor, ch);
    expect(countRules(editor)).toBe(0);
    // The main editor's own typography may render the dashes as `—` (it
    // serializes back to `---`); either way the TEXT survives, as text.
    expect(editor.state.doc.textContent).toMatch(/^(---|—)$/);
  });

  it("excerpt card body: the same (StarterKit's rule off, Virgil's node on)", () => {
    expect(EXCERPT_STARTER_KIT_CONFIG.horizontalRule).toBe(false);
    const editor = mount(
      [{ type: "paragraph", content: [] }],
      [StarterKit.configure({ horizontalRule: false }), VirgilHorizontalRule],
    );
    setSel(editor, 1);
    for (const ch of "---") typeChar(editor, ch);
    expect(countRules(editor)).toBe(0);
    expect(editor.state.doc.textContent).toBe("---");
  });

  it("control: upstream's stock node DOES fire on `---` (the harness has teeth)", () => {
    const editor = mount([{ type: "paragraph", content: [] }], [StarterKit]);
    setSel(editor, 1);
    for (const ch of "---") typeChar(editor, ch);
    expect(countRules(editor)).toBe(1);
  });
});
