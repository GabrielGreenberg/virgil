// @vitest-environment jsdom
//
// Task 607 — the grey `.latex-cmd` DECORATION paints only LaTeX-in-PROSE.
//
// THE BUG THIS PINS. The latex-command decoration plugin scanned EVERY
// textblock and skipped only text carrying the `latexCommand` mark, so a
// `\foo{1}` inside a code block and a `\cite{x}` inside a `%` comment block
// each rendered a shrunken (`0.9em`) grey span — and a command inside a
// verbatim carrier (which already renders its own `.latex-cmd` span) got a
// second, nested one. Now the plugin asks the PROSE INDEX's two questions
// (`blockCarriesProse`, `inlineIsProse`), so "is this text LaTeX-in-prose?"
// has one answer across search, spellcheck and this paint.
//
// Proven on the REAL `buildEditorExtensions("main")` stack, both on the cold
// build (content at mount) and on the per-block rebuild (typing).
import { describe, it, expect, afterEach, vi } from "vitest";

// The extension barrel reaches `@/lib/storage` — the standard stub.
vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  LATEX_COMMENT_TAIL_MARK,
  LATEX_VERBATIM_MARK,
} from "@/lib/latex-lexer";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  } as unknown as EditorExtensionsCtx;
}

const live: Editor[] = [];
afterEach(() => {
  while (live.length) live.pop()?.destroy();
});

function mount(content: unknown): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const ed = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: content as never,
  });
  live.push(ed);
  return ed;
}

/** The text of every DECORATION span (not a mark's own `.latex-cmd` span),
 *  tagged with the tag name of the block that holds it. */
function decoratedRuns(ed: Editor): string[] {
  return [
    ...ed.view.dom.querySelectorAll(
      ".latex-cmd:not([data-latex-cmd]):not([data-latex-verbatim])",
    ),
  ].map((el) => {
    const block = el.closest("p, pre, div[data-type], div.latex-comment, h1, h2, h3, li");
    return `${block?.tagName ?? "?"}:${el.textContent}`;
  });
}

const text = (t: string, marks?: unknown[]) => (marks ? { type: "text", text: t, marks } : { type: "text", text: t });

const PROBE = {
  type: "doc",
  content: [
    { type: "paragraph", content: [text("prose \\emph{a} here")] },
    { type: "codeBlock", content: [text("x = \\foo{1}")] },
    { type: "latexComment", content: [text("see \\cite{x}")] },
    {
      type: "paragraph",
      content: [
        text("tail "),
        text("% \\ref{t}", [{ type: LATEX_COMMENT_TAIL_MARK }]),
      ],
    },
    {
      type: "paragraph",
      content: [
        text("verb "),
        text("\\verb|\\x{y}|", [{ type: LATEX_VERBATIM_MARK, attrs: { form: "inline" } }]),
      ],
    },
  ],
};

function caretAtEndOf(ed: Editor, typeName: string) {
  let pos = -1;
  ed.state.doc.descendants((n, p) => {
    if (pos < 0 && n.type.name === typeName) pos = p + 1 + n.content.size;
    return pos < 0;
  });
  expect(pos).toBeGreaterThan(-1);
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)));
}

function typeText(ed: Editor, t: string) {
  for (const ch of t) {
    const { from, to } = ed.state.selection;
    ed.view.dispatch(ed.state.tr.insertText(ch, from, to));
  }
}

describe("latex-cmd decoration paints prose only (task 607)", () => {
  it("cold build: no span in a code block, a comment block, a tail or a verbatim run", () => {
    const ed = mount(PROBE);
    // The fixture really is the shape under test — each node survived the schema.
    const types = ed.state.doc.content.content.map((n) => n.type.name);
    expect(types).toEqual(["paragraph", "codeBlock", "latexComment", "paragraph", "paragraph"]);
    expect(ed.state.doc.child(3).lastChild?.marks[0]?.type.name).toBe(LATEX_COMMENT_TAIL_MARK);
    expect(ed.state.doc.child(4).lastChild?.marks[0]?.type.name).toBe(LATEX_VERBATIM_MARK);
    // CONTROL: the prose paragraph's bare command is still painted — and it is
    // the ONLY decoration in the document.
    expect(decoratedRuns(ed)).toEqual(["P:\\emph{a}"]);
  });

  it("per-block rebuild: typing a command into a code/comment block paints nothing; prose still paints", () => {
    const ed = mount(PROBE);
    caretAtEndOf(ed, "codeBlock");
    typeText(ed, " \\bar{2}");
    caretAtEndOf(ed, "latexComment");
    typeText(ed, " \\baz");
    expect(ed.state.doc.child(1).textContent).toBe("x = \\foo{1} \\bar{2}");
    expect(ed.state.doc.child(2).textContent).toBe("see \\cite{x} \\baz");
    expect(decoratedRuns(ed)).toEqual(["P:\\emph{a}"]);

    // CONTROL: the same keystrokes in prose do render grey (the type-time
    // carrier promotes a typed command to the `latexCommand` MARK, whose own
    // span carries the class, so ask for any `.latex-cmd` here).
    caretAtEndOf(ed, "paragraph");
    typeText(ed, " \\qux");
    const grey = [...ed.view.dom.querySelectorAll("p .latex-cmd")].map((el) => el.textContent);
    expect(grey.some((t) => t?.includes("\\qux"))).toBe(true);
    expect(decoratedRuns(ed).some((r) => !r.startsWith("P:"))).toBe(false);
  });
});
